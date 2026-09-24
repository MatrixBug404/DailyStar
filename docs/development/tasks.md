# Phase 5 Implementation Tasks

**Source of truth:** `docs/development/phase5-technical-spec-v1.5.md`
**Status:** APPROVED FOR EXECUTION
**Constraint:** No existing dependency versions changed. No Phase 0–4 behavior
changed (except the PB-01 slug fix in Wave 5).

---

## Conventions

- **AC-nn** = acceptance criteria from V1.5 §18
- **INV-nn** = invariants from V1.5 §3
- **V(cmd)** = validation command(s) to run after the task
- Each task is independently executable within its wave
- Non-regression gate (58 unit + 57 E2E) runs after every wave

---

## Wave 1 — Database Migration & Schema

**Goal:** Extend the Prisma schema and apply the Phase 5 FTS migration to the
running database. All subsequent waves depend on this.

---

### Task 1.1 — Add `searchVector` to Prisma schema

**Files affected:**
- `apps/api/src/database/prisma/schema.prisma`

**Change:** Inside the `ArticleRevision` model, add:
```prisma
// Phase 5: Full-text search vector.
// PostgreSQL populates this using GENERATED ALWAYS AS ... STORED.
// Prisma never reads or writes this field.
// All FTS queries use parameterized $queryRaw.
// Declared nullable only because Prisma requires Unsupported columns
// to be nullable; the DB column itself is never NULL.
searchVector Unsupported("tsvector")?
```

Do not modify any other model.

**Dependencies:** None

**Acceptance criteria:** AC-16

**Tests required:** Compilation check only

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api exec prisma generate \
  --schema=src/database/prisma/schema.prisma
corepack pnpm --filter @dailystar/api typecheck
```

---

### Task 1.2 — Create FTS migration file manually

**Files affected:**
- `apps/api/src/database/prisma/migrations/20260924000001_phase5_fts/` (new directory)
- `apps/api/src/database/prisma/migrations/20260924000001_phase5_fts/migration.sql` (new file)

**Change:** Create directory and SQL file exactly as specified. Do NOT use
`prisma migrate dev` to generate this file. The migration is intentionally
authored manually with the exact timestamp `20260924000001_phase5_fts`.

```sql
-- Phase 5: Full-Text Search — Weighted Generated tsvector Column + GIN Index
--
-- Raw SQL is required here because:
--   1. PostgreSQL GENERATED ALWAYS AS ... STORED DDL cannot be expressed
--      in Prisma's schema language for a tsvector expression.
--   2. Prisma 6.x supports GIN indexes generally (via @@index type: Gin),
--      but cannot create a GIN index over an Unsupported generated column.
-- These are the authoritative DDL statements for Phase 5 FTS.

ALTER TABLE article_revisions
  ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title,   '')), 'A')
   || setweight(to_tsvector('english', coalesce(excerpt, '')), 'B')
   || setweight(to_tsvector('english', coalesce(body,    '')), 'C')
  ) STORED;

CREATE INDEX "article_revisions_searchVector_idx"
  ON article_revisions
  USING GIN ("searchVector");
```

**Dependencies:** Task 1.1

**Acceptance criteria:** AC-15, AC-16, AC-17, AC-18

**Tests required:** None — verified by migration apply in Task 1.3

**V(cmd):** (applied in Task 1.3)

---

### Task 1.3 — Apply migration and verify database state

**Files affected:** None (database-only operation)

**Change:** Apply the authored migration using `migrate deploy`. Verify the
database state. Do NOT reset the database or modify existing migrations.

**Dependencies:** Task 1.2; local PostgreSQL running

**Acceptance criteria:** AC-15, AC-16, AC-17, AC-18, INV-12 (no regression)

**Tests required:** All existing test suites must pass

**V(cmd):**
```bash
# 1. Apply migration
corepack pnpm --filter @dailystar/api exec prisma migrate deploy \
  --schema=src/database/prisma/schema.prisma

# 2. Confirm migration marked applied
corepack pnpm --filter @dailystar/api exec prisma migrate status \
  --schema=src/database/prisma/schema.prisma

