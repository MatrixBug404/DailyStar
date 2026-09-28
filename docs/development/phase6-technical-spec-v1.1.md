# Phase 6 Technical Specification — V1.1

**Status:** DRAFT — Awaiting Human Engineering Lead Approval
**Date:** 2026-09-28
**Supersedes:** `phase6-technical-spec-v1.0.md` (retained unchanged in the repository for traceability). V1.1 applies only the targeted corrections listed in the change log below; the architecture is otherwise identical to V1.0.
**Source of truth (inputs):** `dailystar_architecture.md` §13 (Phase 6 definition), the accepted read-only Phase 1 audit (this conversation), and the nine engineering decisions issued by the human engineering lead on 2026-09-28.
**Repository snapshot audited:** post–"chore: clear Phase 5 lint errors" (label `3a7d71f`; no `.git` history was present in the audited snapshot to cryptographically verify the commit hash — see audit caveat).

> [!IMPORTANT]
> This specification is the sole authoritative Phase 6 architecture and design contract. A separate requirements/design/tasks package may be produced only after this specification is approved. Do not write implementation code from this document without that approval.

## V1.1 change log (relative to V1.0)

| # | Correction | Sections touched |
|---|---|---|
| 1 | D3 pagination validation: `limit` valid range is 1–100; out-of-range values return HTTP 400; values are **never clamped silently** | §2.1 (D3), §6.4, §13, §14 (AC-5, new AC-15), §17 R-2 |
| 2 | D3 compatibility wording: replaced "zero actual risk" language; retained explicit C classification | §6.4, §6.5 (parallel wording), §17 R-2, §20 |
| 3 | OD-3 resolved: **Playwright** selected as the Phase 6 browser E2E tool (sole new dependency, devDependency only) | §2.1 (D11, new D12), §13, §14 (new AC-16), §15, §16, §17 (R-6), §19 (OD-3), §21 |
| 4 | Review-time content integrity finding retained; converted into an explicit, separate human decision (OD-2); any future fix classified C-level backend | §8.2, §17 R-1, §18, §19 (OD-2, new OD-7), §20 |
| 5 | Scheduling wording: "No schedule-creation UI is provided in Phase 6"; Cancel Schedule retained only as a recovery action | §1, §2.2, §2.3, §8.1, §14 (AC-8) |
| 6 | C classifications clarified: D1–D4 are the four authorized backend C-level changes; D10 is a separate additive cross-phase C-level change | §1, §2.2, §3 (INV6-14), §20 |
| 7 | All Phase 0–5 invariants (INV6-01 … INV6-15) preserved verbatim; no architecture or dependency added beyond Playwright | — |

**Incidental cross-reference fixes (no behavioral change):** V1.0 §2.3 cited non-existent §20.6 and §9.3, and INV6-14 cited §12 for the itemized test additions (they are in §13). These now point to the correct sections (§17 R-3 / §19 OD-7, §9, §13). The V1.0 R-3/OD-2 combined decision was split so the review-time integrity question (OD-2) is a standalone decision, as required by correction 4; the soft-delete gap is now OD-7.

---

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
| 4 | No schedule-creation UI is provided in Phase 6 (Cancel Schedule retained only as a recovery action) | Scope exclusion (governs B) |
| 5 | Make request-changes/reject comment mandatory | **C** |
| 6 | No "Delete" action on published/archived content in the CMS | Scope constraint (governs B); backend `DELETE` semantics untouched (**A**) |
| 7 | No reorganization of Phase 5 public routes; dedicated CMS route segment | Scope constraint (governs B) |
| 8 | Plain Markdown/text editor, no rich-editor library | Scope constraint (governs B) |
| 9 | React state/context only, no state/data-fetching library | Scope constraint (governs B) |

**C-level changes, stated precisely:**

- **D1–D4 are the four authorized backend C-level contract changes** (Decisions 1, 2, 3, 5 respectively).
- **D10 is a separate, additive, cross-phase C-level change** to the Phase 5-locked `apps/web/app/robots.ts` (adding `Disallow: /cms/`). It is not one of the four backend changes and is not one of the nine decisions; it is a direct consequence of Decision 7's new `/cms/*` route segment and is approved (or not) as part of approving this specification.
- Total C-classified items in this document: **five** (D1–D4 and D10). Everything else is **A** (reuse) or **B** (new, additive Phase 6 work — including the Playwright devDependency, D12).

