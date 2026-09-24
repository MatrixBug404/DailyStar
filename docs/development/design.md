# Phase 5 Design Document

**Source of truth:** `docs/development/phase5-technical-spec-v1.5.md`
**Status:** FINAL — approved for task execution

---

## 1. Global Prefix & Module Registration

`main.ts` calls `app.setGlobalPrefix('api')`. All Phase 5 routes use
`@Controller('v1/public')` → mounted at `/api/v1/public/...`.

Both `PublicModule` and `SearchModule` are added to `AppModule` imports.

---

## 2. Prisma Client Pattern

All Phase 1–4 services use the established singleton:

```typescript
import { prisma } from '../../database/client';
```

`apps/api/src/database/client.ts` exports `new PrismaClient()`. Phase 5
uses this same singleton. No independent `PrismaClient` lifecycle.

---

## 3. Database Layer — FTS

### 3.1 Schema Addition

```prisma
// apps/api/src/database/prisma/schema.prisma — ArticleRevision model

// Phase 5: Full-text search vector.
// PostgreSQL populates this using GENERATED ALWAYS AS ... STORED.
// Prisma never reads or writes this field.
// All FTS queries use parameterized $queryRaw.
// Declared nullable only because Prisma requires Unsupported columns
// to be nullable; the DB column itself is never NULL.
searchVector Unsupported("tsvector")?
```

### 3.2 Migration SQL

File location (created manually; NOT via `prisma migrate dev`):
`apps/api/src/database/prisma/migrations/20260924000001_phase5_fts/migration.sql`

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

Applied via `prisma migrate deploy`. This marks the authored migration
as applied without regenerating it.

### 3.3 PostgresFtsProvider — WHERE Fragment Pattern

The `buildWhereFragment()` method builds a `Prisma.Sql` fragment using
`Prisma.sql` tagged templates. This fragment is injected identically into
both the result query and the COUNT query, guaranteeing filter parity.
No `$queryRawUnsafe`. No string interpolation.

```typescript
private buildWhereFragment(
  query: string,
  categorySlug?: string,
  tag?: string,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`r."searchVector" @@ plainto_tsquery('english', ${query})`,
  ];

  if (categorySlug !== undefined) {
    conditions.push(Prisma.sql`c.slug = ${categorySlug}`);
  }

  if (tag !== undefined) {
    conditions.push(Prisma.sql`
      EXISTS (
        SELECT 1
        FROM   article_tags  at2
        JOIN   tags          t2  ON at2."tagId" = t2.id
        WHERE  at2."articleId" = a.id
          AND  LOWER(t2.name)  = LOWER(${tag})
      )
    `);
  }

  return conditions.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}
```

### 3.4 Headline Sanitization

`ts_headline()` runs against `body` only. Output is sanitized server-side:

```typescript
private sanitizeHeadline(raw: string | null): string | null {
  if (!raw) return null;
  const sanitized = raw
    .replace(/<(?!\/?b(?:\s*>))[^>]*>/gi, '')  // remove non-<b> tags
    .replace(/<b\b[^>]*>/gi,   '<b>')           // normalize <b ...> → <b>
    .replace(/<\/b\b[^>]*>/gi, '</b>');         // normalize </b ...> → </b>
  return sanitized.trim() || null;
}
```

---

## 4. Storage Service Extension

### 4.1 Interface (Unchanged)

`StorageService` interface remains as-is. Phase 4 callers unaffected.

### 4.2 MinioStorageService Dual Client

- `this.client` — internal endpoint; all Phase 4 operations unchanged
- `this.publicClient` — `S3_PUBLIC_ENDPOINT`; Phase 5 public signing only

New method on concrete class only (not on interface):
```typescript
async generateSignedPublicDownloadUrl(
  key: string,
  mimeType: string,
  expiresInSeconds: number,
): Promise<{ signedUrl: string; expiresAt: Date }>
```

### 4.3 Configuration Addition