# 3. Regenerate Prisma client
corepack pnpm --filter @dailystar/api exec prisma generate \
  --schema=src/database/prisma/schema.prisma

# 4. Verify column and index exist
# Run in psql or via prisma db execute:
#   SELECT column_name, generation_expression
#   FROM information_schema.columns
#   WHERE table_name = 'article_revisions'
#     AND column_name = 'searchVector';
#
#   SELECT indexname FROM pg_indexes
#   WHERE tablename = 'article_revisions'
#     AND indexname = 'article_revisions_searchVector_idx';
#
# 5. Verify existing rows have populated vectors (optional spot-check):
#   SELECT id, "searchVector" IS NOT NULL AS has_vector
#   FROM article_revisions LIMIT 5;

# 6. Non-regression gate
corepack pnpm --filter @dailystar/api typecheck
corepack pnpm --filter @dailystar/api test
corepack pnpm --filter @dailystar/api test:e2e
```

---

## Wave 2 — SearchModule & FTS Provider

**Goal:** Build and test the FTS search engine independently.

---

### Task 2.1 — Scaffold SearchModule, DTOs, and provider skeleton

**Files affected:**
- `apps/api/src/modules/search/search.module.ts` (new)
- `apps/api/src/modules/search/providers/postgres-fts.provider.ts` (new)
- `apps/api/src/modules/search/dto/search-query.dto.ts` (new)
- `apps/api/src/modules/search/dto/search-result.dto.ts` (new)

**Change:** Scaffold `SearchModule` exporting `PostgresFtsProvider`.

`SearchQueryDto` must use the whitespace-trimming pattern:
```typescript
@Transform(({ value }) =>
  typeof value === 'string' ? value.trim() : value,
)
@IsString()
@IsNotEmpty()
@MaxLength(200)
q!: string;
```

All invalid values return 400 — no clamping.

**Dependencies:** Task 1.3

**Acceptance criteria:** AC-24 (search limit max 20)

**Tests required:** Compilation only

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api typecheck
```

---

### Task 2.2 — Implement `buildWhereFragment()`

**Files affected:**
- `apps/api/src/modules/search/providers/postgres-fts.provider.ts`

**Change:** Implement private `buildWhereFragment(query, categorySlug?, tag?)`
using `Prisma.sql` and `Prisma.join`. Single source of truth for result and
COUNT queries.

**Dependencies:** Task 2.1

**Acceptance criteria:** AC-19, AC-55

**Tests required:**
- Unit: no filters → FTS condition only
- Unit: `categorySlug` → includes `c.slug = $param`
- Unit: `tag` → includes EXISTS subquery with LOWER()
- Unit: both → both conditions joined by AND

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test -- --testPathPattern=postgres-fts
```

---

### Task 2.3 — Implement `search()` result and COUNT queries

**Files affected:**
- `apps/api/src/modules/search/providers/postgres-fts.provider.ts`

**Change:** Implement `search()`. Result and COUNT queries both inject the
same `${whereFragment}`. `ORDER BY rank DESC, a."publishedAt" DESC, a.id ASC`.
`ts_headline()` against `body` only.

**Dependencies:** Task 2.2

**Acceptance criteria:** AC-19, AC-20, AC-55

**Tests required:**
- Unit PU-09: ordering correct
- Unit PU-20: COUNT uses identical fragment

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test -- --testPathPattern=postgres-fts
```

---

### Task 2.4 — Implement headline sanitization

**Files affected:**
- `apps/api/src/modules/search/providers/postgres-fts.provider.ts`

**Change:** Implement `sanitizeHeadline()`. Strip all HTML except `<b>`/`</b>`.

**Dependencies:** Task 2.3

**Acceptance criteria:** AC-20, AC-21, AC-22