---

## 2. Scope and Boundaries

### 2.1 Deliverables

| # | Deliverable | Class |
|---|---|---|
| D1 | `GET /api/users/me` returns `roles: string[]` and `permissions: string[]` in addition to existing fields | C |
| D2 | New `category.read` permission, seeded and granted to `author`, `editor`, `admin`; `CategoriesController` GET routes gated on `category.read` instead of `category.manage`; POST/PATCH/DELETE remain gated on `category.manage` (unchanged) | C |
| D3 | `ArticleListQueryDto` (page, limit, status, categoryId, sortBy, order) on `GET /api/v1/articles`; `limit` valid range 1–100 and `page` ≥ 1, with out-of-range values rejected with HTTP 400 (never clamped); response wrapped in the existing (currently unused) `PaginatedResponse<ArticleSummary>` envelope from `@dailystar/types`; deterministic `id ASC` tie-breaker appended server-side | C |
| D4 | Typed `RequestChangesDto` / `RejectDto` (`comment`/`reason`: required, non-empty, ≤1000 chars) replacing the untyped `body: any` currently used by `WorkflowController.requestChanges()` / `.reject()` | C |
| D5 | New shared domain types in `@dailystar/types`: `ArticleStatus`, `Article`, `ArticleSummary`, `ArticleRevisionSummary`, `SafeUser`, `WorkflowTransitionBody`, `MediaSummary`, `CategorySummary` | B |
| D6 | New CMS route tree at `apps/web/app/cms/*` (real path segment, not a `(cms)` route group — see §5.1 and §19 OD-1) | B |
| D7 | CMS auth shell: `SessionProvider` (React Context), `/cms/login` page, route-level redirect-if-unauthenticated | B |
| D8 | Authenticated API client `apps/web/lib/cms-api.ts` (Bearer attachment, 401→refresh-then-retry-once, typed error parsing) | B |
| D9 | Article list/filter view, draft editor (plain Markdown/text), review queue, workflow action panel, revision history panel, audit log panel, cover/media picker, category management screen (editor/admin) | B |
| D10 | `robots.txt` gains `Disallow: /cms/` alongside the existing `Disallow: /api/` | C — separate, additive, cross-phase change (touches a Phase 5–locked file); distinct from the four backend C changes D1–D4 |
| D11 | CMS component tests + one full editorial-journey browser E2E written with **Playwright** (login → draft → submit → review → approve → publish → visible on the public site) | B |
| D12 | Playwright as a devDependency of `apps/web`: `@playwright/test`, `playwright.config.ts`, an `e2e/` directory, a single documented run script, and E2E fixture provisioning (an author and an editor account; no new backend endpoint) | B |

### 2.2 In scope

- Everything in §2.1.
- Reuse, unmodified, of: auth endpoints, article CRUD/revision endpoints, all nine workflow transition endpoints (the `schedule` endpoint remains callable on the backend but has no Phase 6 UI; `cancel-schedule` is wired only as a recovery action for an already-`SCHEDULED` article — see §8.1 — per Decision 4), media endpoints, audit endpoint, existing category mutation endpoints (now consumed by a new editor/admin-only category management screen).
- The four backend C-level contract changes D1–D4, scoped exactly as decided, plus the separate additive cross-phase change D10 to `robots.ts` — no additional backend changes.

### 2.3 Explicitly out of scope (Not Phase 6)

- **Schedule-creation UI.** No schedule-creation UI is provided in Phase 6 (Decision 4): no control that calls `POST /v1/articles/:id/schedule`, no date/time picker, and no copy implying automatic publishing (the backend has no worker — see INV6-13). The single exception is **Cancel Schedule**, offered only as a recovery action for an article that is already `SCHEDULED` (§8.1).
- Any Delete action surfaced for `PUBLISHED`/`ARCHIVED` articles (Decision 6). The backend `DELETE /v1/articles/:id` endpoint itself is **not modified** — see §17 R-3 and §19 OD-7 for why this is deliberately left as a separate, unauthorized decision.
- Rich-text/WYSIWYG editing (Tiptap, ProseMirror, Slate, Lexical, or any equivalent) — Decision 8.
- Autosave. No requirement or code evidence supports it; on the contrary, §9 documents concrete evidence *against* naive autosave (every `PATCH` creates a permanent, immutable revision — see INV6-02). Explicit **Save** actions only.
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
| INV6-13 | `SCHEDULED` has no automated firing mechanism (no `PublicationSchedule` table, no worker). Phase 6 provides no schedule-creation UI and must not build or imply scheduling automation. | Audit finding, confirmed in code; deferred to a future Scheduling phase |
| INV6-14 | Non-regression: all existing Phase 1–5 unit and E2E tests continue to pass unchanged, except the specific, itemized additions in §13 required by the five C-classified items in this document (D1–D4 and D10). | Phase 5 INV-12, adapted |
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
- **Compatibility impact:** additive only; every existing field is preserved verbatim. No existing test asserts an exact/closed response shape for `getMe` beyond individual field checks (confirmed: no snapshot-style assertion found). **No known breaking impact.**
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

