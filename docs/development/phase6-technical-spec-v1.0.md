# Phase 6 Technical Specification — V1.0

**Status:** DRAFT — Awaiting Human Engineering Lead Approval
**Date:** 2026-09-28
**Source of truth (inputs):** `dailystar_architecture.md` §13 (Phase 6 definition), the accepted read-only Phase 1 audit (this conversation), and the nine engineering decisions issued by the human engineering lead on 2026-09-28.
**Repository snapshot audited:** post–"chore: clear Phase 5 lint errors" (label `3a7d71f`; no `.git` history was present in the audited snapshot to cryptographically verify the commit hash — see audit caveat).

> [!IMPORTANT]
> This specification is the sole authoritative Phase 6 architecture and design contract. A separate requirements/design/tasks package may be produced only after this specification is approved. Do not write implementation code from this document without that approval.

## Classification legend (used throughout)

- **A — Existing behavior reused.** No backend change. Phase 6 consumes an existing, already-tested contract as-is.
- **B — New Phase 6 behavior.** New frontend code, or a genuinely new backend capability with no prior equivalent, added without touching any existing contract.
- **C — Controlled modification of an earlier-phase contract.** Every C item below states: why it's required, the affected module/contract, its compatibility impact, and the tests it requires. No C item in this document was chosen unilaterally — each corresponds to one of the human engineering lead's nine decisions.

---

## 1. Executive Summary

Phase 6 delivers the editorial CMS frontend for the capabilities already built in Phases 1–5: authentication, draft authoring, the nine-transition editorial workflow, media/cover management, revision history, and audit visibility. Per the architecture doc's own Phase 6 definition (§13), this is fundamentally a **frontend phase** — but the accepted Phase 1 audit identified four real gaps in the existing backend contract that block a usable CMS (no way to learn the caller's own permissions, no author-readable category list, no server-side article filtering/pagination, and an undocumented-but-unenforced comment requirement on two workflow transitions). The human engineering lead has authorized narrow, additive corrections to close exactly these four gaps (Decisions 1, 2, 3, 5 below) and made five further scoping decisions (Decisions 4, 6, 7, 8, 9) that this specification encodes as binding constraints.

**Decisions incorporated (see §20 for full classification detail):**

| # | Decision | Classification |
|---|---|---|
| 1 | Extend `GET /api/users/me` with resolved roles/permissions | **C** |
| 2 | Split category read access from category management | **C** |
| 3 | Add filtering/pagination/deterministic sort to `GET /api/v1/articles` | **C** |
| 4 | No scheduling UI in Phase 6 | Scope exclusion (governs B) |
| 5 | Make request-changes/reject comment mandatory | **C** |
| 6 | No "Delete" action on published/archived content in the CMS | Scope constraint (governs B); backend `DELETE` semantics untouched (**A**) |
| 7 | No reorganization of Phase 5 public routes; dedicated CMS route segment | Scope constraint (governs B) |
| 8 | Plain Markdown/text editor, no rich-editor library | Scope constraint (governs B) |
| 9 | React state/context only, no state/data-fetching library | Scope constraint (governs B) |

Four **C** items total. Everything else in this specification is either **A** (reuse) or **B** (new, additive, non-breaking frontend or backend work).

---

## 2. Scope and Boundaries

### 2.1 Deliverables

| # | Deliverable | Class |
|---|---|---|
| D1 | `GET /api/users/me` returns `roles: string[]` and `permissions: string[]` in addition to existing fields | C |
| D2 | New `category.read` permission, seeded and granted to `author`, `editor`, `admin`; `CategoriesController` GET routes gated on `category.read` instead of `category.manage`; POST/PATCH/DELETE remain gated on `category.manage` (unchanged) | C |
| D3 | `ArticleListQueryDto` (page, limit, status, categoryId, sortBy, order) on `GET /api/v1/articles`; response wrapped in the existing (currently unused) `PaginatedResponse<ArticleSummary>` envelope from `@dailystar/types`; deterministic `id ASC` tie-breaker appended server-side | C |
| D4 | Typed `RequestChangesDto` / `RejectDto` (`comment`/`reason`: required, non-empty, ≤1000 chars) replacing the untyped `body: any` currently used by `WorkflowController.requestChanges()` / `.reject()` | C |
| D5 | New shared domain types in `@dailystar/types`: `ArticleStatus`, `Article`, `ArticleSummary`, `ArticleRevisionSummary`, `SafeUser`, `WorkflowTransitionBody`, `MediaSummary`, `CategorySummary` | B |
| D6 | New CMS route tree at `apps/web/app/cms/*` (real path segment, not a `(cms)` route group — see §5.1 and §19 OD-1) | B |
| D7 | CMS auth shell: `SessionProvider` (React Context), `/cms/login` page, route-level redirect-if-unauthenticated | B |
| D8 | Authenticated API client `apps/web/lib/cms-api.ts` (Bearer attachment, 401→refresh-then-retry-once, typed error parsing) | B |
| D9 | Article list/filter view, draft editor (plain Markdown/text), review queue, workflow action panel, revision history panel, audit log panel, cover/media picker, category management screen (editor/admin) | B |
| D10 | `robots.txt` gains `Disallow: /cms/` alongside the existing `Disallow: /api/` | C (touches a Phase 5–locked file, additive only) |
| D11 | CMS component tests + one full editorial-journey E2E (login → draft → submit → review → approve → publish) | B |

### 2.2 In scope

- Everything in §2.1.
- Reuse, unmodified, of: auth endpoints, article CRUD/revision endpoints, all nine workflow transition endpoints (schedule/cancel-schedule remain callable on the backend but are not wired into the Phase 6 UI per Decision 4), media endpoints, audit endpoint, existing category mutation endpoints (now consumed by a new editor/admin-only category management screen).
- The four D1–D4/D10 backend corrections, scoped exactly as decided — no additional backend changes.

### 2.3 Explicitly out of scope (Not Phase 6)