Module-level validation function (not a class method):
```typescript
function requirePublicEndpoint(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      '[Phase 5] S3_PUBLIC_ENDPOINT is required for public cover signing. ' +
      'Set it to a browser-reachable URL. Must NOT fall back to S3_ENDPOINT.',
    );
  }
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error(`Must use http or https: "${value}"`);
    }
    return value;
  } catch {
    throw new Error(`[Phase 5] S3_PUBLIC_ENDPOINT is not a valid URL: "${value}"`);
  }
}
```

Added to `configuration.ts`:
```typescript
storage: {
  endpoint:        process.env.S3_ENDPOINT          ?? 'http://localhost:9000',
  publicEndpoint:  requirePublicEndpoint(process.env.S3_PUBLIC_ENDPOINT),
  // ...existing keys unchanged
}
```

---

## 5. Rate Limiting Architecture

### 5.1 Redis Dependency

Phase 5 adds `ioredis` (pinned exact version) via Task 4.0.

### 5.2 Lua Script (Atomic Sliding Window)

```lua
-- KEYS[1] = rate-limit key
-- ARGV[1] = now (ms), ARGV[2] = window_start, ARGV[3] = max_requests
-- ARGV[4] = window_ms, ARGV[5] = request_uuid (server-generated)

local key          = KEYS[1]
local now          = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local window_ms    = tonumber(ARGV[4])
local request_id   = ARGV[5]          -- server-generated UUID

redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
local count = redis.call('ZCARD', key)
if count >= max_requests then
  return 0
end
redis.call('ZADD', key, now, request_id)
redis.call('EXPIRE', key, math.ceil(window_ms / 1000) + 10)
return 1
```

Member uniqueness: `request_id = randomUUID()` passed from Node.js.
Not `math.random()`.

### 5.3 CoverRateLimitGuard — canActivate() Steps

1. `resolveClientIp(req)` — HMAC validate or fall back to `req.ip`
2. `rateLimiter.checkRateLimit(clientIp)`
3. `(req as any).clientIpForRateLimit = clientIp`
4. If denied: `res.set('Retry-After', '60')` → throw `HttpException(429)`
5. Return `true`

`Retry-After` is always the string `'60'` (fixed, per V1.5).

### 5.4 HMAC Verification (shared helper, never throws)

```typescript
private verifySignature(ip: string, sig: string): boolean {
  try {
    const normalized = this.normalizeIp(ip);
    const expected   = createHmac('sha256', this.trustSecret)
      .update(normalized).digest('hex');
    if (sig.length !== expected.length) return false;
    return timingSafeEqual(
      Buffer.from(sig,      'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}
```

---

## 6. SearchQueryDto — Whitespace Trimming

```typescript
// apps/api/src/modules/search/dto/search-query.dto.ts

import { Transform } from 'class-transformer';
import { IsString, IsNotEmpty, MaxLength, IsInt, Min, Max, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchQueryDto {
  // Trim before validation so whitespace-only input is rejected as empty
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q!: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page: number = 1;

  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  @IsOptional()
  limit: number = 10;

  @IsString()
  @IsOptional()
  categorySlug?: string;

  @IsString()
  @IsOptional()
  tag?: string;
}
```

E2E requirement: `GET /api/v1/public/search?q=%20%20%20` → HTTP 400.

---

## 7. PublicController

```typescript
@Controller('v1/public')
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Get('articles')
  getArticles(@Query() q: PublicFeedQueryDto) { return this.svc.getArticles(q); }

  @Get('articles/:slug')
  getArticle(@Param('slug') slug: string) { return this.svc.getArticle(slug); }

  @Get('articles/:slug/cover')
  @UseGuards(CoverRateLimitGuard)
  getCover(@Param('slug') slug: string, @Req() req: any) {
    // clientIpForRateLimit is set by the guard; controller does not re-resolve
    return this.svc.getCover(slug);
  }

  @Get('categories')
  getCategories() { return this.svc.getCategories(); }

  @Get('categories/:slug/articles')
  getCategoryArticles(
    @Param('slug') slug: string,
    @Query() q: CategoryArticlesQueryDto,
  ) { return this.svc.getCategoryArticles(slug, q); }

  @Get('search')
  search(@Query() q: SearchQueryDto) { return this.svc.search(q); }
}
```