**Tests required:**
- Unit PU-13: strips non-`<b>` tags
- Unit PU-10: title-only match → result returned; no `<b>` assertion

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test -- --testPathPattern=postgres-fts
corepack pnpm --filter @dailystar/api test
```

**Non-regression gate:** 58 unit tests pass.

---

## Wave 3 — PublicModule: Feed, Article, Category, Search Endpoints

**Goal:** Build and test the five non-cover public endpoints.

---

### Task 3.1 — Scaffold PublicModule, controller, service, DTOs

**Files affected:**
- `apps/api/src/modules/public/public.module.ts` (new)
- `apps/api/src/modules/public/public.controller.ts` (new)
- `apps/api/src/modules/public/public.service.ts` (new)
- `apps/api/src/modules/public/dto/public-feed-query.dto.ts` (new)
- `apps/api/src/modules/public/dto/category-articles-query.dto.ts` (new)
- `apps/api/src/modules/public/dto/public-article-summary.dto.ts` (new)
- `apps/api/src/modules/public/dto/public-article-full.dto.ts` (new)
- `apps/api/src/modules/public/dto/public-category.dto.ts` (new)
- `apps/api/src/modules/public/dto/cover-response.dto.ts` (new)
- `apps/api/src/app.module.ts` (modified — add PublicModule, SearchModule)

**Change:** `@Controller('v1/public')`. No `AuthGuard`/`PermissionGuard`.
DTOs with class-validator; invalid → 400; no clamping.

**Dependencies:** Task 2.4

**Acceptance criteria:** AC-31, AC-23, AC-24, AC-45

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api typecheck
corepack pnpm --filter @dailystar/api test
corepack pnpm --filter @dailystar/api test:e2e
```

**Non-regression gate:** 58 unit + 57 E2E pass.

---

### Task 3.2 — Implement `getArticles()` feed endpoint

**Files affected:**
- `apps/api/src/modules/public/public.service.ts`
- `apps/api/src/modules/public/public.controller.ts`

**Change:** Triple-gate `where`. `categoryId > categorySlug` precedence.
Tag case-insensitive. Parallel `findMany` + `count`. Uses `prisma` singleton.

**Dependencies:** Task 3.1

**Acceptance criteria:** AC-01, AC-02, AC-03, AC-04, AC-05, AC-13, AC-23,
AC-43, AC-44, AC-45, AC-48, AC-49, AC-50

**Tests required:** PU-01, PU-03–06, PU-15–17; PR-01–05, PR-20–24

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test
corepack pnpm --filter @dailystar/api test:e2e
```

---

### Task 3.3 — Implement `getArticle()` single-article endpoint

**Files affected:**
- `apps/api/src/modules/public/public.service.ts`
- `apps/api/src/modules/public/public.controller.ts`

**Change:** Triple-gate `findFirst` by slug. 404 if missing. Body plain text
(INV-03). All DTO fields: `id`, `author.bio`, `author.avatarUrl`, `category.id`.

**Dependencies:** Task 3.2

**Acceptance criteria:** AC-01, AC-02, AC-05, AC-06, AC-13, AC-48, AC-49, AC-50

**Tests required:** PU-02; PR-06–08

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test
corepack pnpm --filter @dailystar/api test:e2e
```

---

### Task 3.4 — Implement `getCategories()` with hierarchy

**Files affected:**
- `apps/api/src/modules/public/public.service.ts`
- `apps/api/src/modules/public/public.controller.ts`

**Change:** Raw SQL COUNT per category. Structural ancestor retention.
`publishedArticleCount` = direct only.

**Dependencies:** Task 3.3

**Acceptance criteria:** AC-25, AC-57

**Tests required:** PU-11; PR-13–14; ancestor-with-zero-direct unit test

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test
corepack pnpm --filter @dailystar/api test:e2e
```

---

### Task 3.5 — Implement `getCategoryArticles()` endpoint

**Files affected:**
- `apps/api/src/modules/public/public.service.ts`
- `apps/api/src/modules/public/public.controller.ts`

**Change:** 404 for missing/zero-article category. Beyond-last-page → 200
with empty data array.

**Dependencies:** Task 3.4

**Acceptance criteria:** AC-26, AC-46

**Tests required:** PU-12; PR-15–16, PR-25; beyond-last-page 200 test

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test
corepack pnpm --filter @dailystar/api test:e2e
```

---

### Task 3.6 — Implement `search()` endpoint

**Files affected:**
- `apps/api/src/modules/public/public.service.ts`
- `apps/api/src/modules/public/public.controller.ts`