**New query DTO**, mirroring the established `PublicFeedQueryDto` convention (`apps/api/src/modules/public/dto/public-feed-query.dto.ts`), which rejects invalid pagination values through `class-validator` (`@Min`/`@Max`) rather than adjusting them:

```ts
class ArticleListQueryDto {
  page: number = 1;          // @Type(() => Number) @IsInt @Min(1)        — page < 1 => HTTP 400
  limit: number = 20;        // @Type(() => Number) @IsInt @Min(1) @Max(100) — limit < 1 or > 100 => HTTP 400
  status?: ArticleStatus[];  // CSV-parsed, @IsEnum(ArticleStatus, { each: true })
  categoryId?: string;       // @IsUUID
  sortBy: 'updatedAt' | 'createdAt' | 'title' = 'updatedAt'; // @IsIn
  order: 'asc' | 'desc' = 'desc';                            // @IsIn
}
```

- **Pagination validation (authoritative):** the valid `limit` range is **1–100 inclusive**. `limit < 1` and `limit > 100` are each rejected with **HTTP 400**; `page < 1` is likewise rejected with HTTP 400; non-integer or non-numeric `page`/`limit` values are rejected with HTTP 400. Out-of-range values are **never clamped or corrected silently** — neither in the DTO, the controller, nor the service. The upper bound of 100 numerically matches `MediaController.listOwn`, but that endpoint clamps silently (`Math.min(100, Math.max(1, …))`) and D3 deliberately does **not** copy that behavior; the validation behavior follows `PublicFeedQueryDto`, which returns 400. The envelope's `limit` field always echoes the exact, validated request value (or the default of 20).
- **Response envelope:** `PaginatedResponse<ArticleSummary>` — `{ data: ArticleSummary[], total, page, limit }`. This type already exists, unused, in `@dailystar/types`; this is its first real consumer.
- **Determinism:** the service appends `id: 'asc'` as a secondary Prisma `orderBy` key after whatever `sortBy` was requested, so pagination is stable across pages even when many rows share a `sortBy` value — the same principle Phase 5's FTS search already applies (`rank DESC, publishedAt DESC, Article.id ASC`), extended here to the authenticated list endpoint for the same reason (deterministic sort was explicitly required by the lead).
- **Ownership scoping is unchanged and authoritative:** the existing rule — non-`article.read.any` callers only ever see `primaryAuthorId = self` — is applied to the Prisma `where` clause *before* any of the new filters, exactly as today. The new filters narrow within that boundary; they cannot be used to see outside it.
- **Why required:** the audit (§4.4) established this endpoint currently returns every accessible article, unfiltered and unpaginated — unworkable for a review queue or a growing draft list, and confirmed by grep to have **zero existing test coverage** (no unit, controller, or E2E test exercises `findAll`/`GET /v1/articles` today).
- **Affected module/contract:** `ArticlesModule` (`ArticlesController.findAll`, `ArticlesService.findAll`), Phase 2.
- **Compatibility impact:** replacing a bare array with a paginated envelope object is **technically a breaking API change**. No in-repository consumer of `GET /v1/articles` exists (confirmed: no unit test, controller test, E2E test, or frontend code calls it today), so **no known current DailyStar consumer is expected to break**. However, the change would break any undocumented external consumer that depends on the array response shape, and this specification does not claim otherwise. The explicit **C** classification is therefore retained. This change also introduces the first test coverage this endpoint has ever had.
- **Required tests:** new unit tests for `ArticlesService.findAll` covering each filter independently and in combination, tie-breaker determinism across two pages with equal `sortBy` values, and ownership-scoping is preserved under every filter combination for a non-`article.read.any` caller; new E2E tests for `GET /v1/articles` covering: (a) `limit=1` and `limit=100` succeed (200) and the response `limit` echoes the requested value; (b) `limit=0`, `limit=-1`, and `limit=101` each return **HTTP 400** (an explicit assertion that `limit=101` does **not** return a 100-item page, i.e. no silent clamping); (c) `page=0` returns 400; (d) non-numeric `limit`/`page` return 400; (e) default `page=1`/`limit=20`/`sortBy=updatedAt`/`order=desc` when omitted; and (f) 400 on an invalid `status` value. The `ArticleListQueryDto` gets its own unit tests for the same boundaries.

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
- **Compatibility impact:** this **tightens** the contract — a call that previously succeeded with an omitted or empty `comment` will now receive `400 Bad Request`. Confirmed by direct inspection of `apps/api/test/workflow.e2e-spec.ts`: the only two existing calls to these transitions **both already send a non-empty `comment`**; no existing test omits it. **No existing test in the repository will break.** However, tightening a previously-optional field is technically a breaking API change for any undocumented external consumer that omitted `comment`; that is the intended, authorized effect of the correction, and the C classification is retained.
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
| `APPROVED` | — | Publish (no Schedule action — Decision 4); editing content/cover reverts to `DRAFT` (INV6-05, warn first) |
| `PUBLISHED` | — | Archive; editing content/cover reverts to `DRAFT` (INV6-05, warn first) |
| `ARCHIVED` | — | (terminal in current backend — no un-archive transition exists) |
| `SCHEDULED` | — | **No schedule-creation UI is provided in Phase 6** (Decision 4), so the CMS never moves an article into this state. If an article is already `SCHEDULED` (e.g., via direct API use), the CMS renders that state — clearly labelled as *scheduled, but will not auto-publish* (INV6-13) — and offers **Cancel Schedule as a recovery action only**, because that transition returns the article to a supported, unambiguous state (`APPROVED`); not offering it would strand such an article with no CMS-native way back. |