- Scheduled-publish UI and anything implying automatic firing (Decision 4; backend has no worker — see INV6-13).
- Any Delete action surfaced for `PUBLISHED`/`ARCHIVED` articles (Decision 6). The backend `DELETE /v1/articles/:id` endpoint itself is **not modified** — see §20.6 for why this is deliberately left as a separate, unauthorized decision.
- Rich-text/WYSIWYG editing (Tiptap, ProseMirror, Slate, Lexical, or any equivalent) — Decision 8.
- Autosave. No requirement or code evidence supports it; on the contrary, §9.3 documents concrete evidence *against* naive autosave (every `PATCH` creates a permanent, immutable revision — see INV6-02). Explicit **Save** actions only.
- Redux/Zustand/React Query/SWR or any other state/data-fetching library — Decision 9.
- Reorganizing `apps/web/app/{page.tsx,article,category,search,sitemap.xml,og-image,robots.ts}` into a `(public)` route group — Decision 7.
- Tag listing/autocomplete UI. No `GET` endpoint exists for tags (`TagsController` has only `PATCH`/`DELETE`) and this gap was not included in the lead's nine decisions. Tags remain a free-text, comma/chip input that relies on the existing inline `findOrCreate` behavior in `ArticlesService` (category A). See §19 OD-4.
- Any user/role management screen. No backend endpoint exists (`user:manage`/`role:manage` permissions are seeded but unused by any controller) and this was not authorized. See §19 OD-5.
- A markdown-to-HTML preview pane. Permitted conditionally by Decision 8 but deferred — see §19 OD-6 for the reasoning.
- `WebSockets`, background workers, new UI frameworks, new state-management libraries, Elasticsearch/OpenSearch — no evidence found for any of these; none introduced.
- Populating `packages/ui` with a component library. Components are built co-located under `apps/web/app/cms/**` for Phase 6; extraction into `packages/ui` is deferred until real duplication with the public site appears (avoids speculative abstraction).

---

## 3. Preserved Invariants

These carry forward unmodified from Phases 1–5, cross-checked against the actual code during the Phase 1 audit. No Phase 6 change may weaken or contradict any of them.

| ID | Invariant | Source |
|---|---|---|
| INV6-01 | `WorkflowModule` is the sole mutator of `Article.status`. No Phase 6 frontend or backend code writes status directly. | Architecture §15 rule 8 / Phase 3 |
| INV6-02 | `ArticleRevision` rows are append-only; every content-changing `PATCH` creates a new revision. Nothing is ever edited in place. | Phase 2/3, confirmed in `ArticlesService.update()` |
| INV6-03 | Four-eyes principle: a user cannot approve their own article (`WorkflowService.approve()` throws unconditionally if `primaryAuthorId === user.sub`). No CMS affordance may attempt to bypass this — the "Approve" action must not even be rendered for the article's own author. | Phase 3 |
| INV6-04 | `expectedVersion` is mandatory on every workflow transition call; the CMS must always send the article's current `version`. | Phase 3 |
| INV6-05 | Editing content (`PATCH`) or cover on an `APPROVED`/`SCHEDULED` article silently reverts it to `DRAFT` and clears `approvedRevisionId`/`scheduledFor` ("Pattern A"). The CMS must warn the user before this happens, not just let it happen silently. | Phase 4 |
| INV6-06 | Cover mutation is rejected with `ARTICLE_COVER_IMMUTABLE` once `PUBLISHED` or `ARCHIVED`. | Phase 4 |
| INV6-07 | Cover mutation is rejected with `COVER_MUTATION_NOT_PERMITTED` for the owning author (not for `article.update.any` holders) while `SUBMITTED_FOR_REVIEW`/`UNDER_REVIEW`. | Phase 4 |
| INV6-08 | Slug is immutable once `Article.publishedAt IS NOT NULL`, regardless of later title edits. | Phase 2/5 (PB-01) |
| INV6-09 | Public visibility triple gate: `status = 'PUBLISHED' AND deletedAt IS NULL AND currentPublishedRevisionId IS NOT NULL`. Any CMS action that sets `deletedAt` on a still-`PUBLISHED` article removes it from the public site immediately, without a status change or an `ARCHIVE` audit entry — see §17 R-3. | Phase 5 INV-01 |
| INV6-10 | `currentPublishedRevisionId` is the only pointer the public site ever reads. The CMS must never conflate it with `currentRevisionId` or `approvedRevisionId` in any UI copy or preview affordance. | Phase 5 INV-02 |
| INV6-11 | `PublicController` carries no auth guards and Phase 6 must never route authenticated/mutating CMS actions through it. | Phase 5 INV-10 |
| INV6-12 | Every workflow transition writes exactly one `AuditLog` row inside the same DB transaction as the state change. | Phase 3 |
| INV6-13 | `SCHEDULED` has no automated firing mechanism (no `PublicationSchedule` table, no worker). Phase 6 must not build or imply scheduling automation. | Audit finding, confirmed in code; deferred to a future Scheduling phase |
| INV6-14 | Non-regression: all existing Phase 1–5 unit and E2E tests continue to pass unchanged, except the specific, itemized additions in §12 required by the four C items in this document. | Phase 5 INV-12, adapted |
| INV6-15 | Existing public routes (`/`, `/article/[slug]`, `/category/[slug]`, `/search`, `/sitemap.xml`, `/robots.txt`, `/og-image/[slug]`) are not moved, renamed, or restructured. | This spec, per Decision 7 |

---

## 4. System Architecture

No new services, no new infrastructure, no new databases. The Phase 6 addition sits entirely inside the existing two-app monorepo:

```
                     ┌─────────────────────────────┐
                     │   Editorial staff (browser)   │
                     └───────────────┬───────────────┘
                                     │ HTTPS
                     ┌───────────────▼───────────────┐
                     │  apps/web  (Next.js, CSR)       │
                     │  ┌───────────────────────────┐ │
                     │  │ /  /article  /category      │ │  ← Phase 5, UNCHANGED
                     │  │ /search  /sitemap.xml  ...  │ │
                     │  └───────────────────────────┘ │
                     │  ┌───────────────────────────┐ │
                     │  │ /cms/*  (NEW — Phase 6)      │ │
                     │  └───────────────┬───────────┘ │
                     └──────────────────┼───────────────┘
                                        │ fetch, Bearer + credentials:'include'
                     ┌──────────────────▼───────────────┐
                     │  apps/api  (NestJS, UNCHANGED       │
                     │  module boundaries)                  │
                     │  auth · users(+D1) · rbac ·           │
                     │  articles(+D3) · workflow(+D4) ·      │
                     │  media · categories-tags(+D2) ·       │
                     │  audit · public · search              │
                     └──────────────────┬───────────────┘
                                        │
                     ┌──────────────────▼───────────────┐
                     │ PostgreSQL · Redis · MinIO (unchanged) │
                     └───────────────────────────────────┘
```

Four existing NestJS modules receive small, additive, in-module changes (D1: `UsersModule`; D2: `CategoriesTagsModule`; D3: `ArticlesModule`; D4: `WorkflowModule`). No module gains a new cross-module dependency it didn't already have. No new NestJS module is introduced. No migration is required for any of D1–D4 — see each item's compatibility note in §20.

---

## 5. CMS Frontend Architecture

### 5.1 Route structure

Per Decision 7 ("dedicated CMS route structure," existing routes untouched), Phase 6 adds a real path segment, **not** a parenthesized route group:

```
apps/web/app/
├── page.tsx                    ← Phase 5, unchanged
├── article/[slug]/page.tsx     ← Phase 5, unchanged
├── category/[slug]/page.tsx    ← Phase 5, unchanged
├── search/page.tsx             ← Phase 5, unchanged
├── sitemap.xml/route.ts        ← Phase 5, unchanged
├── og-image/[slug]/route.ts    ← Phase 5, unchanged
├── robots.ts                   ← Phase 5, D10 additive change only
├── layout.tsx                  ← Phase 5, unchanged (root <html>/<body>)
└── cms/                        ← NEW, Phase 6
    ├── layout.tsx              # SessionProvider + auth gate, CSR
    ├── login/page.tsx
    ├── page.tsx                # dashboard (role-aware landing)
    ├── articles/
    │   ├── page.tsx            # list view (D3-backed: filter/sort/paginate)
    │   ├── new/page.tsx        # create draft
    │   └── [id]/page.tsx       # edit shell: editor + workflow panel +
    │                           #   revisions + audit, as sections/tabs
    ├── review/page.tsx         # thin wrapper: articles list pre-filtered
    │                           #   to SUBMITTED_FOR_REVIEW/UNDER_REVIEW
    └── categories/page.tsx     # editor/admin only — full CRUD
```

**Rationale for a real segment over a `(cms)` route group:** a route group produces URLs with no `/cms` prefix at all (e.g. `/login`, `/articles`), which risks future collision with public routes and gives the authenticated surface no clean prefix to reference from `robots.txt` (D10) or any future reverse-proxy/edge rule. This is a default chosen for this draft, not a locked decision — see §19 OD-1 for the alternative and why it's flagged rather than silently assumed.

`apps/web/app/cms/layout.tsx` is the **only** new root-level surface; every child route inherits its auth gate. It is client-rendered (`'use client'`), consistent with the architecture doc §3.2 ("CMS is client-heavily-rendered since it's behind auth and SEO doesn't apply").

### 5.2 Session and state management (Decision 9)

No new library. A single React Context, `SessionProvider` (in `apps/web/app/cms/`), holds:

```
{ user: SafeUser | null, roles: string[], permissions: string[],
  accessToken: string | null, status: 'loading'|'authenticated'|'unauthenticated',
  login(), logout(), refresh() }
```