**Change:** Delegates to `PostgresFtsProvider`. Returns `{ data, total, page,
limit, query }`. Whitespace-only `q` rejected via DTO `@IsNotEmpty` (after
`@Transform` trim).

**Dependencies:** Task 3.5

**Acceptance criteria:** AC-19, AC-20, AC-21, AC-22, AC-24, AC-47, AC-55

**Tests required:** PU-14; PR-17–19, PR-26; whitespace-only `q` E2E test:
`GET /api/v1/public/search?q=%20%20%20` → 400

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test
corepack pnpm --filter @dailystar/api test:e2e
```

**Non-regression gate:** 58 unit + 57 E2E pass.

---

## Wave 4 — Cover Endpoint, S3 Public Client, Rate Limiting, HMAC

**Goal:** Complete the cover endpoint with dual S3 clients, Redis rate
limiting, and trusted client-IP propagation.

---

### Task 4.0 — Add pinned `ioredis` dependency

**Files affected:**
- `apps/api/package.json`
- `pnpm-lock.yaml`

**Change:** Add `ioredis` as a production dependency at an exact pinned version.

```bash
corepack pnpm --filter @dailystar/api add ioredis@<latest-stable-exact>
```

- Do NOT change any existing dependency versions
- Pin the exact version (e.g. `"ioredis": "5.3.2"` — use the latest stable
  at installation time)
- Update `pnpm-lock.yaml`

**Dependencies:** Task 3.6

**Acceptance criteria:** Required by AC-40, AC-41, AC-51

**Tests required:** Install verification

**V(cmd):**
```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @dailystar/api exec node \
  -e "require('ioredis'); console.log('ioredis ok')"
corepack pnpm --filter @dailystar/api typecheck
```

---

### Task 4.1 — Add `S3_PUBLIC_ENDPOINT` to configuration

**Files affected:**
- `apps/api/src/config/configuration.ts`
- `.env.example`
- `apps/api/.env` (local dev only — not committed)

**Dependencies:** Task 4.0

**Acceptance criteria:** AC-10, AC-53

**Tests required:** 3 unit tests for `requirePublicEndpoint()`

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test
```

---

### Task 4.2 — Add `publicClient` and `generateSignedPublicDownloadUrl()` to MinioStorageService

**Files affected:**
- `apps/api/src/modules/media/storage/minio-storage.service.ts`

**Change:** Dual S3Client. New public signing method. `StorageService`
interface NOT modified. All Phase 4 methods unchanged.

**Dependencies:** Task 4.1

**Acceptance criteria:** AC-10, AC-53, AC-54

**Tests required:** 4 unit tests (dual client usage, Phase 4 regression)

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test -- --testPathPattern=minio-storage
corepack pnpm --filter @dailystar/api test
```

**Non-regression gate:** 58 unit tests pass.

---

### Task 4.3 — Implement `RateLimiterRedisService` with Lua script

**Files affected:**
- `apps/api/src/modules/public/guards/rate-limiter.redis.service.ts` (new)

**Change:** `ioredis` client. Lua sliding window. Member ID = `randomUUID()`
from Node.js `crypto`. Fail-open on Redis errors.

**Dependencies:** Task 4.2

**Acceptance criteria:** AC-40, AC-41, AC-51

**Tests required:** PU-18 (limit enforcement, fail-open, UUID uniqueness)

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test -- --testPathPattern=rate-limiter
```

---

### Task 4.4 — Implement `CoverRateLimitGuard`

**Files affected:**
- `apps/api/src/modules/public/guards/cover-rate-limit.guard.ts` (new)

**Change:** `canActivate()` owns all five steps: IP resolution, rate check,
attach, Retry-After header (`'60'` fixed), throw 429.

**Dependencies:** Task 4.3

**Acceptance criteria:** AC-40, AC-41, AC-42, AC-51, AC-52

