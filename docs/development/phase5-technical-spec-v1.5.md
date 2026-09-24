# Phase 5 Technical Specification — V1.5

**Document Status:** FINAL — Approved for implementation planning
**Revision:** 1.5 (supersedes V1.4, V1.3, V1.2, and V1.1 in full)
**Date:** 2026-09-24
**Prepared by:** Engineering review (derived from V1.4; no unapproved scope added)

> [!NOTE]
> V1.5 is a focused correctness revision of V1.4. The Phase 5 architecture remains unchanged except for the explicitly locked clarifications in this revision.

> [!IMPORTANT]
> This specification is the sole authoritative Phase 5 architecture and design contract.
> Antigravity may create an implementation plan only after this specification is accepted by the human engineering lead.
> Do not write implementation code. Do not create the Antigravity implementation plan. Do not invent additional scope.

### V1.5 Focused Corrections

- Rate limiting is now defined as an atomic Redis sorted-set rolling-window algorithm rather than an ambiguous counter.
- End-user IP is propagated from the Next.js `/og-image/[slug]` route to the NestJS cover endpoint through a server-only HMAC-signed header; unsigned/invalid values are ignored.
- `S3_PUBLIC_ENDPOINT` is mandatory for public signing; it never falls back to `S3_ENDPOINT`.
- Existing Phase 4 `generateSignedDownloadUrl()` behavior is preserved; Phase 5 uses a dedicated public-signing method.
- FTS pagination ordering is deterministic (`rank DESC`, `publishedAt DESC`, `Article.id ASC`) and count-query filter parity is locked.
- `robots.txt` is restored as a Phase 5 deliverable.
- Public category hierarchy is preserved through depth 3 with nested `children`.

---

## Table of Contents