---

## 8. Category Hierarchy — Structural Ancestor Rule

Categories are included in the public tree if:
- They have ≥1 direct published article, OR
- They are a structural ancestor of a category that has ≥1 direct published article

`publishedArticleCount` always reflects the direct count only (never rolled up).

An ancestor with `publishedArticleCount = 0` but visible descendants appears
in the tree with count 0 to preserve hierarchy structure.

---

## 9. Next.js OG Image Route — Secret Handling

```typescript
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ...) {
  const secret = process.env.PUBLIC_COVER_PROXY_TRUST_SECRET;
  if (!secret) {
    // Mandatory: fail clearly on server side; never send empty signature
    console.error('[og-image] PUBLIC_COVER_PROXY_TRUST_SECRET is not set');
    return new NextResponse(null, { status: 500 });
  }
  // ...
}
```

---

## 10. Sitemap — Correct URL Boundary

The 50,000 limit applies to the **total URL count** (home + articles +
categories combined), not just article count:

```typescript
const SITEMAP_MAX_URLS = 50_000;
// urls[] starts with the home entry (count = 1)
// Article URLs added while urls.length < SITEMAP_MAX_URLS
// Category URLs added while urls.length < SITEMAP_MAX_URLS
// Boundary hit → console.warn → stop
```

Articles fetched via pagination: `?page=N&limit=50` until `data.length < 50`.
Never `?limit=10000` or any value exceeding the endpoint's maximum of 50.

---

## 11. Repository / Spec Discrepancy Report

| # | Component | Repo state | V1.5 requirement | Discrepancy? | Resolution |
|---|---|---|---|---|---|
| 1 | `ArticleRevision.searchVector` | Absent | Add `Unsupported("tsvector")?` | None — Phase 5 not started | Wave 1 |
| 2 | FTS migration | Does not exist | `20260924000001_phase5_fts` | None | Wave 1 |
| 3 | `MinioStorageService` | Single S3Client; no public method | Dual client + new public method | None | Wave 4 |
| 4 | `StorageService` interface | `generateSignedDownloadUrl()` only | New method on concrete class only | None — interface unchanged by design | Wave 4 |
| 5 | `configuration.ts` | No `publicEndpoint` | Validated `storage.publicEndpoint` | None | Wave 4 |
| 6 | **`ArticlesService.update()`** | **Unconditional slug regen on title change** | **Gate: `publishedAt === null`** | **CONFIRMED CODE DEFECT (V1.5 §12.1)** | Wave 5 |
| 7 | Redis client | **`ioredis` NOT in `apps/api/package.json`** | Rate limiter requires Redis client | **MISSING DEPENDENCY** | Wave 4 Task 4.0 |
| 8 | `PublicModule` | Does not exist | Create with 6 endpoints | None | Waves 3–4 |
| 9 | `SearchModule` | Does not exist | `PostgresFtsProvider` | None | Wave 2 |
| 10 | Rate limiting | Does not exist | Redis sliding window + HMAC guard | None | Wave 4 |
| 11 | Next.js pages | Phase 0 only | Full Phase 5 routes | None | Wave 6 |
| 12 | `app/robots.ts` | Does not exist | Metadata API | None | Wave 6 |
| 13 | `main.ts` trust proxy | Not configured | Phase 5 uses `req.ip` directly; HMAC for Next.js path | None — design accounts for this | No change to `main.ts` |
| 14 | `next.config.ts` | No proxy settings | Phase 5 adds none | None | No change |
| 15 | `.env.example` | No Phase 5 vars | Three new vars | None | Waves 4 + 6 |
| 16 | Prisma | `^6.2.1` | Same | None | Locked |
| 17 | Next.js | `^15.1.6` | Same | None | Locked |
| 18 | NestJS | `^10.4.15` | Same | None | Locked |