**Tests required:** PU-18, PU-19 (valid sig, invalid sig, missing headers,
invalid hex → no 500)

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test -- --testPathPattern=cover-rate-limit
```

---

### Task 4.5 — Implement `getCover()` and wire guard

**Files affected:**
- `apps/api/src/modules/public/public.service.ts`
- `apps/api/src/modules/public/public.controller.ts`
- `apps/api/src/modules/public/public.module.ts`

**Change:** Triple-gate + READY check. `generateSignedPublicDownloadUrl()`.
Guard wired. Controller reads guard-set IP only.

**Dependencies:** Task 4.4

**Acceptance criteria:** AC-06–10, AC-40, AC-42

**Tests required:** PU-07–08; PR-09–12; PB-02

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test
corepack pnpm --filter @dailystar/api test:e2e
```

**Non-regression gate:** 58 unit + 57 E2E pass.

---

## Wave 5 — Slug Immutability Fix

---

### Task 5.1 — Apply slug immutability gate

**Files affected:**
- `apps/api/src/modules/articles/articles.service.ts`

**Change:** Add `&& current.publishedAt === null` gate. One line change.

**Dependencies:** Wave 4 complete

**Acceptance criteria:** AC-11, AC-12, INV-04

**Tests required:** 2 unit tests; E2E PB-01

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test -- --testPathPattern=articles.service
corepack pnpm --filter @dailystar/api test:e2e
```

**Non-regression gate:** 58 unit + 57 E2E pass. PB-01 must pass.

---

## Wave 6 — Next.js Public Pages, OG Route, robots, Sitemap

---

### Task 6.1 — Replace home page with ISR feed

**Files:** `apps/web/app/page.tsx`
`export const revalidate = 60`. **AC:** AC-29, AC-30.

### Task 6.2 — Create article page

**Files:** `apps/web/app/article/[slug]/page.tsx` (new)
`export const revalidate = 300`. Cover: `<img src={"/og-image/"+slug}>`.
**AC:** AC-29, AC-30, AC-38, AC-39, INV-13.

### Task 6.3 — Create category page

**Files:** `apps/web/app/category/[slug]/page.tsx` (new)
`export const revalidate = 300`. **AC:** AC-29, AC-30.

### Task 6.4 — Create search page

**Files:** `apps/web/app/search/page.tsx` (new)
No `revalidate`. `cache: 'no-store'`. **AC:** AC-29, AC-30.

### Task 6.5 — Create OG image / cover proxy route

**Files:** `apps/web/app/og-image/[slug]/route.ts` (new)

`export const dynamic = 'force-dynamic'`. No `revalidate` export.
Missing `PUBLIC_COVER_PROXY_TRUST_SECRET` → HTTP 500 (not silent).
Deployment contract comment required in source.

**Tests:** NX-01, NX-02, NX-03; missing-secret → 500 test.
**AC:** AC-27, AC-28, AC-39, INV-13.

### Task 6.6 — Create sitemap route (paginated)

**Files:** `apps/web/app/sitemap.xml/route.ts` (new)

`export const revalidate = 3600`. Paginate with `limit=50`. Boundary =
total URL count (home + articles + categories) ≤ 50,000. Warn and stop
at boundary.

**Tests:** NX-04; pagination test (limit=50 verified); boundary test.
**AC:** AC-14, AC-29.

### Task 6.7 — Create robots.ts

**Files:** `apps/web/app/robots.ts` (new)
`MetadataRoute.Robots`. **Tests:** NX-05. **AC:** AC-56.

**Non-regression gate (Wave 6):** All web tests pass.

---

## Wave 7 — Full Integration, E2E, Non-Regression

---

### Task 7.1 — Complete Phase 5 E2E test suite

**Files:** `apps/api/test/public.e2e-spec.ts` (new)

Implements PR-01–PR-26, PB-01, PB-02.
- PR-18: title-only match → result returned; NO `<b>` assertion
- PB-02: 101st request → 429 + `Retry-After: 60`
- Whitespace `q` test: `?q=%20%20%20` → 400

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test:e2e
# Expected minimum: 57 (existing) + 28 (new) = 85 passing
```

### Task 7.2 — Complete Phase 5 unit test suite

**Files:** New `.spec.ts` files for public.service, postgres-fts.provider,
cover-rate-limit.guard, rate-limiter.redis.service.