1. [Executive Summary and Deliverables](#1-executive-summary-and-deliverables)
2. [Scope and Boundaries](#2-scope-and-boundaries)
3. [Preserved Phase 1–4 Invariants](#3-preserved-phase-14-invariants)
4. [Architecture Overview](#4-architecture-overview)
5. [Database Layer — FTS Schema Extension](#5-database-layer--fts-schema-extension)
6. [Storage — Browser-Reachable Presigned URLs](#6-storage--browser-reachable-presigned-urls)
7. [Public API Endpoints — Authoritative Contract](#7-public-api-endpoints--authoritative-contract)
8. [Cover Endpoint Rate Limiting](#8-cover-endpoint-rate-limiting)
9. [Public Response DTOs](#9-public-response-dtos)
10. [Full-Text Search Design](#10-full-text-search-design)
11. [Category Zero-Article Behavior](#11-category-zero-article-behavior)
12. [Slug Immutability Fix](#12-slug-immutability-fix)
13. [OG Image / Cover Image Route — OD-06 Locked](#13-og-image--cover-image-route--od-06-locked)
14. [Next.js Frontend Pages](#14-nextjs-frontend-pages)
15. [Sitemap](#15-sitemap)
16. [Open Graph and SEO Metadata](#16-open-graph-and-seo-metadata)
17. [Phase 5 Test Plan](#17-phase-5-test-plan)
18. [Acceptance Criteria Matrix](#18-acceptance-criteria-matrix)
19. [Open Decisions](#19-open-decisions)
20. [Appendix A — File Inventory](#appendix-a--file-inventory)
21. [Appendix B — Invariant Cross-Reference](#appendix-b--invariant-cross-reference)

---

## 1. Executive Summary and Deliverables

Phase 5 delivers the **public-facing read layer** of DailyStar: the set of unauthenticated NestJS API endpoints and Next.js pages that allow the public internet to discover, read, and search published articles.

Phase 5 is strictly additive and read-only relative to Phases 1–4. No editorial workflow, authentication, RBAC, or media upload paths are changed.

### Deliverables

| # | Deliverable | Type |
|---|---|---|
| D1 | `GET /api/v1/public/articles` — paginated, filtered published article feed | New |
| D2 | `GET /api/v1/public/articles/:slug` — single published article | New |
| D3 | `GET /api/v1/public/articles/:slug/cover` — slug-scoped cover presigned URL (rate-limited) | New |
| D4 | `GET /api/v1/public/categories` — categories with >= 1 published article | New |
| D5 | `GET /api/v1/public/categories/:slug/articles` — filtered articles in category | New |
| D6 | `GET /api/v1/public/search` — PostgreSQL FTS search with optional filters | New |
| D7 | PostgreSQL weighted `tsvector` generated column + GIN index migration | New |
| D8 | `PublicModule` + `SearchModule` with `PostgresFtsProvider` | New |
| D9 | `S3_PUBLIC_ENDPOINT` env var + configuration key for browser-reachable presigned URLs | New |
| D10 | Slug immutability fix in `ArticlesService.update()` | Fix |
| D11 | Next.js pages: `/`, `/article/[slug]`, `/category/[slug]`, `/search` | New |
| D12 | Next.js route: `/og-image/[slug]` — dynamic 302 (also serves as browser-facing cover `<img>` src) | New |
| D13 | Next.js route: `/sitemap.xml` — dynamic, ISR 3600 s | New |
| D14 | Redis-backed sliding-window rate limiter for the cover endpoint (100 req/client-IP/60 s) with trusted client-IP propagation | New |
| D15 | `robots.txt` via Next.js Metadata API / route equivalent | New |
| D16 | Phase 5 unit tests (min 20) + E2E tests (min 28) + Next.js tests (min 5) | New |

---

## 2. Scope and Boundaries

### In Scope

- All items in Section 1 Deliverables.
- `PublicModule` with `PublicController` and `PublicService` — no auth guards.
- `SearchModule` with `SearchService` interface and `PostgresFtsProvider`.
- Prisma schema addition: `searchVector Unsupported("tsvector")?` on `ArticleRevision`.
- New Prisma migration with raw SQL: weighted generated tsvector column + GIN index.
- `S3_PUBLIC_ENDPOINT` environment variable and configuration key.
- Slug immutability fix for post-publication title updates.
- All six locked ISR values (Section 14.2).
- Redis-backed sliding-window rate limiter on the cover endpoint (Section 8).
- Public feed/category/search filter query parameters (Section 7).
- All Phase 5 tests.
- Trusted client-IP propagation from the Next.js `/og-image/[slug]` route to the NestJS cover endpoint for rate-limiting purposes.
- `robots.txt` with the locked public-site crawl policy.

### Explicitly Out of Scope (Not Phase 5)

- Media cleanup / orphan management — deferred beyond Phase 5.
- Comments, reader accounts, notifications.
- Redis caching of public API responses (distinct from the rate-limiter's Redis usage).
- Elasticsearch / OpenSearch migration.
- AI-generated content surfaced publicly.
- JSON-LD / structured data — explicitly deferred beyond Phase 5.
- Any change to auth, RBAC, or media upload paths.
- Any upgrade of Next.js, NestJS, or Prisma.
- Sitemap index (multi-sitemap) — documented as a future strategy for > 50,000 URLs; not implemented in Phase 5.
- Rate limiting on authenticated CMS routes — not Phase 5 scope.

---

## 3. Preserved Phase 1–4 Invariants

The following rules are immutable in Phase 5. No Phase 5 code may weaken or contradict them.

| ID | Invariant | Source |
|---|---|---|
| INV-01 | **Published-only triple gate.** Every public read path enforces: `article.status = 'PUBLISHED' AND article.deletedAt IS NULL AND article.currentPublishedRevisionId IS NOT NULL`. | Phase 2/3 |
| INV-02 | **currentPublishedRevisionId is the sole public content pointer.** Public responses must never resolve content from `currentRevisionId` or any other revision pointer. | Phase 2/3 |
| INV-03 | **Plain-text body.** `ArticleRevision.body` is stored as plain text. Public API returns it verbatim. No HTML transformation at the API layer. | Phase 2 |
| INV-04 | **Slug immutability after first publication.** Once `Article.publishedAt IS NOT NULL`, `Article.slug` must never change regardless of title updates. (Phase 5 adds the fix that enforces this — see Section 12.) | Phase 2 |
| INV-05 | **Private bucket.** The MinIO/S3 bucket is private. No object is directly browser-reachable without a presigned URL. The bucket ACL must not be changed. | Phase 4 |
| INV-06 | **Browser-reachable presigned URLs.** Presigned URLs must resolve via a hostname reachable by the end-user's browser, not a Docker-internal hostname. (Phase 5 introduces `S3_PUBLIC_ENDPOINT` to enforce this — see Section 6.) | Phase 4 |
| INV-07 | **Server-side headline sanitization.** `ts_headline` output must be sanitized server-side. Only `<b>` and `</b>` tags may be forwarded to clients. | Phase 5 |
| INV-08 | **Parameterized FTS SQL.** All `$queryRaw` calls must use parameterized placeholders. No string interpolation in SQL. | Phase 5 |
| INV-09 | **WorkflowModule is sole Article.status mutator.** No Phase 5 code mutates `Article.status`. | Phase 3 |
| INV-10 | **Public API has no auth guards.** `PublicController` carries no `AuthGuard` or `PermissionGuard`. | Phase 5 |
| INV-11 | **Media cleanup deferred.** Orphaned object cleanup remains out of scope. | Phase 4 |
| INV-12 | **Phase 1–4 non-regression.** All 58 existing unit tests and all 57 existing E2E tests must continue to pass unchanged. | All phases |
| INV-13 | **No presigned URL in ISR HTML.** ISR-cached article pages must not embed MinIO presigned URLs. Browser-facing cover images use the stable same-origin `/og-image/[slug]` URL. | Phase 5 |
| INV-14 | **Public signing endpoint is explicit.** Public presigned URLs must be generated from `S3_PUBLIC_ENDPOINT`; no fallback to `S3_ENDPOINT` is permitted for public signing. | Phase 5 |
| INV-15 | **Phase 4 signing behavior is preserved.** Existing `generateSignedDownloadUrl()` semantics remain unchanged; Phase 5 uses a dedicated public-signing method/client. | Phase 5 |

---

## 4. Architecture Overview

### 4.1 Next.js Version

The implementation **must use the Next.js version declared in `apps/web/package.json`** (`^15.1.6` as of the current repository snapshot). The implementation plan must verify the exact installed version and use compatible APIs. **Next.js must not be upgraded as part of Phase 5.**

### 4.2 Prisma and FTS Rationale (Corrected)

Prisma version: `^6.2.1`. Prisma 6.x **does** support PostgreSQL GIN index access methods via `@@index([field], type: Gin)`. The reason Phase 5 uses raw SQL for the `searchVector` column and GIN index is **not** a lack of Prisma GIN support. The reasons are:

1. **Generated column DDL.** Phase 5 uses `GENERATED ALWAYS AS ... STORED` with a `to_tsvector(...)` + `setweight(...)` expression. Prisma's schema language cannot model this DDL. `Unsupported("tsvector")?` marks the column opaque to Prisma.
2. **Unreadable type.** `tsvector` cannot be read or written by Prisma client methods. All FTS queries go through `$queryRaw`.
3. **Index dependency.** The GIN index over the generated column must be created via raw SQL since the column is `Unsupported` in Prisma.

The architecture is: `Unsupported("tsvector")?` in the Prisma schema + raw SQL migration for the generated column and GIN index + all FTS queries via parameterized `$queryRaw`.

### 4.3 Component Map

```
Public Internet
    | HTTPS
    v
Next.js (apps/web)
    |-- /                       -- Home feed (ISR 60 s)
    |-- /article/[slug]         -- Article page (ISR 300 s)
    |   +-- <img src="/og-image/[slug]">   (stable cover URL, no presigned URL)
    |-- /category/[slug]        -- Category page (ISR 300 s)
    |-- /search                 -- Search page (no-store)
    |-- /og-image/[slug]        -- Cover image + OG route (force-dynamic, 302 → presigned URL)
    +-- /sitemap.xml            -- Sitemap (ISR 3600 s)
         | REST, no auth header
         v
NestJS (apps/api)
    +-- PublicModule  (no AuthGuard / PermissionGuard)
         |-- GET /api/v1/public/articles          (filtered, paginated)
         |-- GET /api/v1/public/articles/:slug
         |-- GET /api/v1/public/articles/:slug/cover  (rate-limited: 100/IP/60s)
         |-- GET /api/v1/public/categories
         |-- GET /api/v1/public/categories/:slug/articles  (filtered, paginated)
         +-- GET /api/v1/public/search             (filtered, paginated)
                  |
         SearchModule
         +-- PostgresFtsProvider ($queryRaw, weighted tsvector)
                  |
         PostgreSQL
         +-- article_revisions."searchVector"
               (tsvector GENERATED ALWAYS AS STORED, GIN index)
                  |
         Redis (rate-limiter sliding window)
                  |
         MinIO (private bucket)
         +-- presigned URLs generated from S3_PUBLIC_ENDPOINT
```

---

## 5. Database Layer — FTS Schema Extension

### 5.1 Prisma Schema Addition

Add `searchVector` to `ArticleRevision` in [`schema.prisma`](file:///c:/Users/ASUS/Downloads/Yatharth/DailyStar/apps/api/src/database/prisma/schema.prisma):

```prisma
model ArticleRevision {
  // ... all existing fields unchanged ...
  searchVector  Unsupported("tsvector")?
  // Populated by PostgreSQL GENERATED ALWAYS AS ... STORED.
  // Never written by Prisma. Queried only via $queryRaw.
  // Nullable in Prisma schema only because Unsupported columns
  // must be declared nullable; the DB column is never actually NULL.
}
```

### 5.2 Raw SQL Migration

New migration: `20260924000001_phase5_fts`

```sql
-- =============================================================================
-- Phase 5: Full-Text Search — Weighted Generated tsvector Column + GIN Index
-- =============================================================================
-- NOTE: Raw SQL is required here because:
--   1. PostgreSQL GENERATED ALWAYS AS ... STORED DDL cannot be expressed
--      in Prisma's schema language for a tsvector expression.
--   2. Prisma 6.x supports GIN indexes generally (via @@index type: Gin),
--      but cannot create a GIN index over an Unsupported generated column.
-- These raw SQL statements are the authoritative DDL for FTS in Phase 5.
-- =============================================================================

ALTER TABLE article_revisions
  ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title,    '')), 'A')
   || setweight(to_tsvector('english', coalesce(excerpt,  '')), 'B')
   || setweight(to_tsvector('english', coalesce(body,     '')), 'C')
  ) STORED;

CREATE INDEX "article_revisions_searchVector_idx"
  ON article_revisions
  USING GIN ("searchVector");
```

### 5.3 FTS Column Semantics

| Field | Weight | Participation |
|---|---|---|
| `title` | A (highest) | Matching, ranking |
| `excerpt` | B | Matching, ranking |
| `body` | C | Matching, ranking, `ts_headline` source |

- The column is maintained entirely by PostgreSQL. No application code writes it.
- It is automatically updated when `title`, `excerpt`, or `body` changes (GENERATED ALWAYS AS ... STORED).
- All FTS queries use parameterized `$queryRaw` (INV-08).

---

## 6. Storage — Browser-Reachable Presigned URLs

### 6.1 Problem

The existing [`MinioStorageService`](file:///c:/Users/ASUS/Downloads/Yatharth/DailyStar/apps/api/src/modules/media/storage/minio-storage.service.ts) initializes its `S3Client` from `storage.endpoint` (`S3_ENDPOINT`), which in Docker Compose is typically an internal hostname (e.g., `http://minio:9000`). Presigned URLs generated from an internal hostname are **not** reachable by a browser.

### 6.2 Solution: S3_PUBLIC_ENDPOINT

Phase 5 introduces a new environment variable and configuration key:

**New env var:** `S3_PUBLIC_ENDPOINT`

**Semantics:**
- `S3_PUBLIC_ENDPOINT` is the hostname/port that a **browser** uses to reach MinIO/S3.
- `S3_ENDPOINT` remains the internal hostname used by the NestJS server for API calls (upload, delete, head).
- Presigned URL generation must use `S3_PUBLIC_ENDPOINT`.

**Example `.env`:**

```bash
# Server-side API calls (upload, delete, head) — may be Docker-internal
S3_ENDPOINT=http://minio:9000

# Presigned URL generation — must be browser-reachable
S3_PUBLIC_ENDPOINT=http://localhost:9000

# Server-only secret shared by Next.js server runtime and NestJS API
# Used only to authenticate trusted client-IP propagation for cover rate limiting
PUBLIC_COVER_PROXY_TRUST_SECRET=<strong-random-server-secret>
```

In production (AWS S3), `S3_PUBLIC_ENDPOINT` is typically `https://s3.amazonaws.com` or the bucket's regional endpoint. When both are set to the same value (e.g., in a single-host deployment), behavior is identical to the current setup.

### 6.3 Configuration Change

Add to [`configuration.ts`](file:///c:/Users/ASUS/Downloads/Yatharth/DailyStar/apps/api/src/config/configuration.ts):

```typescript
storage: {
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT,
  // ... existing keys unchanged ...
},
```

**Mandatory configuration rule:** `S3_PUBLIC_ENDPOINT` is required for Phase 5 public cover signing. The application must not silently substitute `S3_ENDPOINT` when `S3_PUBLIC_ENDPOINT` is absent. Configuration/startup validation must fail clearly when the public signing endpoint is required but missing.

Local development example remains: `S3_ENDPOINT=http://minio:9000` and `S3_PUBLIC_ENDPOINT=http://localhost:9000`.

### 6.4 MinioStorageService Change

`MinioStorageService` must maintain **two** S3Client instances:

- `this.client` — initialized from `storage.endpoint`. Existing upload, delete, head, and authenticated media operations continue to use this client and their existing methods.
- `this.publicClient` — initialized from `storage.publicEndpoint`. Used only by the new Phase 5 public-signing method.

The bucket name and credentials are identical for both clients.

**Phase 4 compatibility requirement:** existing `generateSignedDownloadUrl()` behavior must remain unchanged. Add a dedicated method (e.g. `generateSignedPublicDownloadUrl()`) for Phase 5's public cover endpoint; do not globally redirect existing callers to the public client.

---

## 7. Public API Endpoints — Authoritative Contract

### 7.1 Universal Rules

All six endpoints below:

- Are mounted in `PublicModule` under the existing global prefix `api/v1`.
- Carry **no** `AuthGuard` or `PermissionGuard` (INV-10).
- Enforce the **published-only triple gate** (INV-01) on every query:

```sql
article.status = 'PUBLISHED'
AND article."deletedAt" IS NULL
AND article."currentPublishedRevisionId" IS NOT NULL
```

- Resolve all public content through `article.currentPublishedRevisionId` exclusively (INV-02).
- All filter query parameters operate only over articles satisfying the triple gate.

### 7.2 `GET /api/v1/public/articles` — Feed

**Purpose:** Paginated, filterable list of published articles.

**Query parameters:**

| Parameter | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `page` | integer | 1 | >= 1 | Page number |
| `limit` | integer | 20 | max **50** | Items per page |
| `categoryId` | UUID string | — | Valid UUID or `400` | Filter by category ID |
| `categorySlug` | string | — | — | Filter by category slug |
| `tag` | string | — | Case-insensitive match | Filter by tag name |
| `orderBy` | string | `publishedAt` | Only `publishedAt` in Phase 5; unsupported value → `400` | Sort field |
| `order` | string | `desc` | `asc` or `desc`; unsupported value → `400` | Sort direction |

**Filter precedence:** If both `categoryId` and `categorySlug` are supplied, `categoryId` wins. `categorySlug` is ignored.

**Validation:**
- `categoryId` with invalid UUID format → `400 Bad Request`.
- `orderBy` with unsupported value → `400 Bad Request`.
- `order` with value other than `asc` or `desc` → `400 Bad Request`.

**Response `200 OK`:**

```jsonc
{
  "data": [ /* PublicArticleSummary[] — see Section 9.2 */ ],
  "total": 142,
  "page": 1,
  "limit": 20
}
```

**Default ordering:** `ORDER BY a."publishedAt" DESC` (when `orderBy=publishedAt` and `order=desc`).

### 7.3 `GET /api/v1/public/articles/:slug` — Single Article

**Purpose:** Full content of a single published article.

**Path parameter:** `slug`

**Response `200 OK`:** `PublicArticleFull` (see Section 9.3)

**Error `404 Not Found`:** Article does not satisfy the triple gate.

### 7.4 `GET /api/v1/public/articles/:slug/cover` — Cover Presigned URL

**Purpose:** Generate a fresh presigned URL for the article's READY cover image.

**Rate limit:** 100 requests per IP per 60 seconds. See Section 8.

**Authorization boundary (enforced server-side, no auth token required):**

1. Article satisfies the published-only triple gate.
2. `article.coverMediaId IS NOT NULL`.
3. `Media.status = 'READY'`.

**Presigned URL generation:** Uses `S3_PUBLIC_ENDPOINT` (INV-06).

**Response `200 OK`:**

```jsonc
{
  "signedUrl":  "https://localhost:9000/...",
  "expiresAt":  "2026-09-24T11:30:00.000Z",
  "mimeType":   "image/jpeg",
  "width":      1920,
  "height":     1080
}
```

**Errors:**

| Condition | Status |
|---|---|
| Rate limit exceeded | `429 Too Many Requests` (see Section 8) |
| Article not found / not PUBLISHED / deleted / no currentPublishedRevisionId | `404 Not Found` |
| `coverMediaId` is null | `404 Not Found` |
| `Media.status != READY` | `404 Not Found` |

> [!IMPORTANT]
> **This is the only public cover delivery endpoint.** There is no generic `/public/media/:id/cover-proxy` route. Cover access is scoped to published article slugs, not bare media UUIDs, so the authorization boundary (published article + READY media) is enforced atomically by a single endpoint.

### 7.5 `GET /api/v1/public/categories` — Category Listing

**Purpose:** List categories that have at least one published article satisfying the triple gate.

**Response `200 OK`:**

```jsonc
[
  {
    "id": "uuid",
    "name": "Politics",
    "slug": "politics",
    "parentId": null,
    "publishedArticleCount": 14,
    "children": [
      {
        "id": "uuid",
        "name": "Elections",
        "slug": "elections",
        "parentId": "parent-uuid",
        "publishedArticleCount": 8,
        "children": []
      }
    ]
  }
]
```

**Filter:** `COUNT(articles satisfying triple gate AND article.categoryId = category.id) >= 1`. Categories with zero qualifying direct articles are excluded from the public category tree.

**Hierarchy:** Preserve the existing Phase 2 category hierarchy up to depth 3, with nested `children` arrays. `publishedArticleCount` remains the count of qualifying articles directly assigned to that category; counts are not rolled up from descendants.

### 7.6 `GET /api/v1/public/categories/:slug/articles` — Category Articles

**Purpose:** Paginated, filterable published articles for a specific category.

**Path parameter:** `slug` — category slug.

**Query parameters:**

| Parameter | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `page` | integer | 1 | >= 1 | Page number |
| `limit` | integer | 20 | max **50** | Items per page |
| `tag` | string | — | Case-insensitive match | Filter by tag name |
| `orderBy` | string | `publishedAt` | Only `publishedAt` in Phase 5; unsupported → `400` | Sort field |
| `order` | string | `desc` | `asc` or `desc`; unsupported → `400` | Sort direction |

**Responses:**

| Condition | Status |
|---|---|
| Category slug does not exist | `404 Not Found` |
| Category exists but has zero published articles satisfying triple gate | `404 Not Found` |
| Category exists and has >= 1 qualifying articles | `200 OK` |

**`200 OK` body:** Pagination envelope with `PublicArticleSummary[]` (Section 9.2).

### 7.7 `GET /api/v1/public/search` — FTS Search

**Purpose:** Full-text search over published articles with optional filters.

**Query parameters:**

| Parameter | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `q` | string | (required) | Max 200 chars; empty → `400` | Search query |
| `page` | integer | 1 | >= 1 | Page number |
| `limit` | integer | **10** | max **20** | Items per page |
| `categorySlug` | string | — | — | Filter results by category slug |
| `tag` | string | — | Case-insensitive match | Filter results by tag name |

**Response `200 OK`:**

```jsonc
{
  "data":  [ /* PublicSearchResult[] — see Section 9.4 */ ],
  "total": 7,
  "page":  1,
  "limit": 10,
  "query": "climate"
}
```

**Error `400 Bad Request`:** `q` is absent or empty after trimming.

---

## 8. Cover Endpoint Rate Limiting

### 8.1 Specification

| Property | Value |
|---|---|
| Endpoint | `GET /api/v1/public/articles/:slug/cover` |
| Limit | **100 requests per client IP per rolling 60 seconds** |
| Algorithm | **Atomic Redis sorted-set sliding window** |
| Exceeded response | `429 Too Many Requests` |
| `Retry-After` header | `60` (seconds) |
| Redis unavailable behavior | **Fail-open** — requests are allowed without rate checking |

### 8.2 True Sliding-Window Algorithm

The implementation must provide true rolling-window semantics, not a fixed-window counter. The exact Redis primitive may vary, but semantics are locked:

1. Resolve the effective client IP (see §8.3).
2. Use a Redis sorted set keyed by client identity, e.g. `rl:cover:<ip>`.
3. Remove entries older than `now - 60 seconds`.
4. Count entries remaining in the set.
5. If the count is already 100 or more, reject with `429` and `Retry-After: 60`.
6. Otherwise add a unique request entry scored with the current timestamp.
7. Ensure cleanup/count/add is atomic (Lua script, transaction, or equivalent atomic Redis operation) so concurrent requests cannot bypass the limit.
8. Set a short key expiry so inactive limiter keys disappear automatically.

If Redis is unavailable, the rate limiter fails open and logs a warning; it must not make the public cover endpoint unavailable.

### 8.3 Effective Client-IP Resolution

The article page and social crawlers request the Next.js `/og-image/[slug]` route. Next.js then makes the server-to-server request to the NestJS cover endpoint. Therefore, the NestJS request's network peer is normally the Next.js server, not the end user's browser. The rate limiter must not treat the Next.js server IP as the browser's identity.

Phase 5 therefore uses a trusted, signed client-IP propagation mechanism:

1. `GET /og-image/[slug]` obtains the end-user IP from the deployment platform's trusted request metadata / proxy chain. The implementation must not trust an arbitrary browser-supplied forwarding header.
2. Next.js sends two server-to-server headers to the cover endpoint:
   - `X-DailyStar-Client-IP: <canonical-client-ip>`
   - `X-DailyStar-Client-IP-Signature: <HMAC-SHA256(secret, canonical-client-ip)>`
3. The API validates the signature using the server-only `PUBLIC_COVER_PROXY_TRUST_SECRET`. Only a valid signature makes the propagated IP eligible for the client-IP rate-limit key.
4. If the header is missing or the signature is invalid, the API ignores the propagated IP and falls back to the actual source IP resolved by the API's trusted proxy configuration. Direct public callers therefore remain rate-limited by their own source IP.
5. `PUBLIC_COVER_PROXY_TRUST_SECRET` is server-only and must never be exposed to browser JavaScript.

The exact framework helper for trusted client-IP extraction is implementation-specific, but the above trust boundary and signed-header semantics are mandatory.

### 8.4 Scope

- Rate limiting applies **only** to `GET /api/v1/public/articles/:slug/cover`.
- The 100/IP/60s client limit follows the real end-user IP through the trusted signed propagation path when the request originated from Next.js.
- Rate limiting does **not** apply to any other public endpoint or to any authenticated CMS route.

### 8.5 Response Format (429)

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{
  "statusCode": 429,
  "message": "Too many requests",
  "error": "Too Many Requests"
}
```

---

## 9. Public Response DTOs

### 9.1 Cover Fields in Article DTOs

> [!WARNING]
> `coverSignedUrl` and `coverExpiresAt` are **never** included in feed, article, category, or search response DTOs. Cover presigned URLs are available only via the dedicated `GET /api/v1/public/articles/:slug/cover` endpoint (Section 7.4). This prevents caching stale presigned URLs inside ISR-cached or larger responses (INV-13).

Article-shape DTOs may include:

- `hasCoverImage: boolean` — true iff `coverMediaId IS NOT NULL AND Media.status = 'READY'`
- `coverWidth: number | null`
- `coverHeight: number | null`
- `coverMimeType: string | null`

These metadata fields do not expire and are safe to include in ISR-cached responses.

### 9.2 PublicArticleSummary

Returned by `GET /api/v1/public/articles` (feed) and `GET /api/v1/public/categories/:slug/articles`.

```typescript
interface PublicArticleSummary {
  id:                         string;        // Article.id (UUID)
  slug:                       string;
  title:                      string;        // currentPublishedRevision.title
  excerpt:                    string | null; // currentPublishedRevision.excerpt
  publishedAt:                string;        // Article.publishedAt — ISO 8601
  publishedRevisionCreatedAt: string;        // currentPublishedRevision.createdAt — ISO 8601
  hasCoverImage:              boolean;       // coverMediaId IS NOT NULL AND Media.status = READY
  coverWidth:                 number | null;
  coverHeight:                number | null;
  coverMimeType:              string | null;
  category: {
    id:   string;
    name: string;
    slug: string;
  } | null;
  author: {
    displayName: string;
    bio:         string | null;
    avatarUrl:   string | null;
  };
  tags: string[];
}
```

**`publishedRevisionCreatedAt`** is the `createdAt` timestamp of the `ArticleRevision` row pointed to by `currentPublishedRevisionId`. It represents the moment that specific revision was committed and reflects the most recent substantive editorial update. It is **not** `Article.updatedAt` (which may reflect non-content mutations) and is **not** `Article.publishedAt` (which is set once at first publication). This field is used as the public freshness signal and as `<lastmod>` in the sitemap.

### 9.3 PublicArticleFull

Returned by `GET /api/v1/public/articles/:slug`.

```typescript
interface PublicArticleFull {
  id:                         string;        // Article.id (UUID)
  slug:                       string;
  title:                      string;        // currentPublishedRevision.title
  excerpt:                    string | null;
  body:                       string;        // plain text — INV-03
  publishedAt:                string;        // Article.publishedAt — ISO 8601
  publishedRevisionCreatedAt: string;        // currentPublishedRevision.createdAt — ISO 8601
  hasCoverImage:              boolean;
  coverWidth:                 number | null;
  coverHeight:                number | null;
  coverMimeType:              string | null;
  category: {
    id:   string;
    name: string;
    slug: string;
  } | null;
  author: {
    displayName: string;
    bio:         string | null;
    avatarUrl:   string | null;
  };
  tags: string[];
}
```

### 9.4 PublicSearchResult

Returned by `GET /api/v1/public/search`.

```typescript
interface PublicSearchResult {
  id:                         string;        // Article.id (UUID)
  slug:                       string;
  title:                      string;        // plain, never highlighted
  excerpt:                    string | null; // plain, never highlighted
  publishedAt:                string;
  publishedRevisionCreatedAt: string;
  hasCoverImage:              boolean;
  coverWidth:                 number | null;
  coverHeight:                number | null;
  coverMimeType:              string | null;
  headline:                   string | null; // sanitized ts_headline() — see Section 10.3
  rank:                       number;        // ts_rank score
  category: {
    id:   string;
    name: string;
    slug: string;
  } | null;
  author: {
    displayName: string;
    bio:         string | null;
    avatarUrl:   string | null;
  };
  tags: string[];
}
```

### 9.5 CoverResponse

Returned by `GET /api/v1/public/articles/:slug/cover`.

```typescript
interface CoverResponse {
  signedUrl: string;
  expiresAt: string;  // ISO 8601
  mimeType:  string;
  width:     number | null;
  height:    number | null;
}
```

---

## 10. Full-Text Search Design

### 10.1 Search Architecture

- **Provider:** `PostgresFtsProvider` — the sole FTS implementation in Phase 5.
- **Interface:** `SearchModule` exposes a `SearchService` interface; `PostgresFtsProvider` implements it. This allows future substitution with OpenSearch/Elasticsearch without touching `PublicController`.
- **Queries:** All SQL uses parameterized `$queryRaw` (INV-08).

### 10.2 Conceptual FTS Query

The exact SQL is implementation-defined but must conform to these semantics:

```sql
SELECT
  a.id,
  a.slug,
  r.title,
  r.excerpt,
  r."createdAt"                                                AS "publishedRevisionCreatedAt",
  a."publishedAt",
  (a."coverMediaId" IS NOT NULL AND m.status = 'READY')       AS "hasCoverImage",
  CASE WHEN a."coverMediaId" IS NOT NULL AND m.status = 'READY'
       THEN m."mimeType"  ELSE NULL END                        AS "coverMimeType",
  CASE WHEN a."coverMediaId" IS NOT NULL AND m.status = 'READY'
       THEN m.width       ELSE NULL END                        AS "coverWidth",
  CASE WHEN a."coverMediaId" IS NOT NULL AND m.status = 'READY'
       THEN m.height      ELSE NULL END                        AS "coverHeight",
  ts_headline(
    'english',
    r.body,
    query,
    'StartSel=<b>,StopSel=</b>,MaxWords=35,MinWords=15,ShortWord=3,HighlightAll=false'
  )                                                            AS headline,
  ts_rank(r."searchVector", query)                             AS rank,
  c.id                                                         AS "categoryId",
  c.name                                                       AS "categoryName",
  c.slug                                                       AS "categorySlug",
  ap."displayName"                                             AS "authorDisplayName",
  ap.bio                                                       AS "authorBio",
  ap."avatarUrl"                                               AS "authorAvatarUrl"
FROM article_revisions r
  CROSS JOIN plainto_tsquery('english', $1) AS query
  JOIN articles a
    ON  a."currentPublishedRevisionId" = r.id
    AND a.status    = 'PUBLISHED'
    AND a."deletedAt" IS NULL
    AND a."currentPublishedRevisionId" IS NOT NULL
  LEFT JOIN media m          ON a."coverMediaId" = m.id
  LEFT JOIN categories c     ON a."categoryId"   = c.id
  LEFT JOIN author_profiles ap ON a."primaryAuthorId" = ap."userId"
WHERE
  r."searchVector" @@ query
  -- Optional: AND c.slug = $4       (when categorySlug filter is supplied)
  -- Optional: AND EXISTS (          (when tag filter is supplied)
  --   SELECT 1 FROM article_tags at
  --   JOIN tags t ON at."tagId" = t.id
  --   WHERE at."articleId" = a.id AND lower(t.name) = lower($5)
  -- )
ORDER BY rank DESC, a."publishedAt" DESC, a.id ASC
LIMIT  $2
OFFSET $3
```

`$1` = user query string, `$2` = limit, `$3` = offset. The `query` lateral alias avoids repeating `plainto_tsquery`.

The total-count query must reuse the same visibility gate, category/tag filters, and search predicate as the result query. It may omit ranking/order columns, but it must not broaden or narrow the result set relative to the paginated query.

> [!NOTE]
> The triple gate (`status = 'PUBLISHED' AND deletedAt IS NULL AND currentPublishedRevisionId IS NOT NULL`) is applied inside the `JOIN articles` clause. This is mandatory (INV-01).

### 10.3 Headline Semantics — Locked Contract

| Rule | Statement |
|---|---|
| H-1 | `title`, `excerpt`, and `body` all participate in vector matching and ranking (all three contribute to `searchVector` via `setweight`). |
| H-2 | `headline` is generated by `ts_headline()` running against **`body` only**. |
| H-3 | `<b>...</b>` highlighting in `headline` is **guaranteed only when the matched term appears in body**. A term matched exclusively in `title` or `excerpt` produces no `<b>` tags in `headline`. |
| H-4 | `title` and `excerpt` are returned as separate, plain, unmodified strings. They are never highlighted. |
| H-5 | Tests must **not** assert `<b>` in `headline` for a title-only match. A title-only match must return the article as a result; the absence of `<b>` in `headline` for that result is correct behavior. |
| H-6 | If `ts_headline()` produces no highlighted fragment (body empty or match is title/excerpt-only), `headline` may be `null` or an unhighlighted body excerpt. Both outcomes are acceptable and the test must not fail on either. |

Phase 5 does not implement multi-field highlighting. That is a Phase 5+ enhancement.

### 10.4 Headline Sanitization (INV-07)

After retrieving `ts_headline()` output from PostgreSQL, the NestJS service layer must sanitize it before returning to clients:

- Strip all HTML tags except `<b>` and `</b>`.
- The sanitized `headline` is the only field that may contain HTML markup.
- All other string fields in public DTOs are plain text.

### 10.5 `plainto_tsquery`

Phase 5 uses `plainto_tsquery('english', $1)`:
- Accepts natural-language input without tsquery syntax.
- Handles multi-word phrases, stop words, and stemming automatically.
- Safe for untrusted input when parameterized.

`websearch_to_tsquery` is a valid Phase 5+ upgrade; it is not required here.

---

## 11. Category Zero-Article Behavior

### 11.1 Locked Rules

"Zero published articles" means: zero articles satisfying the triple gate (`status = 'PUBLISHED' AND deletedAt IS NULL AND currentPublishedRevisionId IS NOT NULL`) with `categoryId = category.id`.

| Surface | Behavior |
|---|---|
| `GET /api/v1/public/categories` | Category is **excluded** from the response entirely. |
| `GET /api/v1/public/categories/:slug/articles` | Returns **`404 Not Found`** even if the category row exists. |
| Next.js `/category/[slug]` page | Renders **404**. |
| `/sitemap.xml` | Category URL is **excluded**. |

### 11.2 Rationale

A category page with no content produces both poor UX and thin-content SEO penalties. The 404 behavior is intentional and consistent: a category excluded from the listing must also 404 when accessed by direct URL.

### 11.3 Transition Behavior

When a published article is archived and leaves its category with zero remaining published articles, the category instantly becomes invisible on all public surfaces. No editorial action or notification is required — this is automatic.

---

## 12. Slug Immutability Fix

### 12.1 Confirmed Defect

In [`ArticlesService.update()`](file:///c:/Users/ASUS/Downloads/Yatharth/DailyStar/apps/api/src/modules/articles/articles.service.ts#L179-L182), the existing code regenerates `article.slug` whenever `updateArticleDto.title !== current.currentRevision.title`. This violates INV-04 because it mutates the slug even after first publication, breaking existing public URLs.

### 12.2 Fix Specification

**Rule:** Once `Article.publishedAt IS NOT NULL`, `Article.slug` must never be regenerated regardless of title changes.

The new revision row may receive the updated `title`. `Article.slug` must remain unchanged.

**Required logic in `ArticlesService.update()`:**

```typescript
// Slug regeneration is forbidden after first publication.
let slug = current.slug;
if (
  updateArticleDto.title &&
  updateArticleDto.title !== current.currentRevision?.title &&
  current.publishedAt === null   // <-- gate: only regenerate if never published
) {
  slug = await this.generateUniqueSlug(title, tx);
}
```

### 12.3 Mandatory E2E Regression Test

This regression test is a Phase 5 acceptance requirement:

```
PB-01: Slug immutability after publication

1. Create article (DRAFT).
2. Advance through workflow to PUBLISHED.
3. Capture article.slug.
4. PATCH article with a different title.
5. Assert: article.slug is unchanged.
6. GET /api/v1/public/articles/<original-slug> returns 200.
```

This test must be added to the Phase 5 E2E suite.

---

## 13. OG Image / Cover Image Route — OD-06 Locked

### 13.1 Decision

**OD-06 = OPTION A.** Locked. No alternative options remain.

### 13.2 Dual Purpose

The `/og-image/[slug]` route serves **two** purposes in Phase 5:

1. **OG image proxy.** Social crawlers (Facebook, Twitter, etc.) fetch `og:image` pointed at this route, receive a 302 redirect to a fresh presigned URL, and download the cover image.
2. **Browser-facing cover `<img>` source.** The ISR-cached article page uses `/og-image/[slug]` as the `<img src>` for the cover image displayed to readers. This avoids embedding an expiring presigned URL in ISR HTML (INV-13).

Both use cases are served by the same `force-dynamic` route handler — no new endpoint or architecture is introduced.

### 13.3 Architecture

```
Browser / Crawler
    | GET /og-image/[slug]
    v
Next.js: apps/web/app/og-image/[slug]/route.ts
    | server-side fetch (no-store)
    | GET /api/v1/public/articles/:slug
    |   --> if hasCoverImage = false: return 404
    | server-side fetch (no-store)
    | GET /api/v1/public/articles/:slug/cover
    |   --> if not 200: return 404
    v
HTTP 302 Location: <signedUrl from cover response>
    v
MinIO (via S3_PUBLIC_ENDPOINT) --> image bytes
```

### 13.4 Implementation Requirements

**File:** `apps/web/app/og-image/[slug]/route.ts` (Next.js Route Handler, App Router)

**Exports:**

```typescript
export const dynamic = 'force-dynamic';
// Do NOT export revalidate. No ISR. No static generation.
```

**Fetch calls inside this route:** Must use `cache: 'no-store'` on every fetch.

**Behavior:**

1. Fetch `GET /api/v1/public/articles/:slug` with `cache: 'no-store'`.
2. If response is not `200`, or `hasCoverImage` is `false`: return `NextResponse` with status `404`.
3. Fetch `GET /api/v1/public/articles/:slug/cover` with `cache: 'no-store'`.
4. If response is not `200`: return `NextResponse` with status `404`.
5. Return `NextResponse.redirect(coverResponse.signedUrl, 302)`.

> [!WARNING]
> Any `revalidate` export or ISR behavior on this route is a correctness violation. A cached 302 Location pointing to an expired presigned URL will return 403/404 from MinIO. `force-dynamic` is mandatory.

### 13.5 OG Image Tag in Article Pages

```html
<meta property="og:image" content="/og-image/my-article-slug" />
```

The article page must use the `/og-image/[slug]` route, not a presigned URL directly. This ensures crawlers that re-fetch the OG image later always receive a fresh redirect.

### 13.6 Cover Image `<img>` in Article Pages

```html
<img src="/og-image/my-article-slug" alt="Article cover" />
```

The ISR-cached article page must use the **same** stable same-origin URL (`/og-image/[slug]`) as the `<img src>` for the cover image displayed to readers. This URL never expires because each browser request to `/og-image/[slug]` triggers a fresh `force-dynamic` execution that produces a new 302 redirect to a currently valid presigned URL.

> [!IMPORTANT]
> **No presigned URL may be embedded in ISR HTML (INV-13).** The V1.3 approach of fetching a presigned URL at ISR build time and embedding it in the HTML `<img src>` is replaced by this stable URL approach. The rationale: presigned URL expiry (3600 s) vs ISR revalidate (300 s) is not a hard correctness guarantee — edge caching, CDN stale-while-revalidate, and deployment delays can extend the life of ISR-cached HTML beyond the presigned URL's validity.

---

## 14. Next.js Frontend Pages

### 14.1 Route Contract

| Next.js route | URL path | Description |
|---|---|---|
| `app/page.tsx` | `/` | Home feed |
| `app/article/[slug]/page.tsx` | `/article/[slug]` | Article page |
| `app/category/[slug]/page.tsx` | `/category/[slug]` | Category page |
| `app/search/page.tsx` | `/search` | Search page |
| `app/og-image/[slug]/route.ts` | `/og-image/[slug]` | Cover image + OG image proxy |
| `app/sitemap.xml/route.ts` | `/sitemap.xml` | XML sitemap |

> [!IMPORTANT]
> Route paths are `/article/[slug]` and `/category/[slug]` (singular). Not `/articles/[slug]` or `/categories/[slug]`. This contract is locked.

### 14.2 Rendering and ISR Values — Fully Locked

| Page / route | Rendering | Revalidate |
|---|---|---|
| `/` (home feed) | ISR | **60 seconds** |
| `/article/[slug]` | ISR | **300 seconds** |
| `/category/[slug]` | ISR | **300 seconds** |
| `/search` | Dynamic | **no-store** (no ISR) |
| `/og-image/[slug]` | Dynamic | **force-dynamic** (no ISR, no revalidate) |
| `/sitemap.xml` | ISR | **3600 seconds** |

There are no TBD caching values. The above are the locked values for Phase 5.

### 14.3 Page Specifications

**Home feed (`/`):**
- Fetches: `GET /api/v1/public/articles?page=1&limit=20`
- Renders: Article card grid, pagination controls
- 404: Never (empty feed is valid — shows empty state)
- SEO: See Section 16

**Article page (`/article/[slug]`):**
- Fetches: `GET /api/v1/public/articles/:slug`
- Renders: Title, author (displayName, bio, avatarUrl), `publishedRevisionCreatedAt` (displayed as "Updated"), category, tags, body
- Cover image: If `hasCoverImage` is true, render `<img src="/og-image/[slug]">`. The presigned URL is **not** fetched at ISR time and **not** embedded in the HTML (INV-13).
- OG image: `<meta property="og:image" content="/og-image/[slug]" />`
- 404: When API returns 404 for the slug
- SEO: See Section 16

**Category page (`/category/[slug]`):**
- Fetches: `GET /api/v1/public/categories/:slug/articles`
- Renders: Article card list
- 404: When API returns 404 (non-existent category or zero-article category — Section 11)
- SEO: See Section 16

**Search page (`/search`):**
- Fetches: `GET /api/v1/public/search?q=<q>` with `cache: 'no-store'`
- Renders: Search result cards; `headline` may contain `<b>` tags and must be rendered as HTML (not escaped text)
- SEO: `noindex` recommended; see Section 16

---

## 15. Sitemap

### 15.1 Route

**Path:** `apps/web/app/sitemap.xml/route.ts` (Next.js Route Handler) or `apps/web/app/sitemap.ts` (Next.js Metadata API `generateSitemaps`) — use whichever form is compatible with the installed Next.js version.

**ISR revalidate:** 3600 seconds.

### 15.2 Included URLs

| URL | Included | Condition | `<lastmod>` |
|---|---|---|---|
| `/` | Yes | Always | Current date |
| `/article/[slug]` | Yes | Each article satisfying the triple gate | `publishedRevisionCreatedAt` |
| `/category/[slug]` | Yes | Each category with >= 1 qualifying article | Most recent `publishedRevisionCreatedAt` among articles in that category |
| `/search` | No | Excluded | — |
| `/og-image/[slug]` | No | Excluded | — |

### 15.3 `lastmod` Source

`<lastmod>` for both articles and categories uses `publishedRevisionCreatedAt` (the `createdAt` of the `ArticleRevision` row pointed to by `currentPublishedRevisionId`). This represents the last time the publicly visible content was updated.

`Article.publishedAt` and `Article.updatedAt` are **not** used for `<lastmod>`.

### 15.4 Volume Limit

Phase 5 generates a single `/sitemap.xml` file. If the total URL count approaches 50,000 (the standard sitemap limit), the implementation must emit a warning log. Future phases will implement a sitemap index strategy (multiple sitemap files referenced from a `sitemap-index.xml`). That strategy is documented here as a known future requirement but is not implemented in Phase 5.

---

## 16. Open Graph and SEO Metadata

### 16.1 Per-Page Metadata

| Page | `<title>` | `og:title` | `og:description` | `og:image` | `canonical` | `robots` |
|---|---|---|---|---|---|---|
| Home (`/`) | "DailyStar — Latest News" | Same | "Your daily news source" | Static logo | `/` | index |
| Article (`/article/[slug]`) | Article title | Article title | Article excerpt | `/og-image/[slug]` | `/article/[slug]` | index |
| Category (`/category/[slug]`) | "Category: {name}" | Same | "Latest {name} news" | Not required | `/category/[slug]` | index |
| Search (`/search`) | "Search: {q}" | Same | "Search results for {q}" | Not required | n/a | noindex |

### 16.2 robots.txt

Phase 5 must provide `robots.txt` through `apps/web/app/robots.ts` or the installed Next.js version's equivalent Metadata API route.

Locked output policy:

```text
User-agent: *
Allow: /
Disallow: /api/
Sitemap: https://<NEXT_PUBLIC_SITE_URL>/sitemap.xml
```

`/og-image/[slug]` is not disallowed because it is the browser-facing and crawler-facing cover-image route.

### 16.3 JSON-LD / Structured Data

JSON-LD (e.g., `Article` schema) is **explicitly deferred** beyond Phase 5. It must not be included as "optional" scope in Phase 5. It must not appear in the Phase 5 file inventory.

---

## 17. Phase 5 Test Plan

### 17.1 New Unit Tests (minimum 18)

| ID | Description |
|---|---|
| PU-01 | `PublicService` returns only articles satisfying the triple gate (PUBLISHED + not deleted + currentPublishedRevisionId not null) |
| PU-02 | `PublicService` returns 404 for DRAFT article |
| PU-03 | `hasCoverImage = true` iff `coverMediaId IS NOT NULL AND Media.status = READY` |
| PU-04 | `hasCoverImage = false` when `Media.status = UPLOADING` |
| PU-05 | `hasCoverImage = false` when `Media.status = FAILED` |
| PU-06 | `hasCoverImage = false` when `Media.status = DELETED` |
| PU-07 | Cover endpoint returns 404 when article has no cover (coverMediaId = null) |
| PU-08 | Cover endpoint returns 404 when Media.status != READY |
| PU-09 | `PostgresFtsProvider.search()` returns results ordered by rank DESC, `publishedAt` DESC, then deterministic `id` ASC tie-breaker |
| PU-10 | For a title-only FTS match: result is returned; `headline` does NOT assert `<b>` |
| PU-11 | `PublicService.getCategories()` excludes categories with zero qualifying articles |
| PU-12 | `PublicService.getCategoryArticles()` throws `NotFoundException` when category has zero qualifying articles |
| PU-13 | Headline sanitization strips all non-`<b>` HTML tags from `ts_headline` output |
| PU-14 | `search()` throws `BadRequestException` for empty or absent `q` |
| PU-15 | `publishedRevisionCreatedAt` equals `currentPublishedRevision.createdAt`, not `Article.updatedAt` |
| PU-16 | Feed filter: `categoryId` filter returns only articles in that category |
| PU-17 | Feed filter: `tag` filter is case-insensitive |
| PU-18 | Rate limiter: exceeding 100 requests in the rolling 60-second window returns 429 with `Retry-After: 60` |
| PU-19 | Rate limiter uses a valid signed client IP when propagated by Next.js and rejects spoofed/invalid signatures by falling back to source IP |
| PU-20 | FTS result ordering and count query use identical filters/visibility constraints |

### 17.2 New E2E Tests (minimum 26)

Tests run against a live PostgreSQL instance following the existing E2E pattern in [`apps/api/test/`](file:///c:/Users/ASUS/Downloads/Yatharth/DailyStar/apps/api/test/).

| ID | Spec label | Description |
|---|---|---|
| PR-01 | Feed — returns PUBLISHED only | Triple gate: PUBLISHED, not deleted, currentPublishedRevisionId not null |
| PR-02 | Feed — excludes DRAFT | DRAFT articles never appear |
| PR-03 | Feed — excludes soft-deleted | Soft-deleted PUBLISHED articles absent |
| PR-04 | Feed — excludes articles with null currentPublishedRevisionId | Third gate enforced |
| PR-05 | Feed — pagination (page/limit) | page=1,limit=5 returns 5 items; page=2 returns next batch |
| PR-06 | Single article — 200 with correct DTO shape | All required fields present including `id`, `publishedRevisionCreatedAt`, `author.bio`, `author.avatarUrl`, `category.id` |
| PR-07 | Single article — 404 for DRAFT slug | Non-published slug returns 404 |
| PR-08 | Single article — 404 for soft-deleted | Soft-deleted PUBLISHED returns 404 |
| PR-09 | Cover — 200 returns signedUrl + mimeType + dimensions | READY cover returns all fields |
| PR-10 | Cover — 404 for non-PUBLISHED article slug | Article triple gate enforced on cover endpoint |
| PR-11 | Cover — 404 when coverMediaId is null | Article exists but has no cover |
| PR-12 | Cover — 404 when Media.status = FAILED | Non-READY media returns 404 |
| PR-13 | Categories — excludes zero-article categories | Category with no published articles absent |
| PR-14 | Categories — appears after first publication | After publishing, category appears in list; response includes `id`, `publishedArticleCount` |
| PR-15 | Category articles — 404 when zero published articles | Existing category with 0 published returns 404 |
| PR-16 | Category articles — 404 for non-existent slug | Unknown slug returns 404 |
| PR-17 | Search — body match produces `<b>` in sanitized headline | Term in body returns result with `<b>` in headline |
| PR-18 | Search — title-only match returns result; no `<b>` assertion | Article found; test does NOT assert `<b>` in headline |
| PR-19 | Search — 400 for empty `q` | Missing or empty q returns 400 |
| PR-20 | Feed — categoryId filter | Only articles in the specified category are returned |
| PR-21 | Feed — categorySlug filter | Only articles in the specified category are returned |
| PR-22 | Feed — tag filter (case-insensitive) | `?tag=Politics` and `?tag=politics` return the same results |
| PR-23 | Feed — invalid categoryId UUID → 400 | `?categoryId=not-a-uuid` returns 400 |
| PR-24 | Feed — unsupported orderBy → 400 | `?orderBy=title` returns 400 (only `publishedAt` supported) |
| PR-25 | Category articles — tag filter | `GET /api/v1/public/categories/:slug/articles?tag=xyz` filters by tag |
| PR-26 | Search — categorySlug filter | `GET /api/v1/public/search?q=test&categorySlug=politics` filters by category |
| PB-01 | Slug immutability — post-publication title PATCH does not alter slug; original slug still returns 200 | See Section 12.3 |
| PB-02 | Cover rate limit — 429 when exceeded | Send > 100 requests to cover endpoint; assert 429 + Retry-After: 60 |

> [!IMPORTANT]
> **PR-18 is the corrected title-match test.** It must:
> 1. Create an article whose title contains the search term but whose body does NOT.
> 2. Search for that term. Assert the article is in results.
> 3. **Not** assert `<b>` in `headline`. If `headline` has no `<b>` tags or is null, the test must pass.

### 17.3 Next.js Tests (minimum 4)

| ID | Type | Description |
|---|---|---|
| NX-01 | Unit | `/og-image/[slug]/route.ts` returns HTTP 302 with `Location` header when article has READY cover |
| NX-02 | Unit | `/og-image/[slug]/route.ts` returns 404 when `hasCoverImage = false` |
| NX-03 | Static analysis / Unit | `/og-image/[slug]/route.ts` exports `dynamic = 'force-dynamic'`; no `revalidate` export present |
| NX-04 | Unit | Sitemap generation excludes categories with zero published articles; uses `publishedRevisionCreatedAt` as `lastmod` |
| NX-05 | Unit / static output | `robots.txt` allows `/`, disallows `/api/`, and points to `/sitemap.xml` |

### 17.4 Non-Regression Requirement

| Suite | Count | Requirement |
|---|---|---|
| API unit tests (Phases 1–4) | 58 | All 58 must pass unchanged |
| API E2E tests (Phases 1–4) | 57 | All 57 must pass unchanged |
| Phase 5 new unit tests | >= 20 | All must pass |
| Phase 5 new E2E tests | >= 28 (including PB-01, PB-02) | All must pass |
| Phase 5 Next.js tests | >= 5 | All must pass |

---

## 18. Acceptance Criteria Matrix

Every row must be `PASS` before Phase 5 is considered complete.

| AC# | Criterion | Verification |
|---|---|---|
| AC-01 | All six public endpoints enforce the triple gate (PUBLISHED + not deleted + currentPublishedRevisionId IS NOT NULL) | Code review; E2E: PR-01–PR-04 |
| AC-02 | All public content resolves through `currentPublishedRevisionId` only, never `currentRevisionId` | Code review; E2E: PR-06 |
| AC-03 | `hasCoverImage = true` iff `coverMediaId IS NOT NULL AND Media.status = 'READY'` on all public endpoints | Unit: PU-03–PU-06; E2E: PR-09 |
| AC-04 | `hasCoverImage = false` for UPLOADING / FAILED / DELETED media | Unit: PU-04, PU-05, PU-06 |
| AC-05 | Feed, category, and search endpoints return no `coverSignedUrl` / `coverExpiresAt` fields | Code review; E2E: PR-06 |
| AC-06 | Cover endpoint is `GET /api/v1/public/articles/:slug/cover` (slug-scoped, not media-UUID-scoped) | Code review |
| AC-07 | Cover endpoint returns JSON with `signedUrl`, `expiresAt`, `mimeType`, `width`, `height` | E2E: PR-09 |
| AC-08 | Cover endpoint returns 404 for non-PUBLISHED article | E2E: PR-10 |
| AC-09 | Cover endpoint returns 404 when `Media.status != READY` | Unit: PU-08; E2E: PR-12 |
| AC-10 | Presigned URLs use `S3_PUBLIC_ENDPOINT` (browser-reachable) | Code review; `configuration.ts` review |
| AC-11 | Slug immutability fix: `publishedAt IS NOT NULL` articles never have slug regenerated on title update | Code review; E2E: PB-01 |
| AC-12 | E2E PB-01 passes: publish → PATCH title → slug unchanged → original slug returns 200 | E2E: PB-01 |
| AC-13 | All DTOs include `publishedRevisionCreatedAt` = `currentPublishedRevision.createdAt` | Unit: PU-15; E2E: PR-06 |
| AC-14 | Sitemap `<lastmod>` uses `publishedRevisionCreatedAt`, not `Article.updatedAt` or `Article.publishedAt` | NX-04; sitemap output review |
| AC-15 | `searchVector` uses weighted setweight: title=A, excerpt=B, body=C | Migration SQL review |
| AC-16 | `searchVector` is a `GENERATED ALWAYS AS ... STORED` column in the migration | Migration SQL review |
| AC-17 | GIN index created via `CREATE INDEX ... USING GIN` in the migration | Migration SQL review |
| AC-18 | Migration SQL comment correctly states raw SQL rationale (generated column DDL, NOT missing Prisma GIN support) | Migration SQL review |
| AC-19 | FTS SQL uses parameterized `$queryRaw` with no string interpolation | Code review |
| AC-20 | FTS headline runs `ts_headline()` against body only | SQL review; E2E: PR-17 |
| AC-21 | Title-only FTS match returns the article; test does NOT assert `<b>` in headline | E2E: PR-18 |
| AC-22 | Headline sanitized server-side: only `<b>` / `</b>` forwarded | Unit: PU-13; code review |
| AC-23 | Feed: default limit 20, max limit 50 | Code review; E2E: PR-05 |
| AC-24 | Search: default limit 10, max limit 20 | Code review |
| AC-25 | `GET /api/v1/public/categories` excludes zero-article categories | Unit: PU-11; E2E: PR-13, PR-14 |
| AC-26 | `GET /api/v1/public/categories/:slug/articles` returns 404 for zero-article category | Unit: PU-12; E2E: PR-15 |
| AC-27 | `/og-image/[slug]` exports `dynamic = 'force-dynamic'`; no `revalidate` | NX-03; code review |
| AC-28 | `/og-image/[slug]` returns HTTP 302 via `GET /api/v1/public/articles/:slug/cover` (not via media UUID) | NX-01; code review |
| AC-29 | ISR values are exactly: home=60 s, article=300 s, category=300 s, sitemap=3600 s, search=no-store | Code review of all page files |
| AC-30 | Frontend routes are `/`, `/article/[slug]`, `/category/[slug]`, `/search` | File system review |
| AC-31 | Public endpoints carry no `AuthGuard` or `PermissionGuard` | Code review |
| AC-32 | No JSON-LD in Phase 5 codebase | Code review |
| AC-33 | Existing 58 unit tests (Phases 1–4) pass unchanged | CI |
| AC-34 | Existing 57 E2E tests (Phases 1–4) pass unchanged | CI |
| AC-35 | All >= 20 Phase 5 unit tests pass | CI |
| AC-36 | All >= 28 Phase 5 E2E tests pass | CI |
| AC-37 | All >= 5 Phase 5 Next.js tests pass | CI |
| AC-38 | Article page `<img src>` uses `/og-image/[slug]`, not a presigned URL (INV-13) | Code review; NX inspection |
| AC-39 | No presigned URL is embedded in any ISR-cached HTML (INV-13) | Code review of all ISR pages |
| AC-40 | Cover endpoint rate limit: 100 req/client-IP/rolling 60 s, true Redis sliding window, 429 + Retry-After: 60 | Unit: PU-18; E2E: PB-02 |
| AC-41 | Rate limiter fails open when Redis is unavailable | Unit: PU-18 (Redis-down scenario); code review |
| AC-42 | Rate limiting only applies to the cover endpoint, not to other public or CMS routes | Code review |
| AC-43 | Feed supports `categoryId`, `categorySlug`, `tag`, `orderBy`, `order` filters | E2E: PR-20–PR-24; code review |
| AC-44 | `categoryId` takes precedence when both `categoryId` and `categorySlug` are supplied | Code review |
| AC-45 | Invalid `categoryId` UUID → 400; unsupported `orderBy` → 400 | E2E: PR-23, PR-24 |
| AC-46 | Category articles endpoint supports `tag`, `orderBy`, `order` filters | E2E: PR-25 |
| AC-47 | Search endpoint supports `categorySlug` and `tag` filters | E2E: PR-26 |
| AC-48 | All DTOs include `id` (Article.id UUID) | E2E: PR-06, PR-14; code review |
| AC-49 | `PublicArticleSummary` and `PublicSearchResult` include `author.bio` and `author.avatarUrl` | E2E: PR-06; code review |
| AC-50 | `PublicArticleSummary`, `PublicArticleFull`, `PublicSearchResult` include `category.id` | E2E: PR-06; code review |
| AC-51 | Cover rate limiter is a true rolling 60-second sliding window, not a fixed-window counter | Unit: PU-18; code review |
| AC-52 | `/og-image/[slug]` propagates the trusted end-user IP to the cover endpoint using a server-only HMAC signature; invalid/missing signatures are ignored | Unit: PU-19; code review |
| AC-53 | `S3_PUBLIC_ENDPOINT` is mandatory for Phase 5 public signing; no fallback to `S3_ENDPOINT` is permitted for public presigned URLs | Config review; code review |
| AC-54 | Existing Phase 4 `generateSignedDownloadUrl()` behavior remains unchanged; Phase 5 public cover signing uses a dedicated public-signing method | Code review; Phase 1–4 regression |
| AC-55 | FTS results are deterministically ordered by rank DESC, publishedAt DESC, id ASC; total count uses identical filters/visibility constraints | Unit: PU-09, PU-20; SQL review |
| AC-56 | `robots.txt` exists with locked Allow/Disallow/Sitemap directives | Next.js test: NX-05 |
| AC-57 | Public category listing preserves depth-3 hierarchy with nested `children`; zero-article nodes remain excluded | E2E: PR-14; code review |

---

## 19. Open Decisions

> [!IMPORTANT]
> **There are ZERO open human decisions as of V1.5.**

All decisions are locked:

| Decision | Resolution |
|---|---|
| Public API route names | Locked: `/api/v1/public/articles`, `/api/v1/public/articles/:slug`, `/api/v1/public/articles/:slug/cover`, `/api/v1/public/categories`, `/api/v1/public/categories/:slug/articles`, `/api/v1/public/search` |
| Cover delivery architecture (OD-06) | Locked — Option A: `/og-image/[slug]` → `GET /api/v1/public/articles/:slug/cover` → HTTP 302, `force-dynamic`, no ISR |
| Cover in feed/article/search DTOs | Locked: NO presigned URLs in these DTOs; only `hasCoverImage`, `coverWidth`, `coverHeight`, `coverMimeType` |
| Article page `<img>` for cover | Locked: uses `/og-image/[slug]` (stable, same-origin). No presigned URL in ISR HTML (INV-13). |
| Generic media-UUID public endpoint | Locked: NOT implemented in Phase 5 |
| Browser-reachable presigned URLs | Locked: explicit `S3_PUBLIC_ENDPOINT`; no fallback to `S3_ENDPOINT` for public signing |
| Slug immutability fix | Locked: gate on `publishedAt IS NULL`; PB-01 is mandatory |
| Public freshness field | Locked: `publishedRevisionCreatedAt` = `currentPublishedRevision.createdAt` |
| Sitemap `<lastmod>` source | Locked: `publishedRevisionCreatedAt` |
| FTS weighting | Locked: `setweight` title=A, excerpt=B, body=C |
| Headline source | Locked: `ts_headline()` against body only |
| Title-only match headline | Locked: no `<b>` assertion required; PR-18 must not assert it |
| Feed pagination | Locked: default 20, max 50 |
| Search pagination | Locked: default 10, max 20 |
| Feed filters | Locked: `categoryId`, `categorySlug`, `tag`, `orderBy` (publishedAt only), `order` (asc/desc) |
| Category article filters | Locked: `tag`, `orderBy` (publishedAt only), `order` (asc/desc) |
| Search filters | Locked: `categorySlug`, `tag` |
| Filter precedence | Locked: `categoryId` wins over `categorySlug` |
| Zero-article category | Locked: 404 on all public surfaces; excluded from sitemap |
| ISR values | Locked: home=60 s, article=300 s, category=300 s, sitemap=3600 s, search=no-store, OG=force-dynamic |
| Frontend route paths | Locked: `/`, `/article/[slug]`, `/category/[slug]`, `/search` |
| JSON-LD | Locked: explicitly deferred beyond Phase 5 |
| Next.js version | Locked: installed version from `apps/web/package.json`; no upgrade |
| Prisma FTS rationale | Locked: raw SQL due to generated column DDL, NOT missing Prisma GIN support |
| Cover rate limit | Locked: 100 req/client-IP/rolling 60 s, atomic Redis sorted-set sliding window, 429 + Retry-After: 60, fail-open |
| Rate-limit client identity | Locked: trusted signed client-IP propagation from Next.js `/og-image`; invalid/missing signature falls back to API source IP |
| Rate limit scope | Locked: cover endpoint only; no CMS route rate limiting |
| Public signing method | Locked: dedicated public-signing method/client; existing Phase 4 `generateSignedDownloadUrl()` unchanged |
| Search pagination ordering | Locked: rank DESC, `publishedAt` DESC, `Article.id` ASC |
| robots.txt | Locked: allow `/`, disallow `/api/`, sitemap points to `/sitemap.xml` |
| Public category hierarchy | Locked: preserve existing depth-3 hierarchy via `children`; direct published counts only |
| DTO completeness | Locked: `id`, `author.bio`, `author.avatarUrl`, `category.id` present in all article-shape DTOs |

---

## Appendix A — File Inventory

### New Files (Phase 5)

| File | Purpose |
|---|---|
| `apps/api/src/modules/public/public.module.ts` | NestJS module |
| `apps/api/src/modules/public/public.controller.ts` | Route handlers for all six `/api/v1/public/*` endpoints |
| `apps/api/src/modules/public/public.service.ts` | Business logic: feed, article, cover, categories, category articles |
| `apps/api/src/modules/public/dto/public-article-summary.dto.ts` | `PublicArticleSummary` DTO |
| `apps/api/src/modules/public/dto/public-article-full.dto.ts` | `PublicArticleFull` DTO |
| `apps/api/src/modules/public/dto/cover-response.dto.ts` | `CoverResponse` DTO |
| `apps/api/src/modules/public/dto/public-feed-query.dto.ts` | Feed query parameter validation DTO |
| `apps/api/src/modules/public/dto/category-articles-query.dto.ts` | Category articles query parameter validation DTO |
| `apps/api/src/modules/public/guards/cover-rate-limit.guard.ts` | Redis-backed sliding-window rate limiter guard for cover endpoint |
| `apps/api/src/modules/search/search.module.ts` | NestJS SearchModule |
| `apps/api/src/modules/search/search.service.ts` | `SearchService` interface |
| `apps/api/src/modules/search/dto/search-query.dto.ts` | Search query parameter validation DTO |
| `apps/api/src/modules/search/dto/search-result.dto.ts` | `PublicSearchResult` DTO |
| `apps/api/src/modules/search/providers/postgres-fts.provider.ts` | `PostgresFtsProvider` |
| `apps/api/src/database/prisma/migrations/20260924000001_phase5_fts/migration.sql` | Weighted tsvector column + GIN index |
| `apps/api/test/public.e2e-spec.ts` | Phase 5 E2E tests (PR-01 – PR-26, PB-01, PB-02) |
| `apps/web/app/article/[slug]/page.tsx` | Article page (ISR 300 s) |
| `apps/web/app/category/[slug]/page.tsx` | Category page (ISR 300 s) |
| `apps/web/app/search/page.tsx` | Search page (no-store) |
| `apps/web/app/og-image/[slug]/route.ts` | Cover image + OG image route (force-dynamic) |
| `apps/web/app/sitemap.xml/route.ts` | Sitemap route (ISR 3600 s) |
| `apps/web/app/robots.ts` | robots.txt route / Metadata API equivalent |

### Modified Files (Phase 5)

| File | Change |
|---|---|
| [`apps/api/src/database/prisma/schema.prisma`](file:///c:/Users/ASUS/Downloads/Yatharth/DailyStar/apps/api/src/database/prisma/schema.prisma) | Add `searchVector Unsupported("tsvector")?` to `ArticleRevision` |
| [`apps/api/src/config/configuration.ts`](file:///c:/Users/ASUS/Downloads/Yatharth/DailyStar/apps/api/src/config/configuration.ts) | Add `storage.publicEndpoint` from `S3_PUBLIC_ENDPOINT` |
| [`apps/api/src/modules/media/storage/minio-storage.service.ts`](file:///c:/Users/ASUS/Downloads/Yatharth/DailyStar/apps/api/src/modules/media/storage/minio-storage.service.ts) | Add `publicClient` for Phase 5 public signing; preserve existing `generateSignedDownloadUrl()` behavior and add dedicated public-signing method |
| [`apps/api/src/modules/articles/articles.service.ts`](file:///c:/Users/ASUS/Downloads/Yatharth/DailyStar/apps/api/src/modules/articles/articles.service.ts) | Slug immutability fix in `update()` — gate on `publishedAt === null` |
| `apps/api/src/app.module.ts` | Import `PublicModule`, `SearchModule` |
| `apps/web/app/layout.tsx` | Global SEO metadata defaults |
| `apps/web/app/page.tsx` | Home feed page (ISR 60 s) |
| `.env.example` | Add mandatory `S3_PUBLIC_ENDPOINT` and server-only `PUBLIC_COVER_PROXY_TRUST_SECRET` entries |

---

## Appendix B — Invariant Cross-Reference

| Invariant | Sections enforcing it |
|---|---|
| INV-01 (triple gate) | Sections 7.1 (all endpoints), 10.2 (FTS SQL), 15.2 (sitemap), AC-01 |
| INV-02 (currentPublishedRevisionId only) | Sections 7 (all endpoints), 10.2, AC-02 |
| INV-03 (plain-text body) | Sections 9.3, AC-02 |
| INV-04 (slug immutability) | Section 12 (fix), E2E PB-01, AC-11, AC-12 |
| INV-05 (private bucket) | Sections 6, 7.4, AC-10 |
| INV-06 (browser-reachable presigned URL) | Section 6, AC-10 |
| INV-07 (ts_headline sanitization) | Sections 10.4, AC-22 |
| INV-08 (parameterized SQL) | Sections 10.1, AC-19 |
| INV-09 (WorkflowModule sole mutator) | Not changed in Phase 5 |
| INV-10 (no auth on public endpoints) | Sections 7.1, AC-31 |
| INV-11 (media cleanup deferred) | Section 2 (out of scope) |
| INV-12 (58/58 + 57/57 non-regression) | Section 17.4, AC-33, AC-34 |
| INV-13 (no presigned URL in ISR HTML) | Sections 13.2, 13.6, 14.3 (article page), AC-38, AC-39 |
| INV-14 (explicit public signing endpoint) | Section 6, AC-10, AC-53 |
| INV-15 (Phase 4 signing behavior preserved) | Section 6.4, AC-54 |

---

*End of Phase 5 Technical Specification V1.5*

**FINAL — Approved for implementation planning**
**ZERO open human decisions | ZERO TBD architecture values**
**This specification is the sole authoritative Phase 5 design contract.**
**Antigravity may create an implementation plan only after this specification is accepted by the human engineering lead.**
