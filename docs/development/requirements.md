# Phase 5 Implementation Requirements

**Source of truth:** `docs/development/phase5-technical-spec-v1.5.md`
**Status:** FINAL — approved for task execution
**Repository snapshot:** Phase 0–4 complete; Phase 5 not yet started

---

## Locked Dependency Versions (Must Not Change)

| Package | Version in repo | Locked |
|---|---|---|
| `next` | `^15.1.6` | ✅ |
| `@nestjs/common` | `^10.4.15` | ✅ |
| `prisma` / `@prisma/client` | `^6.2.1` | ✅ |
| All other existing dependencies | As declared in package.json | ✅ |

**New dependency required (Wave 4):** No Redis client is installed in
`apps/api/package.json`. Phase 5 adds `ioredis` at an exact pinned version
in Task 4.0. No existing dependency versions are changed.

---

## 1. Global Prefix & Route Registration

`apps/api/src/main.ts` calls `app.setGlobalPrefix('api')`. NestJS prepends
this to every registered path.

**Controller declaration:**
```typescript
@Controller('v1/public')
```
**Resulting paths:** `/api/v1/public/...` — matches V1.5 contract exactly.

---

## 2. PostgreSQL Full-Text Search

### 2.1 Schema Addition

Add to `ArticleRevision` model in
`apps/api/src/database/prisma/schema.prisma`:

```prisma
searchVector Unsupported("tsvector")?
// PostgreSQL populates this using GENERATED ALWAYS AS ... STORED.
// Prisma never reads or writes this field.
// All FTS queries use parameterized $queryRaw.
// Declared nullable only because Prisma requires Unsupported columns
// to be nullable; the DB column itself is never NULL.
```

### 2.2 Migration

**Migration directory — created manually (NOT via `prisma migrate dev`):**
`apps/api/src/database/prisma/migrations/20260924000001_phase5_fts/`

**File:** `migration.sql`

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

**Applied via:** `prisma migrate deploy` (not `migrate dev`).

### 2.3 FTS Behavior

| Property | Value |
|---|---|
| Weights | title=A, excerpt=B, body=C |
| tsquery | `plainto_tsquery('english', $1)` |
| Ordering | `rank DESC, "publishedAt" DESC, a.id ASC` (deterministic) |
| Headline source | `ts_headline()` against **body ONLY** |
| Highlighting | `<b>...</b>` only; body matches only |
| Sanitization | Server-side; strip all HTML except `<b>` and `</b>` |
| Filter parity | COUNT query uses **identical** `WHERE` fragment as result query |
| SQL method | `Prisma.sql` tagged `$queryRaw`; never `$queryRawUnsafe` |

### 2.4 Search Endpoint Parameters (all validated; invalid → 400; no clamping)

| Parameter | Constraint | DTO validation |
|---|---|---|
| `q` | Required; trimmed; non-empty after trim; max 200 chars | `@Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200)` |
| `page` | Integer ≥ 1; default 1 | `@IsInt() @Min(1) @IsOptional()` |
| `limit` | Integer 1–20; default 10 | `@IsInt() @Min(1) @Max(20) @IsOptional()` |
| `categorySlug` | Optional string | `@IsString() @IsOptional()` |
| `tag` | Optional string, case-insensitive | `@IsString() @IsOptional()` |

**Whitespace trimming rule:** The `q` parameter is trimmed server-side before
validation. A whitespace-only input (e.g. `?q=%20%20%20`) becomes an empty
string after trimming and must be rejected with HTTP 400. Use:

```typescript
@Transform(({ value }) =>
  typeof value === 'string' ? value.trim() : value,
)
@IsString()
@IsNotEmpty()
@MaxLength(200)
q!: string;
```

**E2E requirement:** `GET /api/v1/public/search?q=%20%20%20` must return
HTTP 400 Bad Request.

---

## 3. Public API Endpoints

### 3.1 Route Table

| URL | Purpose |
|---|---|
| `GET /api/v1/public/articles` | Paginated filtered article feed |
| `GET /api/v1/public/articles/:slug` | Single published article |
| `GET /api/v1/public/articles/:slug/cover` | Cover presigned URL (rate-limited) |
| `GET /api/v1/public/categories` | Hierarchical categories |
| `GET /api/v1/public/categories/:slug/articles` | Articles in category |
| `GET /api/v1/public/search` | FTS search |