### 8.2 Flagged integrity gap — content edits during review (new finding, not previously in the audit)

While drafting this contract, direct inspection of `ArticlesService.update()` shows it **only** auto-reverts to `DRAFT` for `APPROVED`/`SCHEDULED` articles (INV6-05). It applies **no restriction at all** for `SUBMITTED_FOR_REVIEW`/`UNDER_REVIEW` — an author (or any `article.update.any` holder) can `PATCH` an article's content while it is mid-review, which silently advances `currentRevisionId` out from under the reviewer. Because `WorkflowService.approve()` approves whatever `article.currentRevisionId` happens to be *at the moment of the approve call* (not the revision the reviewer was actually looking at), this is a real content-integrity gap: a reviewer could approve — and an editor subsequently publish — content the reviewer never actually reviewed. Cover mutation has a partial version of this protection already (INV6-07); plain content edits have none.

This finding is **retained unchanged from V1.0**. It was not addressed by the lead's nine decisions, and **this specification does not change backend behavior in response to it.** It is recorded as an explicit, standalone human decision — **OD-2 (§19): must content editing be blocked while an article is `SUBMITTED_FOR_REVIEW` / `UNDER_REVIEW`?**

- **Default taken in this draft:** no backend change (option a in OD-2). Phase 6 applies only the frontend-level mitigation already shown in §8.1 ("View only" for the owning author during review). This reduces but does not eliminate the risk, because an `article.update.any` holder (an editor) can still `PATCH` another user's in-review article, and any direct API caller can as well.
- **Classification of any future fix:** any backend fix — rejecting content `PATCH` during review, or auto-reverting to `DRAFT` on such an edit — would be a **C-level modification** of the Phase 2 `ArticlesService.update()` contract (and, for the auto-revert variant, a new use of `WorkflowService.revertToDraft()` that must preserve INV6-01, INV6-02, INV6-05 and the audit invariant INV6-12). It would need its own compatibility analysis and tests and **must not be introduced under D1–D4 or D10**. It is therefore *not* one of the five C items counted in §1.