- Populated once at CMS layout mount via `GET /api/users/me` (D1) after a successful `POST /api/auth/login`, or via silent `POST /api/auth/refresh` on first load (cookie-based, see §6.1).
- `permissions: string[]` from D1 drives all UI-gating (button visibility, route redirects) — this directly resolves audit gap §4.1 / Open Decision §9.1.
- Access token held in memory only (component state via the context), never in `localStorage`/`sessionStorage`, consistent with the existing backend design (refresh token is the only persisted credential, and it's an httpOnly cookie the frontend never touches directly).
- All other state (form fields, list filters, loading/error flags) is local `useState`/`useReducer` per component. No global store beyond `SessionProvider`.

### 5.3 API client (D8)

`apps/web/lib/cms-api.ts`, separate from the existing untouched `apps/web/lib/api.ts` (Phase 5, public-only, no auth):

- Wraps `fetch` against `API_BASE` (reuses the existing `NEXT_PUBLIC_API_URL` env convention), attaching `Authorization: Bearer <accessToken>` and `credentials: 'include'` on every call (the cookie carries the refresh token cross-origin per the existing CORS configuration — no change needed there).
- On a `401`, attempts exactly one `POST /api/auth/refresh`, retries the original request once with the new token, and if that also fails, clears the session and redirects to `/cms/login`. This prevents infinite refresh loops.
- Parses the existing `ApiErrorResponse` shape (`statusCode`, `message`, `error`, `timestamp`, `path`) already defined in `@dailystar/types`, and additionally surfaces the specific string codes the backend already returns inside `message` for 409/403 cases (`VERSION_REQUIRED`, `VERSION_MISMATCH`, `CONCURRENCY_CONFLICT`, `ARTICLE_COVER_IMMUTABLE`, `COVER_MUTATION_NOT_PERMITTED`, `FILE_TOO_LARGE`) so the UI can render a specific message rather than a generic error (see §11).

### 5.4 Editor (Decision 8)

- A plain `<textarea>`-based (or minimal contentEditable-free) Markdown/text editor bound directly to `ArticleRevision.body`, matching the storage model exactly as documented in the audit (§8.4: plain text, Markdown by convention, chosen explicitly in `phase2_articles_core_spec.md` over structured JSON).
- No Tiptap/ProseMirror/Slate/Lexical. No autosave (see §2.3).
- A live Markdown preview pane is **not included in v1** — permitted-but-conditional per Decision 8, deferred per §19 OD-6.
- Title, excerpt, category (D2-backed picker), tags (free-text chip input, no listing endpoint — see §2.3), and cover image (existing Media endpoints) are plain form fields alongside the body textarea.

---

## 6. Backend/API Contract

### 6.1 Authentication (A — fully reused, no changes)

| Endpoint | Behavior (unchanged) |
|---|---|
| `POST /api/auth/register` | Creates a user, always assigned the `author` role. **Not wired into the Phase 6 UI** — see §19 OD-5; endpoint itself untouched and still callable directly if the team wants it. |
| `POST /api/auth/login` | Returns `{ accessToken, user }` in body; sets httpOnly `refreshToken` cookie (`path=/api/auth`, `SameSite=Strict`). |
| `POST /api/auth/refresh` | Reads cookie, returns new `{ accessToken }`, rotates cookie. |
| `POST /api/auth/logout` | Revokes refresh session, clears cookie. |

### 6.2 D1 — `GET /api/users/me` (C)

**Current response:**
```json
{ "id": "...", "email": "...", "displayName": "...", "isActive": true,
  "tokenVersion": 1, "createdAt": "...", "updatedAt": "..." }
```

**New response (additive fields only, nothing removed):**
```json
{ "id": "...", "email": "...", "displayName": "...", "isActive": true,
  "tokenVersion": 1, "createdAt": "...", "updatedAt": "...",
  "roles": ["editor"],
  "permissions": ["article.create", "article.read.any", "..."] }
```

- **Why required:** the audit (§4.1) established that no endpoint exists today for a client to learn its own resolved permission set. Without it, the CMS cannot correctly gate UI (e.g., whether to render "Approve"), only discover capability by trial-and-error against 403s — an explicitly rejected option per the lead's decision.
- **Affected module/contract:** `UsersModule` (`UsersController.getMe`, `UsersService`), Phase 1.
- **Implementation note:** `getMe` currently only carries `AuthGuard`, not `PermissionGuard`, so `request.userPermissions` is not pre-populated on this route. The permission-resolution query already implemented inside `PermissionGuard.canActivate()` must be reused (not duplicated) — extract it into a shared, injectable resolver both the guard and `UsersService` call, per architecture §15 rule 1 ("inspect before modifying") and the general reuse-first priority. This is a design-phase decision, not specified further here.
- **Compatibility impact:** additive only; every existing field is preserved verbatim. No existing test asserts an exact/closed response shape for `getMe` beyond individual field checks (confirmed: no snapshot-style assertion found). **Zero known breaking impact.**
- **Required tests:** unit test asserting `roles`/`permissions` match the seeded role/permission data for each of the three seeded roles; E2E test confirming the field is present and correct after login for an `author`, an `editor`, and an `admin` account; regression run of the existing `auth.e2e-spec.ts` (which already contains the only `GET /users/me` tests — an unauthenticated 401 case and an authenticated success case; no dedicated users unit or E2E spec exists) to confirm no existing assertion breaks. New role/permission assertions belong in that file or a new `users.e2e-spec.ts`.

### 6.3 D2 — Category read/manage split (C)

- **New permission:** `category.read`, seeded via the existing idempotent `seed.ts` upsert pattern, granted to `author`, `editor`, and `admin` (all three — editor/admin already have `category.manage`, which is a superset in practice, but `category.read` is granted explicitly to all three so the guard logic is uniform and doesn't need an OR-condition across two permission names).
- **`CategoriesController` change:** the current class-level `@RequirePermission('category.manage')` (gating *every* route including `GET`) is removed. `GET /v1/categories` and `GET /v1/categories/:id` are re-decorated with `@RequirePermission('category.read')`. `POST`, `PATCH`, `DELETE` keep `@RequirePermission('category.manage')`, unchanged.
- **Why required:** the audit (§4.2) established that authors have no authenticated way to list categories for a picker; the only alternative (the public categories endpoint) excludes any category with zero published articles, which is unsuitable for authoring.
- **Affected module/contract:** `CategoriesTagsModule` (`CategoriesController`), Phase 2.
- **Compatibility impact:** strictly additive/loosening for `GET` routes. `editor`/`admin` behavior is unchanged (they already had `category.manage`, and both existing E2E/unit tests for those roles continue to pass unmodified). No schema/migration required — `category.read` is a seed-data row, not a schema change, satisfying the lead's constraint that this "must not require a database schema change." **No removal of any existing capability from any role.**
- **Required tests:** unit/E2E test that an `author`-role token can now successfully call `GET /v1/categories` and `GET /v1/categories/:id` (previously 403); regression test confirming an `author`-role token still receives 403 on `POST`/`PATCH`/`DELETE /v1/categories`; regression run of `categories.controller.spec.ts`, `categories.service.spec.ts`, and `categories-tags.e2e-spec.ts`.
- **Tags are explicitly not part of D2** — no `TagsController` change is authorized (see §2.3, §19 OD-4).

### 6.4 D3 — Article list filtering/pagination/sort (C)

**New query DTO**, mirroring the established `PublicFeedQueryDto` convention (`apps/api/src/modules/public/dto/public-feed-query.dto.ts`) for consistency with an existing, trusted pattern:

```ts
class ArticleListQueryDto {
  page: number = 1;          // @IsInt @Min(1)
  limit: number = 20;        // @IsInt @Min(1) @Max(100) — matches media's listOwn convention
  status?: ArticleStatus[];  // CSV-parsed, @IsEnum(ArticleStatus, { each: true })
  categoryId?: string;       // @IsUUID
  sortBy: 'updatedAt' | 'createdAt' | 'title' = 'updatedAt'; // @IsIn
  order: 'asc' | 'desc' = 'desc';                            // @IsIn
}
```

- **Response envelope:** `PaginatedResponse<ArticleSummary>` — `{ data: ArticleSummary[], total, page, limit }`. This type already exists, unused, in `@dailystar/types`; this is its first real consumer.
- **Determinism:** the service appends `id: 'asc'` as a secondary Prisma `orderBy` key after whatever `sortBy` was requested, so pagination is stable across pages even when many rows share a `sortBy` value — the same principle Phase 5's FTS search already applies (`rank DESC, publishedAt DESC, Article.id ASC`), extended here to the authenticated list endpoint for the same reason (deterministic sort was explicitly required by the lead).
- **Ownership scoping is unchanged and authoritative:** the existing rule — non-`article.read.any` callers only ever see `primaryAuthorId = self` — is applied to the Prisma `where` clause *before* any of the new filters, exactly as today. The new filters narrow within that boundary; they cannot be used to see outside it.
- **Why required:** the audit (§4.4) established this endpoint currently returns every accessible article, unfiltered and unpaginated — unworkable for a review queue or a growing draft list, and confirmed by grep to have **zero existing test coverage** (no unit, controller, or E2E test exercises `findAll`/`GET /v1/articles` today).
- **Affected module/contract:** `ArticlesModule` (`ArticlesController.findAll`, `ArticlesService.findAll`), Phase 2.
- **Compatibility impact:** this is a genuine **response-shape change** (bare array → paginated envelope object), which would be breaking for any existing consumer — but there is no existing consumer (confirmed: no test, no frontend code, calls this endpoint today). Risk is assessed as **zero for existing behavior**, precisely because nothing exercises it. This is the first test coverage this endpoint will have.
- **Required tests:** new unit tests for `ArticlesService.findAll` covering each filter independently and in combination, tie-breaker determinism across two pages with equal `sortBy` values, and ownership-scoping is preserved under every filter combination for a non-`article.read.any` caller; new E2E tests for `GET /v1/articles` covering pagination bounds (`limit` clamping at 100), default sort, and a 400 on an invalid `status` value.

### 6.5 D4 — Mandatory comment on request-changes/reject (C)

- **Current state:** `WorkflowController.requestChanges()` / `.reject()` take `@Body() body: any` — no DTO class exists for either, so `class-validator`/the global `ValidationPipe` currently validates nothing on these two routes. `WorkflowService.requestChanges()`/`.reject()` accept `comment` as a fully optional parameter.
- **New DTOs:**
```ts
class RequestChangesDto { expectedVersion: number; comment: string; } // @IsString @IsNotEmpty @MaxLength(1000)
class RejectDto         { expectedVersion: number; comment: string; } // same shape, named for parity with the existing `reason` language used by the architecture doc's transition table — implementation may name the field `comment` (matching current code) or `reason` (matching architecture doc §5.2); this spec recommends keeping `comment` for continuity with the field name already used in `AuditLog.metadata.reason` today — final naming is a design-phase call within this constraint.
```
  `expectedVersion` also gains an explicit `@IsNumber() @Min(1)` DTO validation for the first time on these two routes (previously checked only in service code) — a welcome, low-risk side effect of introducing a real DTO, not a separate change.
- **Why required:** the lead's Decision 5, closing the exact gap the audit flagged in §8.8 — the architecture doc's own transition table (§5.2) documents both transitions as "requires a non-empty comment/rejection reason," but the code has never enforced it. The lead has explicitly classified closing this gap as a controlled Phase 6 contract correction.
- **Affected module/contract:** `WorkflowModule` (`WorkflowController`, `WorkflowService.requestChanges`/`.reject`), Phase 3.
- **Compatibility impact:** this **tightens** the contract — a call that previously succeeded with an omitted or empty `comment` will now receive `400 Bad Request`. Confirmed by direct inspection of `apps/api/test/workflow.e2e-spec.ts`: the only two existing calls to these transitions **both already send a non-empty `comment`**; no existing test omits it. **Compatibility risk is assessed as zero against the existing test suite.** Any hypothetical future or external caller relying on the previously-optional field would break — this is the intended, authorized effect of the correction.
- **Required tests:** new E2E cases asserting `400` when `comment` is omitted or empty-string for both `request-changes` and `reject`; regression run of the existing two passing cases in `workflow.e2e-spec.ts` (lines ~173, ~207) to confirm they still succeed unchanged; unit tests for the new DTOs' validation rules.

### 6.6 D10 — `robots.txt` addition (C, minor)

- **Change:** add `Disallow: /cms/` to the existing Phase-5-locked robots policy (`allow '/', disallow '/api/'`, sitemap pointer), which did not and could not anticipate the CMS route segment since it didn't exist yet.
- **Affected module/contract:** `apps/web/app/robots.ts`, Phase 5 (locked decision table, §19 of `phase5-technical-spec-v1.5.md`).
- **Compatibility impact:** additive only; the existing `Disallow: /api/` and `Allow: /` rules are untouched.
- **Required tests:** update `apps/web/app/__tests__/robots.test.ts` to assert the new rule alongside the existing ones.

### 6.7 Everything else consumed by the CMS (A — reused as-is)

| Endpoint(s) | Notes |
|---|---|
| `POST/GET/PATCH/DELETE /api/v1/articles/:id`, `/restore`, `/revisions`, `/revisions/:revisionId`, `/cover` | Unmodified. `expectedVersion` handling on plain `PATCH` remains optional-but-recommended-always (INV asymmetry noted in the audit, §5) — the CMS must always send it to get concurrency protection; this is a frontend discipline requirement, not a backend change. |
| `POST /api/v1/articles/:id/{submit-review,start-review,approve,publish,archive}` | Unmodified. |
| `POST /api/v1/articles/:id/{schedule,cancel-schedule}` | Unmodified on the backend; **not called by the Phase 6 UI** (Decision 4). |
| `GET /api/v1/articles/:id/audit` | Unmodified. |
| `POST/GET/DELETE /api/v1/media*` | Unmodified; already paginated. |
| `POST/GET/PATCH/DELETE /api/v1/categories*` | POST/PATCH/DELETE unmodified (still `category.manage`-gated); GET modified per D2. |

---

## 7. Authentication and Authorization

- **Token handling:** exactly as documented in §6.1/§5.3 — access token in memory via `SessionProvider`, refresh token in the existing httpOnly cookie, never touched directly by frontend code.
- **UI gating:** every workflow-action button, the category management screen, and any `article.read.any`-dependent list scope check the `permissions` array from `SessionProvider` (sourced from D1) before rendering. The backend remains the actual enforcement point in every case (existing guards, unchanged) — frontend gating is UX only, per architecture §3.6's existing principle, carried forward unmodified.
- **Four-eyes in the UI:** the "Approve" action must not be rendered (not just disabled) when `article.primaryAuthorId === session.user.id`, matching INV6-03.
- **Ownership scoping in list views:** the D3 filters operate within, not instead of, the existing ownership rule (§6.4) — an author's article list can never show another author's drafts regardless of query parameters, exactly as today.
- **No new roles, no new auth flow, no MFA** — none introduced; none evidenced as required.

---

## 8. Editorial Workflow Interaction

### 8.1 State → available actions matrix (as actually implemented, not the aspirational architecture-doc table)

| Status | Author (owner) can | Editor/Admin can |
|---|---|---|
| `DRAFT` | Edit, Delete (soft, own — `article.delete.own`), Submit for Review | Edit (any); Submit for Review; Delete (any) is **admin only** (`article.delete.any` is seeded for `admin` alone — the `editor` role holds neither `article.delete.any` nor `article.delete.own`) |
| `SUBMITTED_FOR_REVIEW` | View only (see §8.2 caveat) | Start Review |
| `UNDER_REVIEW` | View only (see §8.2 caveat) | Request Changes, Reject, Approve (not on own article — INV6-03) |
| `APPROVED` | — | Publish; editing content/cover reverts to `DRAFT` (INV6-05, warn first) |
| `PUBLISHED` | — | Archive; editing content/cover reverts to `DRAFT` (INV6-05, warn first) |
| `ARCHIVED` | — | (terminal in current backend — no un-archive transition exists) |
| `SCHEDULED` | — | **Not reachable from the Phase 6 UI** (Decision 4); if an article is already `SCHEDULED` via direct API use, the CMS still needs to render its state (see §11.4) and offer Cancel Schedule, since that reverts to a supported, unambiguous state (`APPROVED`) — this one action is the single exception to "no scheduling UI" and is included because *not* offering it would strand an operator-created `SCHEDULED` article with no CMS-native way back to `APPROVED`. |

### 8.2 Flagged integrity gap — content edits during review (new finding, not previously in the audit)

While drafting this contract, direct inspection of `ArticlesService.update()` shows it **only** auto-reverts to `DRAFT` for `APPROVED`/`SCHEDULED` articles (INV6-05). It applies **no restriction at all** for `SUBMITTED_FOR_REVIEW`/`UNDER_REVIEW` — an author (or any `article.update.any` holder) can `PATCH` an article's content while it is mid-review, which silently advances `currentRevisionId` out from under the reviewer. Because `WorkflowService.approve()` approves whatever `article.currentRevisionId` happens to be *at the moment of the approve call* (not the revision the reviewer was actually looking at), this is a real content-integrity gap: a reviewer could approve — and an editor subsequently publish — content the reviewer never actually reviewed. Cover mutation has a partial version of this protection already (INV6-07); plain content edits have none.

This was not addressed by the lead's nine decisions and is **not resolved by this specification**. It is a backend (`ArticlesModule`/`WorkflowModule`) behavior question, not a frontend styling question, so Phase 6 cannot silently fix it by itself. Proposed frontend-only mitigation for this phase (§8.1 table already reflects it: "View only" for the owning author during review) reduces but does not eliminate the risk, since an `article.update.any` holder (an editor) can still edit another editor's in-review article. See §17 R-1 and §19 OD-2 for the explicit decision this needs.

### 8.3 Revision history / audit

- `GET /v1/articles/:id/revisions` (list) and `/revisions/:revisionId` (single) render as a read-only history panel — reused as-is (A). No diff view is specified in this phase (no diffing library exists in the repo and none is evidenced as required); a simple chronological list with author/timestamp/revision number is in scope, a side-by-side diff is not.
- `GET /v1/articles/:id/audit` renders as a read-only audit panel showing actor, action, before/after state, and timestamp per entry — reused as-is (A).

---

## 9. Article/Revisions Model

- No schema change. `ArticleRevision.body` (`@db.Text`, plain string) is the sole content field the editor writes to, matching INV6-02 and the deliberate, already-documented Phase 2 decision to use Markdown text over structured JSON (audited and confirmed intentional, not reopened here per Decision 8).
- Every "Save" in the CMS is a `PATCH /v1/articles/:id` call carrying `expectedVersion` (always sent — see §6.7 note), producing exactly one new `ArticleRevision`. There is no partial-save/patch-a-field concept; the whole editable surface (title/body/excerpt/categoryId/tags) is sent together, matching the existing DTO shape.
- **Why no autosave (restated from §2.3 with the concrete mechanism):** because each save is a permanent, immutable, auditable revision row, a timer-based autosave (e.g., every 10s) would flood `ArticleRevision` with near-duplicate rows, degrade the revision-history view's usefulness, and inflate the exact "unbounded revision-table growth" risk the architecture doc's own §14 risk table already flags as a known, deliberately-deferred concern. This is concrete evidence against introducing autosave, not merely an absence of evidence for it.
- Concurrency: **always** send `expectedVersion` on every `PATCH`. A `409 CONCURRENCY_CONFLICT` must be caught and surfaced as "this article was changed elsewhere — reload to see the latest version" rather than silently overwritten or silently retried.

---

## 10. Media Integration

Fully reused (A), no backend changes:

- Upload via `POST /v1/media` (multipart, single file), validated server-side by MIME + magic bytes (existing behavior, not re-implemented client-side beyond basic UX pre-checks).
- Cover assignment via `PATCH /v1/articles/:id/cover`, which **requires** `expectedVersion` strictly (unlike plain content `PATCH`) and can return `ARTICLE_COVER_IMMUTABLE` (INV6-06) or `COVER_MUTATION_NOT_PERMITTED` (INV6-07) — both must be caught and explained in the UI, not shown as generic errors.
- Cover retrieval via `GET /v1/articles/:id/cover` (signed URL) for rendering the current cover in the editor.
- Media library via `GET /v1/media` (paginated, own media only) for picking an existing upload as a cover instead of re-uploading.
- 413 (`FILE_TOO_LARGE`) must be caught and shown with the actual size limit, not a generic failure.

---

## 11. Validation and Error Handling

### 11.1 Client-side pre-validation (mirrors existing, unchanged server DTOs — A)

| Field | Rule | Source |
|---|---|---|
| `title` | 3–150 chars, non-empty | `CreateArticleDto`/`UpdateArticleDto`, unchanged |
| `body` | non-empty (no max) | unchanged |
| `excerpt` | ≤500 chars, optional | unchanged |
| `tags` | ≤10 items | enforced in `ArticlesService`, unchanged |
| `comment` (request-changes/reject) | non-empty, ≤1000 chars | **new, D4** |

Client-side validation is a UX convenience only; the server DTOs (existing + D4) remain the actual gate.

### 11.2 Known error codes the CMS must handle explicitly (not generic error toasts)

`VERSION_REQUIRED`, `VERSION_MISMATCH`, `CONCURRENCY_CONFLICT`, `ARTICLE_COVER_IMMUTABLE`, `COVER_MUTATION_NOT_PERMITTED`, `FILE_TOO_LARGE`, plus standard `401` (→ silent refresh, see §5.3), `403` (→ "you don't have permission," hide the action going forward for this session), `404` (→ "not found or you don't have access" — the backend deliberately returns 404 rather than 403 for ownership failures to avoid existence leaks; the CMS must not "correct" this into a more specific message that would defeat that IDOR protection).

### 11.3 Loading / empty states

- List views (articles, review queue, categories, media picker): explicit loading skeleton, explicit "no results for this filter" empty state distinct from "no articles exist yet."
- Editor: explicit save-in-flight state; Save button disabled while a request is in flight (prevents double-submit given there's no idempotency key on `PATCH`).

### 11.4 Unsaved-change behavior

- Standard browser-native "leave without saving?" prompt (`beforeunload`/router-level guard) when the editor form is dirty — no new library required, this is a native browser/Next.js router capability.
- Before any action that triggers INV6-05 (editing an `APPROVED`/`SCHEDULED` article), an explicit confirmation dialog stating the article will revert to Draft and (if `SCHEDULED`) its schedule will be cancelled — required, not optional, given this is a silent, surprising backend behavior the audit specifically flagged.

---

## 12. Security Model

No new security surface beyond what D1–D4 introduce, each already covered in §6:

- D1 exposes the caller's **own** permissions only — this is not a privilege-escalation risk (it does not grant anything; it reports what's already true). It does slightly increase what an authenticated user can learn about the permission-name vocabulary of the system, judged an acceptable, minor disclosure.
- D2 is a pure read-permission grant, strictly additive, does not touch any mutating capability.
- D3 does not change authorization logic, only adds filters evaluated **after** the existing ownership `where` clause.
- D4 only adds validation (rejecting previously-accepted-but-undocumented empty input); it does not relax anything.
- CORS/cookie configuration is unchanged (§6.1); the CMS runs same-app, cross-port locally exactly as Phase 5's frontend already does against the API, so no new cross-origin surface is introduced.
- `forbidNonWhitelisted: true` on the global `ValidationPipe` remains in effect; the CMS API client must send exactly the fields each DTO declares.

---

## 13. Testing Strategy

| Layer | Scope |
|---|---|
| Backend unit | New tests for D1 (permission resolution correctness per role), D2 (read/manage split per role), D3 (filter/pagination/determinism/ownership-scoping), D4 (DTO validation) — see each item in §6 for specifics |
| Backend E2E | New cases per §6.2/6.3/6.4/6.5/6.6; full regression run of all existing suites (`auth`, `articles`, `workflow`, `categories-tags`, `media`, `public`, `app`) to confirm INV6-14 |
| Frontend component | React Testing Library coverage for: `SessionProvider` (login/refresh/logout/permission exposure), the editor form (validation, dirty-state prompt, INV6-05 confirmation dialog), the workflow action panel (correct actions rendered per role × status per §8.1's matrix, four-eyes button suppression), the article list (filter/sort/pagination UI against D3), error-code-specific rendering (§11.2) |
| Frontend E2E | At least one full editorial journey: login as author → create draft → submit for review → login as editor → start review → approve → publish → confirm visible on the (unchanged) public site. This satisfies the architecture doc's own Phase 6 acceptance criterion verbatim. |
| Non-regression | Existing `apps/web/app/__tests__/*` (og-route, page, robots [updated per D10], sitemap-route) must continue to pass. |

---

## 14. Acceptance Criteria Matrix

| # | Criterion | Class | Verifies |
|---|---|---|---|
| AC-1 | A non-technical editor can complete the entire draft-to-publish flow through the UI without direct API calls | B | Architecture §13 Phase 6 criterion, verbatim |
| AC-2 | An author cannot see or trigger any action the backend would reject for their role/ownership (buttons hidden, not just disabled-with-error) | B | §7, §8.1 |
| AC-3 | `GET /api/users/me` returns correct `roles`/`permissions` for each seeded role, additively | C | §6.2 |
| AC-4 | An `author`-role token can `GET /v1/categories`/`:id` (200) but still cannot `POST`/`PATCH`/`DELETE` (403) | C | §6.3 |
| AC-5 | `GET /v1/articles` supports `page`/`limit`/`status`/`categoryId`/`sortBy`/`order`, returns a `PaginatedResponse<ArticleSummary>`, is deterministic across pages, and never returns another user's drafts to a non-`article.read.any` caller regardless of filters | C | §6.4 |
| AC-6 | `request-changes`/`reject` return `400` when `comment` is omitted or empty; existing non-empty-comment call sites in `workflow.e2e-spec.ts` still pass unchanged | C | §6.5 |
| AC-7 | Editing an `APPROVED`/`SCHEDULED` article's content or cover shows an explicit confirmation before the request is sent, naming the Draft-revert/schedule-cancel consequence | B | §11.4, INV6-05 |
| AC-8 | No scheduling UI is reachable except "Cancel Schedule" on an already-`SCHEDULED` article | B | §8.1, Decision 4 |
| AC-9 | No "Delete" action is rendered for `PUBLISHED`/`ARCHIVED` articles anywhere in the CMS | B | Decision 6 |
| AC-10 | No rich-text editor dependency appears in `apps/web/package.json`; the body field is a plain text/Markdown control | B | Decision 8 |
| AC-11 | No Redux/Zustand/React Query/SWR dependency appears in `apps/web/package.json` | B | Decision 9 |
| AC-12 | Existing Phase 5 public routes and their tests are unmodified except `robots.ts`/`robots.test.ts` (D10) | C (D10) / A (rest) | INV6-15 |
| AC-13 | A four-eyes violation attempt (own article) never even renders the Approve control for that user | B | INV6-03 |
| AC-14 | Full non-regression: all pre-existing unit/E2E suites (backend and frontend) pass unchanged | — | INV6-14 |

---

## 15. File/Module Inventory

### New files (Phase 6)

| File | Purpose |
|---|---|
| `apps/api/src/modules/articles/dto/article-list-query.dto.ts` | D3 query DTO |
| `apps/api/src/modules/workflow/dto/request-changes.dto.ts` | D4 |
| `apps/api/src/modules/workflow/dto/reject.dto.ts` | D4 |
| `packages/types/src/article.ts` (or extend `index.ts`) | D5 domain types |
| `apps/web/app/cms/layout.tsx` | D7 auth shell |
| `apps/web/app/cms/login/page.tsx` | D7 |
| `apps/web/app/cms/page.tsx` | Dashboard |
| `apps/web/app/cms/articles/page.tsx` | D3-backed list |
| `apps/web/app/cms/articles/new/page.tsx` | Create |
| `apps/web/app/cms/articles/[id]/page.tsx` | Edit/workflow/revisions/audit shell |
| `apps/web/app/cms/review/page.tsx` | Review queue |
| `apps/web/app/cms/categories/page.tsx` | Category management |
| `apps/web/lib/cms-api.ts` | D8 authenticated client |
| `apps/web/app/cms/session-provider.tsx` (or similar) | D7/§5.2 |
| CMS component test files co-located under each route | D11 |
| `apps/web/tests/e2e/editorial-journey.spec.ts` (exact tooling/location TBD in design phase — no E2E tool is currently installed in the repo; see §19 OD-3) | D11 |

### Modified files

| File | Change |
|---|---|
| `apps/api/src/modules/users/users.controller.ts`, `users.service.ts` | D1 |
| `apps/api/src/database/prisma/seed.ts` | D2 (new permission row) |
| `apps/api/src/modules/categories-tags/categories.controller.ts` | D2 (guard split) |
| `apps/api/src/modules/articles/articles.controller.ts`, `articles.service.ts` | D3 |
| `apps/api/src/modules/workflow/workflow.controller.ts`, `workflow.service.ts` | D4 |
| `apps/web/app/robots.ts` | D10 |
| `apps/web/app/__tests__/robots.test.ts` | D10 |
| `apps/api/test/workflow.e2e-spec.ts`, `articles.e2e-spec.ts`, `categories-tags.e2e-spec.ts`, `auth.e2e-spec.ts` (or a new `users.e2e-spec.ts`) | New test cases per §13 |
| `packages/types/src/index.ts` | D5 |

**No file deletions. No migration files (D1–D4 require zero Prisma schema changes — confirmed per-item in §6).**

---

## 16. Dependency Map

- D6–D9 (frontend routes/session/API client) depend on D1 (need `roles`/`permissions` to gate anything) and D2 (need a category source for the editor form).
- D9 article editor depends on D3 only for the *list* view, not the editor itself (create/edit uses the existing single-article endpoints, unmodified).
- D4 is independent of D1–D3; can be built and tested in isolation.
- D10 depends on D6 existing (can't disallow a route that doesn't exist yet), but is otherwise independent.
- No new external package dependencies are introduced anywhere in this specification (Decisions 8 and 9 explicitly forbid the categories of library that would normally appear here).

---

## 17. Risks and Mitigations

| ID | Risk | Mitigation |
|---|---|---|
| R-1 | Content-integrity gap during review (§8.2) — an in-review article's content can change under the reviewer without any backend safeguard beyond cover mutation's partial protection | Frontend-only partial mitigation in this phase (owning author sees read-only during review); full fix requires a backend decision not yet authorized — flagged at §19 OD-2 for the lead |
| R-2 | D3's response-shape change, while confirmed to have zero current consumers, is still a breaking change in the abstract sense (array → envelope) | Documented explicitly as C with full compatibility analysis (§6.4); no consumer exists to break; new tests close the pre-existing coverage gap |
| R-3 | Soft-`DELETE`-on-`PUBLISHED` semantic gap (audit §8.9) is unresolved by Decision 6, which only restricts the *CMS UI* from offering Delete on non-draft content — the backend endpoint itself still permits it for the article's owner (`article.delete.own`, held by `author`) or any `article.delete.any` holder (`admin` only), in any status, with no audit-log entry (unlike `archive`) | Not fixed in Phase 6 per the lead's explicit instruction not to silently change `DELETE` semantics; flagged again at §19 OD-2 area as a standing gap for a future, separately-authorized change |
| R-4 | `SCHEDULED`-state articles created before Phase 6 (or via direct API use during Phase 6) could confuse editors if the CMS doesn't clearly label "scheduled, but will not auto-publish" | §8.1 table requires the CMS to render this state explicitly with that caveat, not hide it |
| R-5 | Revision-table growth (architecture §14, pre-existing, known risk) | Reinforced, not worsened, by this spec — no autosave (§9) actively avoids making this worse |
| R-6 | No E2E testing tool (e.g., Playwright) is currently installed anywhere in the repo, despite being named in the architecture doc §9 | Flagged at §19 OD-3; D11's E2E requirement cannot be finalized until this is resolved in the design phase |

---

## 18. Deferred Scope

Restated from §2.3 for traceability: scheduled-publish UI (→ future Scheduling phase), rich-text editing, Markdown preview pane (§19 OD-6), tag listing/autocomplete (§19 OD-4), any user/role management UI (§19 OD-5), `packages/ui` component extraction, diff-style revision comparison, the content-integrity gap in §8.2/R-1, the `DELETE`-semantics gap in R-3.

---

## 19. Open Decisions

Items the nine engineering decisions did not resolve, each with a proposed default this draft has taken so the specification remains complete and buildable — the human engineering lead can override any of them without destabilizing the rest of the document.

| ID | Question | Default taken in this draft | If overridden, affects |
|---|---|---|---|
| OD-1 | Real `/cms/*` path segment vs. a `(cms)` route group with no URL prefix | Real segment (§5.1) | §5.1, §6.6/D10's robots rule |
| OD-2 | Should the §8.2 content-integrity gap (edits during review) and the R-3 soft-delete/`archive` semantic gap be fixed at the backend, deferred, or mitigated only in the frontend? | Frontend-only partial mitigation for §8.2; no change at all for R-3 (neither was in the nine decisions) | §8.1–8.2, §17 R-1/R-3, potentially a future C item |
| OD-3 | No E2E tooling (Playwright, per the architecture doc's own §9 table) is installed. Introduce it now, or defer AC-14's E2E requirement to the design phase once tooling is chosen? | Flagged, not resolved; D11's E2E file path/tooling left TBD in §15 | §13, §15 |
| OD-4 | Tags remain free-text-only in Phase 6 (no listing endpoint exists, not authorized) — confirm this is acceptable, or authorize a `GET /v1/tags` addition | Free-text only (§2.3) | §5.4, §6 |
| OD-5 | `POST /auth/register` is not wired into the CMS UI (no admin-provisioning alternative exists) — confirm accounts are provisioned out-of-band (seed/DB) for now, or authorize a registration screen | Login-only; no registration UI | §6.1, §18 |
| OD-6 | Markdown preview pane — Decision 8 permits it "only if it can be done without introducing unnecessary architectural complexity." This draft defers it entirely rather than pick a rendering approach (even a small library is a dependency decision) | Deferred (§5.4, §18) | §5.4 |

---

## 20. Repository vs Phase 6 Alignment

### Existing capabilities that Phase 6 can reuse
Auth (login/refresh/logout), full article CRUD + revisions, all nine workflow transitions, audit log endpoint, full media pipeline, category mutation endpoints (for the new management screen), the `PublicFeedQueryDto`/pagination convention (mirrored for D3), the `ApiErrorResponse`/`PaginatedResponse<T>` envelope types (first real use).

### Missing capabilities (identified in the audit; status after this spec)
Own-permission visibility — **closed by D1.** Author category read access — **closed by D2.** Article list filtering — **closed by D3.** Comment enforcement gap — **closed by D4.** Tag listing — **still missing, deferred (OD-4).** User/role management — **still missing, deferred (§18).** `packages/ui`/`packages/types` domain coverage — **partially closed (D5 types only; no component library).**

### Discrepancies (from the audit, unresolved by this spec)
Stale `README.md`/`docs/architecture/README.md` phase-status banners (§8.1 of the audit) — cosmetic, not touched by this spec. Missing Phase 1 checkpoint doc — not touched. `PublicationSchedule` phase-number conflict between `schema.prisma`'s comment and the architecture doc — not touched, irrelevant until the Scheduling phase. Dead colon-style permissions in seed data — not touched (harmless, unused).

### Potential breaking changes
D3's response-envelope change (zero actual risk — no consumer exists, see §6.4). D4's stricter validation (zero actual risk against existing tests, see §6.5). Neither D1 nor D2 nor D10 has any breaking potential (purely additive).

### Security-sensitive areas
D1 (exposes permission names to the authenticated caller — judged acceptable, §12), D2 (loosens a read gate — judged acceptable and bounded, §12), the four-eyes UI suppression (§7, §8.1 — must not be the *only* enforcement, backend guard remains authoritative and unchanged), error-message handling around 404-not-403 for ownership failures (§11.2 — must not be "improved" into a leakier message).

### Architectural decisions requiring approval
All six items in §19 (OD-1 through OD-6). Nothing else in this specification requires further approval beyond the specification itself, since every other item traces directly to one of the nine decisions already issued.

---

## 21. Proposed High-Level Implementation Waves

High-level only, per instruction — no detailed tasks. Derived from §16's dependency map.

- **Wave 1 — Backend foundation (D1, D2, D4).** Independent of each other and of any frontend work; lowest risk, highest leverage (unblocks everything else). Includes their required tests (§6.2/6.3/6.5).
- **Wave 2 — Backend list capability (D3).** Slightly higher complexity (new DTO, envelope change, determinism requirement); can proceed in parallel with Wave 1 but is a prerequisite for the Wave 4 list/review UI.
- **Wave 3 — CMS shell (D6, D7, D8).** Route tree, session provider, authenticated API client, login page. Depends on Wave 1 (needs D1's permissions to do anything meaningful post-login).
- **Wave 4 — Article authoring & listing (D9 partial: editor, create/edit, list view).** Depends on Waves 1–3 and D2 (category picker) and D3 (list view).
- **Wave 5 — Editorial workflow UI (D9 partial: workflow panel, review queue, revision/audit panels, cover/media picker, category management screen).** Depends on Wave 4 existing; this is where INV6-03/05/06/07 all become user-visible and testable together.
- **Wave 6 — D10 + testing/hardening (D11).** `robots.txt` update, full component-test sweep, the single required full editorial-journey E2E (pending OD-3's tooling decision), full non-regression pass across both apps.

---

*End of specification. Status remains DRAFT — Awaiting Human Engineering Lead Approval. Per the governing instructions, `requirements.md`, `design.md`, and `tasks.md` are not produced at this stage, and no implementation code has been written.*