No `AuthGuard` or `PermissionGuard` on any public route (INV-10).

### 3.2 Visibility Gate — Applied to All Endpoints (INV-01)

```sql
article.status = 'PUBLISHED'
AND article."deletedAt" IS NULL
AND article."currentPublishedRevisionId" IS NOT NULL
```

### 3.3 Content Resolution (INV-02)

All content from `article.currentPublishedRevisionId` only.
`currentRevisionId` must never appear in public responses.

### 3.4 Feed Parameters (invalid → 400; no clamping)

| Parameter | Constraint | DTO |
|---|---|---|
| `page` | Integer ≥ 1; default 1 | `@Min(1)` |
| `limit` | Integer 1–50; default 20 | `@Max(50)` |
| `categoryId` | Valid UUID or absent | `@IsUUID()` |
| `categorySlug` | String or absent | `@IsString()` |
| `orderBy` | Only `publishedAt` accepted | `@IsIn(['publishedAt'])` |
| `order` | `asc` or `desc` only | `@IsIn(['asc','desc'])` |

`categoryId` takes precedence over `categorySlug`.

### 3.5 Category Hierarchy

- Max depth 3 (Phase 2 schema enforcement)
- Nested `children` arrays in response
- `publishedArticleCount` = **direct** articles only (not rolled up)
- **Structural ancestors** with zero direct articles but with visible
  descendants are **retained** in the tree
- Leaf categories with zero direct articles AND zero published descendants
  are excluded

### 3.6 Category Articles Pagination

- 404 only when: category slug does not exist OR category has zero eligible
  published articles
- Beyond-last-page: returns `{ data: [], total, page, limit }` — NOT 404

---

## 4. Public Media — Cover Endpoint

### 4.1 READY-Only Gate

404 unless:
- Article satisfies triple gate
- `article.coverMediaId IS NOT NULL`
- `Media.status = 'READY'`

### 4.2 S3_PUBLIC_ENDPOINT Rules

| Rule | Specification |
|---|---|
| Mandatory | Startup fails with clear error if absent or malformed URL |
| No fallback | Never substitute `S3_ENDPOINT`; no silent default |
| Phase 4 behavior | `generateSignedDownloadUrl()` on `StorageService` interface unchanged |
| New method | `generateSignedPublicDownloadUrl()` on concrete `MinioStorageService` only |
| Interface | `StorageService` interface is NOT modified |

### 4.3 Article-Shape DTO Cover Fields

Always present; never expire:
- `hasCoverImage: boolean`
- `coverWidth: number | null`
- `coverHeight: number | null`
- `coverMimeType: string | null`

**NEVER present:** `coverSignedUrl`, `coverExpiresAt` (INV-13).

---

## 5. Rate Limiting

### 5.1 Specification

| Property | Value |
|---|---|
| Endpoint | Cover endpoint ONLY |
| Algorithm | Atomic Redis sorted-set sliding window (Lua script) |
| Limit | 100 requests per client IP per rolling 60-second window |
| 429 header | **`Retry-After: 60`** (fixed value, not dynamic) |
| Redis unavailable | Fail-open: request allowed, warning logged |

### 5.2 Redis Client Dependency

No Redis client is currently installed. Phase 5 Task 4.0 adds `ioredis` at a
pinned exact version to `apps/api/package.json`. `ioredis` is used for Lua
script execution via `client.eval()`.

### 5.3 Lua Script Member Uniqueness

Sorted-set member IDs use a server-generated UUID (`crypto.randomUUID()`)
passed as a Lua argument. Not `math.random()`.

### 5.4 Guard Execution Order (mandatory)

```
HTTP request
  ↓
CoverRateLimitGuard.canActivate()
  1. resolveClientIp(request)
     a. Validate HMAC-signed header (timing-safe, never throws)
     b. Valid → use propagated IP
     c. Invalid or absent → use req.ip
  2. rateLimiter.checkRateLimit(clientIp)  [Lua script, atomic]
  3. Attach clientIp to request.clientIpForRateLimit
  4. If denied → response.set('Retry-After', '60') → throw 429
  5. If allowed → return true
  ↓
Controller executes
  └─ reads request.clientIpForRateLimit (no re-resolution in controller)
```

### 5.5 HMAC Verification Rules