See §17 R-1 and §19 OD-2.

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
| Backend unit | New tests for D1 (permission resolution correctness per role), D2 (read/manage split per role), D3 (filter/pagination/determinism/ownership-scoping, and `limit`/`page` boundary validation returning 400 with no clamping), D4 (DTO validation) — see each item in §6 for specifics |
| Backend E2E | New cases per §6.2/6.3/6.4/6.5/6.6; full regression run of all existing suites (`auth`, `articles`, `workflow`, `categories-tags`, `media`, `public`, `app`) to confirm INV6-14 |
| Frontend component | React Testing Library coverage for: `SessionProvider` (login/refresh/logout/permission exposure), the editor form (validation, dirty-state prompt, INV6-05 confirmation dialog), the workflow action panel (correct actions rendered per role × status per §8.1's matrix, four-eyes button suppression), the article list (filter/sort/pagination UI against D3), error-code-specific rendering (§11.2) |
| Frontend browser E2E (**Playwright**) | At least one full editorial journey run in a real browser against the real API: login as author → create draft → submit for review → login as editor → start review → approve → publish → confirm visible on the (unchanged) public site. This satisfies the architecture doc's own Phase 6 acceptance criterion verbatim and the tool the architecture doc §9 already names for this purpose. Playwright specs live in a dedicated `apps/web/e2e/` directory and must be excluded from the existing Jest run (`apps/web/jest.config.ts`) so the two runners do not collide. Fixtures provision an author and an editor account at the database level (the seed creates roles but no users, and no role-assignment API exists — §4.5 of the audit); no new backend endpoint is introduced for this. |
| Non-regression | Existing `apps/web/app/__tests__/*` (og-route, page, robots [updated per D10], sitemap-route) must continue to pass. |

---

## 14. Acceptance Criteria Matrix

| # | Criterion | Class | Verifies |
|---|---|---|---|
| AC-1 | A non-technical editor can complete the entire draft-to-publish flow through the UI without direct API calls | B | Architecture §13 Phase 6 criterion, verbatim |
| AC-2 | An author cannot see or trigger any action the backend would reject for their role/ownership (buttons hidden, not just disabled-with-error) | B | §7, §8.1 |
| AC-3 | `GET /api/users/me` returns correct `roles`/`permissions` for each seeded role, additively | C | §6.2 |
| AC-4 | An `author`-role token can `GET /v1/categories`/`:id` (200) but still cannot `POST`/`PATCH`/`DELETE` (403) | C | §6.3 |
| AC-5 | `GET /v1/articles` supports `page`/`limit`/`status`/`categoryId`/`sortBy`/`order`, returns a `PaginatedResponse<ArticleSummary>`, is deterministic across pages, and never returns another user's drafts to a non-`article.read.any` caller regardless of filters; the array → envelope change is recorded as a technically breaking API change (no known in-repository consumer) | C | §6.4 |
| AC-6 | `request-changes`/`reject` return `400` when `comment` is omitted or empty; existing non-empty-comment call sites in `workflow.e2e-spec.ts` still pass unchanged | C | §6.5 |
| AC-7 | Editing an `APPROVED`/`SCHEDULED` article's content or cover shows an explicit confirmation before the request is sent, naming the Draft-revert/schedule-cancel consequence | B | §11.4, INV6-05 |
| AC-8 | No schedule-creation UI is provided anywhere in the CMS (no call to `POST /v1/articles/:id/schedule`, no date/time picker); "Cancel Schedule" appears only as a recovery action on an already-`SCHEDULED` article | B | §8.1, Decision 4 |
| AC-9 | No "Delete" action is rendered for `PUBLISHED`/`ARCHIVED` articles anywhere in the CMS | B | Decision 6 |
| AC-10 | No rich-text editor dependency appears in `apps/web/package.json`; the body field is a plain text/Markdown control | B | Decision 8 |
| AC-11 | No Redux/Zustand/React Query/SWR dependency appears in `apps/web/package.json` (Playwright, a devDependency, is the sole Phase 6 addition — AC-16) | B | Decision 9 |
| AC-12 | Existing Phase 5 public routes and their tests are unmodified except `robots.ts`/`robots.test.ts` (D10) | C (D10) / A (rest) | INV6-15 |
| AC-13 | A four-eyes violation attempt (own article) never even renders the Approve control for that user | B | INV6-03 |
| AC-14 | Full non-regression: all pre-existing unit/E2E suites (backend and frontend) pass unchanged | — | INV6-14 |
| AC-15 | `GET /v1/articles` returns HTTP 400 for `limit` < 1, `limit` > 100, `page` < 1, and non-numeric `page`/`limit`; `limit=1` and `limit=100` succeed; no out-of-range value is ever silently clamped (e.g., `limit=101` never yields a 100-item page) | C | §6.4 |
| AC-16 | A Playwright browser E2E test executes the complete editorial journey (login → draft → submit → review → approve → publish → visible on the public site) and passes; Playwright is present only as a devDependency, and `apps/web/package.json` gains no other new dependency | B | §13, D11/D12 |

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
| `apps/web/e2e/editorial-journey.spec.ts` | D11 — Playwright editorial-journey test |
| `apps/web/playwright.config.ts` | D12 — Playwright configuration |
| `apps/web/e2e/fixtures/*` (author/editor account provisioning; exact form left to the design phase) | D12 |

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
| `apps/web/package.json` | D12 — add `@playwright/test` as a devDependency and one E2E run script; no other dependency change |
| `apps/web/jest.config.ts` | D12 — exclude `e2e/` from the Jest run so Playwright specs are not executed by Jest |
| `pnpm-lock.yaml` | D12 — lockfile update for the Playwright devDependency |
| `.github/workflows/ci.yml` | D12 — E2E job wiring (Wave 6); exact job design left to the design phase |

**No file deletions. No migration files (D1–D4 require zero Prisma schema changes — confirmed per-item in §6).** V1.0 is left in place unmodified alongside this V1.1 document.

---

## 16. Dependency Map

- D6–D9 (frontend routes/session/API client) depend on D1 (need `roles`/`permissions` to gate anything) and D2 (need a category source for the editor form).
- D9 article editor depends on D3 only for the *list* view, not the editor itself (create/edit uses the existing single-article endpoints, unmodified).
- D4 is independent of D1–D3; can be built and tested in isolation.
- D10 depends on D6 existing (can't disallow a route that doesn't exist yet), but is otherwise independent.
- **D11/D12 (Playwright E2E)** depend on everything else: D1–D4 (backend contracts), D6–D9 (the CMS UI under test), and D10 only insofar as the E2E's public-site check must not regress. D12's fixtures depend on the existing `seed.ts` roles; they need database-level user provisioning because no user-creation/role-assignment API exists beyond `POST /auth/register` (which always assigns `author`).
- **The only new external package dependency introduced by Phase 6 is `@playwright/test`, as a devDependency of `apps/web`.** It is explicitly justified by the architecture doc §9 (which names Playwright for the login → publish journey) and by the Phase 6 acceptance criterion, which cannot be verified without a real browser. No runtime dependency is added, and Decisions 8 and 9 continue to forbid rich-editor and state/data-fetching libraries.

---

## 17. Risks and Mitigations

| ID | Risk | Mitigation |
|---|---|---|
| R-1 | Content-integrity gap during review (§8.2) — an in-review article's content can change under the reviewer without any backend safeguard beyond cover mutation's partial protection | Frontend-only partial mitigation in this phase (owning author sees read-only during review). No backend change is made. Whether to block content editing during review is an explicit separate human decision (§19 OD-2); any future fix is a **C-level** backend change to the Phase 2 `ArticlesService.update()` contract and is not part of D1–D4 or D10 |
| R-2 | D3's array → paginated-envelope change is technically a breaking API change. No in-repository consumer exists, so no known current DailyStar consumer is expected to break, but undocumented external consumers relying on the array shape would | Retained as an explicit **C** item with full compatibility analysis (§6.4); new tests (including strict `limit`/`page` 400 behavior) close the pre-existing coverage gap; the lead should confirm no external consumer exists before approving |
| R-3 | Soft-`DELETE`-on-`PUBLISHED` semantic gap (audit §8.9) is unresolved by Decision 6, which only restricts the *CMS UI* from offering Delete on non-draft content — the backend endpoint itself still permits it for the article's owner (`article.delete.own`, held by `author`) or any `article.delete.any` holder (`admin` only), in any status, with no audit-log entry (unlike `archive`) | Not fixed in Phase 6 per the lead's explicit instruction not to silently change `DELETE` semantics; recorded as a standing gap at §19 OD-7 for a future, separately-authorized change (any fix to `DELETE` semantics would be a separate C-level backend change) |
| R-4 | `SCHEDULED`-state articles created before Phase 6 (or via direct API use during Phase 6) could confuse editors if the CMS doesn't clearly label "scheduled, but will not auto-publish" | §8.1 table requires the CMS to render this state explicitly with that caveat, not hide it |
| R-5 | Revision-table growth (architecture §14, pre-existing, known risk) | Reinforced, not worsened, by this spec — no autosave (§9) actively avoids making this worse |
| R-6 | Playwright (selected for Phase 6 browser E2E, OD-3 resolved) is a new dependency with real cost: browser binaries, a full running stack (API, Postgres, Redis, MinIO) for the E2E, database-level fixture provisioning of an editor account (no role-assignment API exists), and possible flakiness/CI-time growth. The existing CI (`ci.yml`) has no E2E job and Jest could accidentally pick up Playwright specs | Playwright added as a devDependency only, in `apps/web`; specs isolated under `apps/web/e2e/` and excluded from Jest (§13, §15); exactly one required editorial-journey spec (not a large suite); CI wiring scoped to Wave 6 and detailed in the design phase; fixtures use DB-level provisioning, no new backend endpoint |

---

## 18. Deferred Scope

Restated from §2.3 for traceability: schedule-creation UI and automated scheduled publishing (→ future Scheduling phase), rich-text editing, Markdown preview pane (§19 OD-6), tag listing/autocomplete (§19 OD-4), any user/role management UI (§19 OD-5), `packages/ui` component extraction, diff-style revision comparison, the review-time content-integrity fix (§8.2/R-1 — pending decision OD-2; any fix is C-level), the `DELETE`-semantics gap in R-3 (pending decision OD-7; any fix is C-level).

---

## 19. Open Decisions

Items the nine engineering decisions did not resolve (OD-3 is now resolved), each with a proposed default this draft has taken so the specification remains complete and buildable — the human engineering lead can override any of them without destabilizing the rest of the document.

| ID | Question | Default taken in this draft | If overridden, affects |
|---|---|---|---|
| OD-1 | Real `/cms/*` path segment vs. a `(cms)` route group with no URL prefix | Real segment (§5.1) | §5.1, §6.6/D10's robots rule |
| OD-2 | **Must content editing be blocked while an article is `SUBMITTED_FOR_REVIEW` / `UNDER_REVIEW`?** Options: (a) no backend change, frontend mitigation only; (b) reject content `PATCH` in those states server-side; (c) auto-revert to `DRAFT` on such an edit (reusing the Pattern A / `WorkflowService.revertToDraft()` mechanism). Options (b) and (c) are **C-level backend changes** to the Phase 2 `ArticlesService.update()` contract, with their own compatibility analysis and tests, and are not part of D1–D4 or D10 | (a) — no backend change; frontend-only partial mitigation (§8.1, §8.2) | §8.1–8.2, §17 R-1, a future C item if (b) or (c) is chosen |
| OD-3 | **RESOLVED in V1.1.** Browser E2E tooling: **Playwright** (`@playwright/test`) is selected for Phase 6. It is the sole new dependency (devDependency in `apps/web`), justified by architecture doc §9 and the Phase 6 acceptance criterion | Resolved — see D11/D12, §13, §15, §16, AC-16, R-6, Wave 6 | — |
| OD-4 | Tags remain free-text-only in Phase 6 (no listing endpoint exists, not authorized) — confirm this is acceptable, or authorize a `GET /v1/tags` addition | Free-text only (§2.3) | §5.4, §6 |
| OD-5 | `POST /auth/register` is not wired into the CMS UI (no admin-provisioning alternative exists) — confirm accounts are provisioned out-of-band (seed/DB) for now, or authorize a registration screen | Login-only; no registration UI | §6.1, §18 |
| OD-6 | Markdown preview pane — Decision 8 permits it "only if it can be done without introducing unnecessary architectural complexity." This draft defers it entirely rather than pick a rendering approach (even a small library is a dependency decision) | Deferred (§5.4, §18) | §5.4 |
| OD-7 | **Soft-`DELETE` vs. `archive` semantics on published content** (split out of V1.0's OD-2). `DELETE /v1/articles/:id` has no status restriction and writes no audit entry, so deleting a `PUBLISHED` article removes it from the public site without an `ARCHIVE` transition (INV6-09). Decision 6 only hides Delete in the CMS UI; should the backend semantics ever change? Any change would be a **C-level** backend change | No backend change (per Decision 6); CMS never offers Delete on `PUBLISHED`/`ARCHIVED` | §17 R-3, a future C item if changed |

---

## 20. Repository vs Phase 6 Alignment

### Existing capabilities that Phase 6 can reuse
Auth (login/refresh/logout), full article CRUD + revisions, all nine workflow transitions, audit log endpoint, full media pipeline, category mutation endpoints (for the new management screen), the `PublicFeedQueryDto`/pagination convention (mirrored for D3), the `ApiErrorResponse`/`PaginatedResponse<T>` envelope types (first real use).

### Missing capabilities (identified in the audit; status after this spec)
Own-permission visibility — **closed by D1.** Author category read access — **closed by D2.** Article list filtering — **closed by D3.** Comment enforcement gap — **closed by D4.** Tag listing — **still missing, deferred (OD-4).** User/role management — **still missing, deferred (§18).** `packages/ui`/`packages/types` domain coverage — **partially closed (D5 types only; no component library).**

### Discrepancies (from the audit, unresolved by this spec)
Stale `README.md`/`docs/architecture/README.md` phase-status banners (§8.1 of the audit) — cosmetic, not touched by this spec. Missing Phase 1 checkpoint doc — not touched. `PublicationSchedule` phase-number conflict between `schema.prisma`'s comment and the architecture doc — not touched, irrelevant until the Scheduling phase. Dead colon-style permissions in seed data — not touched (harmless, unused).

### Potential breaking changes
D3's array → paginated-envelope change is **technically a breaking API change**: no known in-repository consumer exists, so no known current DailyStar consumer is expected to break, but undocumented external consumers would (§6.4). D4's stricter validation is likewise technically breaking for any undocumented external caller that omitted `comment`; no existing test breaks (§6.5). D1, D2 and D10 are purely additive.

### Security-sensitive areas
D1 (exposes permission names to the authenticated caller — judged acceptable, §12), D2 (loosens a read gate — judged acceptable and bounded, §12), the four-eyes UI suppression (§7, §8.1 — must not be the *only* enforcement, backend guard remains authoritative and unchanged), error-message handling around 404-not-403 for ownership failures (§11.2 — must not be "improved" into a leakier message).

### Architectural decisions requiring approval
Open decisions OD-1, OD-2, OD-4, OD-5, OD-6 and OD-7 in §19 (OD-3 is resolved: Playwright). Also to be approved with this specification: the five C-classified items (D1–D4 and the separate cross-phase D10) and the single new devDependency (Playwright). Nothing else requires further approval, since every other item traces directly to one of the nine decisions already issued.

---

## 21. Proposed High-Level Implementation Waves

High-level only, per instruction — no detailed tasks. Derived from §16's dependency map.

- **Wave 1 — Backend foundation (D1, D2, D4).** Independent of each other and of any frontend work; lowest risk, highest leverage (unblocks everything else). Includes their required tests (§6.2/6.3/6.5).
- **Wave 2 — Backend list capability (D3).** Slightly higher complexity (new DTO, envelope change, determinism requirement); can proceed in parallel with Wave 1 but is a prerequisite for the Wave 4 list/review UI.
- **Wave 3 — CMS shell (D6, D7, D8).** Route tree, session provider, authenticated API client, login page. Depends on Wave 1 (needs D1's permissions to do anything meaningful post-login).
- **Wave 4 — Article authoring & listing (D9 partial: editor, create/edit, list view).** Depends on Waves 1–3 and D2 (category picker) and D3 (list view).
- **Wave 5 — Editorial workflow UI (D9 partial: workflow panel, review queue, revision/audit panels, cover/media picker, category management screen).** Depends on Wave 4 existing; this is where INV6-03/05/06/07 all become user-visible and testable together.
- **Wave 6 — D10 + testing/hardening (D11, D12).** `robots.txt` update, full component-test sweep, Playwright setup (devDependency, config, Jest exclusion, fixtures, CI wiring) and the single required full editorial-journey Playwright E2E, full non-regression pass across both apps.

---

*End of specification (V1.1). Status remains DRAFT — Awaiting Human Engineering Lead Approval. Per the governing instructions, `requirements.md`, `design.md`, and `tasks.md` are not produced at this stage, and no implementation code has been written.*