Implements PU-01–PU-20.

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test
# Expected minimum: 58 (existing) + 20 (new) = 78 passing
```

### Task 7.3 — Complete Next.js test suite

**Files:** New test files for OG route, sitemap route, robots.ts.

Implements NX-01–NX-05 plus pagination and boundary tests.

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/web test
# Expected minimum: 5+ passing
```

### Task 7.4 — Final non-regression and acceptance gate

| Suite | Minimum |
|---|---|
| API unit (Phase 1–4 existing) | 58 |
| API unit (Phase 5 new) | 20 |
| API E2E (Phase 1–4 existing) | 57 |
| API E2E (Phase 5 new) | 28 |
| Next.js (Phase 5 new) | 5 |

All 57 AC rows from V1.5 §18 must be PASS.

**V(cmd):**
```bash
corepack pnpm --filter @dailystar/api test:ci
corepack pnpm --filter @dailystar/api test:e2e
corepack pnpm --filter @dailystar/web test:ci
corepack pnpm typecheck
corepack pnpm lint
```

**Phase 5 is complete only when this gate passes with all counts met.**

---

## Wave Dependency Graph

```
Wave 1: DB Migration & Schema
  └─ Wave 2: SearchModule & FTS Provider
       └─ Wave 3: PublicModule (Feed / Article / Category / Search)
            └─ Wave 4: Cover / S3_PUBLIC / Rate Limiting / HMAC
                 └─ Wave 5: Slug Immutability Fix
                      └─ Wave 6: Next.js Pages / OG / robots / Sitemap
                           └─ Wave 7: Integration / E2E / Non-Regression
```

Non-regression check (58 unit + 57 E2E) runs after every wave.

---

## Complete Test-to-AC Mapping

| Test | AC refs | Wave |
|---|---|---|
| PU-01 | AC-01 | W3 |
| PU-02 | AC-01, AC-08 | W3 |
| PU-03 | AC-03 | W3 |
| PU-04–06 | AC-04 | W3 |
| PU-07 | AC-09 | W4 |
| PU-08 | AC-09 | W4 |
| PU-09 | AC-55 | W2 |
| PU-10 | AC-21 | W2 |
| PU-11 | AC-25, AC-57 | W3 |
| PU-12 | AC-26 | W3 |
| PU-13 | AC-22 | W2 |
| PU-14 | AC-24 | W3 |
| PU-15 | AC-13, AC-14 | W3 |
| PU-16 | AC-43 | W3 |
| PU-17 | AC-43 | W3 |
| PU-18 | AC-40, AC-41, AC-51 | W4 |
| PU-19 | AC-52 | W4 |
| PU-20 | AC-55 | W2 |
| PR-01–04 | AC-01 | W3 |
| PR-05 | AC-23 | W3 |
| PR-06 | AC-02, AC-05, AC-13, AC-48–50 | W3 |
| PR-07–08 | AC-01 | W3 |
| PR-09 | AC-07, AC-10 | W4 |
| PR-10–12 | AC-08, AC-09 | W4 |
| PR-13–14 | AC-25, AC-57 | W3 |
| PR-15–16 | AC-26 | W3 |
| PR-17 | AC-20 | W3 |
| PR-18 | AC-21 | W3 |
| PR-19 | AC-24 | W3 |
| PR-20–24 | AC-43, AC-44, AC-45 | W3 |
| PR-25 | AC-46 | W3 |
| PR-26 | AC-47 | W3 |
| PB-01 | AC-11, AC-12, INV-04 | W5 |
| PB-02 | AC-40 | W4 |
| NX-01 | AC-28 | W6 |
| NX-02 | AC-28 | W6 |
| NX-03 | AC-27 | W6 |
| NX-04 | AC-14 | W6 |
| NX-05 | AC-56 | W6 |
| Whitespace `q` → 400 | AC-24 | W3 |
| Sitemap pagination limit=50 | design | W6 |
| Sitemap boundary total URL count | design | W6 |
| OG missing secret → 500 | design | W6 |
| Structural ancestor in category tree | AC-57 | W3 |
| Beyond-last-page → 200 | design | W3 |
| Redis UUID member uniqueness | AC-51 | W4 |
| `Retry-After` fixed at `'60'` | AC-40 | W4 |