1. If either header missing → use source IP
2. Normalize IP before computing expected HMAC
3. `expectedSig = HMAC-SHA256(secret, normalizedIp).hex`
4. Validate `sig.length === expectedSig.length` before `timingSafeEqual`
5. Wrap in try/catch; invalid hex never causes HTTP 500
6. Any failure → fall back to source IP

### 5.6 Retry-After

HTTP response always sets **`Retry-After: 60`** (fixed string per V1.5).

---

## 6. Trusted Proxy / req.ip Architecture

`apps/api/src/main.ts` does **not** configure Express `trust proxy`.
Phase 5 does not modify `main.ts`. The HMAC-signed header is the sole trusted
channel for IP propagation from Next.js. Direct callers are rate-limited by
their actual connection IP.

---

## 7. Next.js Routes

### 7.1 Route Table

| File | URL | Revalidate |
|---|---|---|
| `apps/web/app/page.tsx` | `/` | `export const revalidate = 60` |
| `apps/web/app/article/[slug]/page.tsx` | `/article/[slug]` | `export const revalidate = 300` |
| `apps/web/app/category/[slug]/page.tsx` | `/category/[slug]` | `export const revalidate = 300` |
| `apps/web/app/search/page.tsx` | `/search` | `cache: 'no-store'` on all fetches |
| `apps/web/app/og-image/[slug]/route.ts` | `/og-image/[slug]` | `export const dynamic = 'force-dynamic'` |
| `apps/web/app/sitemap.xml/route.ts` | `/sitemap.xml` | `export const revalidate = 3600` |
| `apps/web/app/robots.ts` | `/robots.txt` | Metadata API |

### 7.2 Deployment Contract (Client-IP Trust)

The public Next.js origin MUST only be reachable through the trusted
infrastructure ingress. Direct origin access that permits attacker-controlled
forwarding headers MUST be blocked at the infrastructure level. This constraint
must be documented in the OG route source code.

### 7.3 PUBLIC_COVER_PROXY_TRUST_SECRET in Next.js

- Mandatory for the OG route
- Available to the Next.js **server** runtime only (no `NEXT_PUBLIC_` prefix)
- Missing secret → log server-side error, return HTTP 500 (not silent)
- Never accessible to browser JavaScript

### 7.4 Sitemap — Paginated Retrieval & 50,000 URL Boundary

Feed endpoint max limit is 50. Sitemap paginates:
```
fetch page=1&limit=50, page=2&limit=50 ...
until data.length < 50
```

**50,000 boundary applies to total URL count:**
```
totalUrls = 1 (home) + article URLs + category URLs ≤ 50,000
```
If `totalUrls >= 50,000`, log a warning and stop. Never silently exceed
the standard sitemap limit. Multi-sitemap is a future phase deliverable.

### 7.5 robots.txt Output

```text
User-agent: *
Allow: /
Disallow: /api/
Sitemap: https://<NEXT_PUBLIC_SITE_URL>/sitemap.xml
```

---

## 8. Slug Immutability Fix (INV-04)

In `apps/api/src/modules/articles/articles.service.ts`, `update()`:

**Fix:**
```typescript
let slug = current.slug;
if (
  updateArticleDto.title &&
  updateArticleDto.title !== current.currentRevision?.title &&
  current.publishedAt === null   // Gate: never regenerate after first publication
) {
  slug = await this.generateUniqueSlug(title, tx);
}
```

Verified by mandatory E2E test PB-01.

---

## 9. Acceptance Criteria

All 57 AC rows from V1.5 §18 must pass before Phase 5 closure, plus:

| Additional criterion | Specification |
|---|---|
| `q` whitespace-only rejected | `GET /api/v1/public/search?q=%20%20%20` → HTTP 400 |
| `Retry-After` fixed at `'60'` | Never dynamic |
| DTO validation returns 400 | No value clamping |
| Category beyond-last-page → 200 | Empty data array, not 404 |
| Structural ancestors retained | Ancestors with zero direct articles retained when descendants are visible |
| Sitemap boundary is total URL count | home + articles + categories ≤ 50,000 |
| Next.js OG route fails clearly on missing secret | HTTP 500, not silent |
| Redis member uniqueness | Server-generated UUID via `crypto.randomUUID()` |
| Direct origin access blocked | Infrastructure-level enforcement documented |
