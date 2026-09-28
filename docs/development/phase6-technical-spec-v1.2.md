# Phase 6 Technical Specification — V1.2

**Status:** APPROVED — Human Engineering Lead Approved
**Date:** 2026-09-28

Approved by: Yatharth Tripathi

Approved on: 2026-09-28
**Supersedes:** `phase6-technical-spec-v1.1.md` (retained unchanged, as is `phase6-technical-spec-v1.0.md`). V1.2 is a consistency-only revision: it applies only the corrections listed in the V1.2 change log below and does not redesign the architecture.
**Source of truth (inputs):** `dailystar\_architecture.md` §13 (Phase 6 definition), the accepted read-only Phase 1 audit (this conversation), and the nine engineering decisions issued by the human engineering lead on 2026-09-28.
**Repository snapshot audited:** post–"chore: clear Phase 5 lint errors" (label `3a7d71f`; no `.git` history was present in the audited snapshot to cryptographically verify the commit hash — see audit caveat).

> \[!IMPORTANT]
> This specification is the sole authoritative Phase 6 architecture and design contract. A separate requirements/design/tasks package may be produced only after this specification is approved. Do not write implementation code from this document without that approval.

## V1.2 change log (relative to V1.1)

|#|Correction|Sections touched|
|-|-|-|
|1|CMS auth route structure: `/cms/login` is no longer a child of an auth-gated layout. The gate moves to `apps/web/app/cms/(protected)/layout.tsx`; all protected pages move under the `(protected)` route group, which does **not** appear in URLs. Phase 5 public routes are unchanged|§1, §2.1 (D6, D7), §4 (diagram), §5.1, §5.2, §5.3, §7, §13, §15, §16, §21, AC-17|
|2|D1 module dependency: the "no new cross-module dependency" statement is removed. The single `UsersModule` → shared RBAC permission-resolution dependency required by D1 is explicitly permitted, as a shared injectable `PermissionResolverService` reused by `PermissionGuard` and `UsersService`, with a leaf-module structure that cannot create a circular dependency|§2.1 (D1), §4, §6.2, §15, §16, §17 (R-7), §20, AC-3, AC-18|
|3|Open decisions converted: OD-1, OD-4, OD-5, OD-6 → **LOCKED**; OD-2, OD-7 → **DEFERRED** (no Phase 6 backend fix; any future fix is a separately authorized C-level change); OD-3 remains RESOLVED|§5.1, §8.2, §17, §18, §19, §20|
|4|D4 DTO field name locked to `comment: string`; the `reason` option is removed|§2.1 (D4), §6.5, §14 (AC-6), §15|

**Incidental consistency fixes (needed so the four corrections do not contradict the rest of the document):**

* **D1 affected-contract list widened.** Because the resolver must be injectable into `PermissionGuard`, D1 also touches the Phase 1 `modules/rbac` directory (a behavior-preserving refactor of the guard) and adds the missing `RbacModule` class. V1.1 listed only `UsersModule`. Grounded in the repository: `modules/rbac` currently has only `decorators/` and `guards/` — no module class, and `PermissionGuard` is instantiated per host module with `Reflector` only and reads the global `prisma` singleton.
* **D4 `expectedVersion` handling.** V1.1 said the new DTOs would add a required `@IsNumber() @Min(1)` on `expectedVersion`. That would make a missing `expectedVersion` on these two routes fail ValidationPipe before the service runs, replacing the existing `VERSION\_REQUIRED` error code that INV6-04 and §11.2 rely on. V1.2 keeps presence/mismatch enforcement exactly where it is today (in `WorkflowService`) and validates only `comment` as new.
* **Post-review amendments (applied in place; no V1.3 is created).** (1) The stale "V1.0 is left in place…" sentence in §15 now names both V1.0 and V1.1. (2) D1's inactive-user behavior is changed from "200 with empty `roles`/`permissions`" to **401 Unauthorized** (active → 200, inactive → 401, missing → existing 404), with a corresponding E2E assertion, so `GET /users/me` success and `PermissionGuard` agree on whether an inactive user is authenticated (§6.2, §5.2, §14 AC-3, §20). The earlier "empty roles/permissions" behavior is removed everywhere.
* **Session provider hosting.** Login and protected pages must share one in-memory session, so a non-gating `apps/web/app/cms/layout.tsx` (provider only, no redirects) is retained above both `login` and `(protected)`.

\---

## V1.1 change log (relative to V1.0) — retained for traceability

|#|Correction|Sections touched|
|-|-|-|
|1|D3 pagination validation: `limit` valid range is 1–100; out-of-range values return HTTP 400; values are **never clamped silently**|§2.1 (D3), §6.4, §13, §14 (AC-5, new AC-15), §17 R-2|
|2|D3 compatibility wording: replaced "zero actual risk" language; retained explicit C classification|§6.4, §6.5 (parallel wording), §17 R-2, §20|
|3|OD-3 resolved: **Playwright** selected as the Phase 6 browser E2E tool (sole new dependency, devDependency only)|§2.1 (D11, new D12), §13, §14 (new AC-16), §15, §16, §17 (R-6), §19 (OD-3), §21|
|4|Review-time content integrity finding retained; converted into an explicit, separate human decision (OD-2); any future fix classified C-level backend|§8.2, §17 R-1, §18, §19 (OD-2, new OD-7), §20|
|5|Scheduling wording: "No schedule-creation UI is provided in Phase 6"; Cancel Schedule retained only as a recovery action|§1, §2.2, §2.3, §8.1, §14 (AC-8)|
|6|C classifications clarified: D1–D4 are the four authorized backend C-level changes; D10 is a separate additive cross-phase C-level change|§1, §2.2, §3 (INV6-14), §20|
|7|All Phase 0–5 invariants (INV6-01 … INV6-15) preserved verbatim; no architecture or dependency added beyond Playwright|—|

**Incidental cross-reference fixes (no behavioral change):** V1.0 §2.3 cited non-existent §20.6 and §9.3, and INV6-14 cited §12 for the itemized test additions (they are in §13). These now point to the correct sections (§17 R-3 / §19 OD-7, §9, §13). The V1.0 R-3/OD-2 combined decision was split so the review-time integrity question (OD-2) is a standalone decision, as required by correction 4; the soft-delete gap is now OD-7.

\---

## Classification legend (used throughout)

* **A — Existing behavior reused.** No backend change. Phase 6 consumes an existing, already-tested contract as-is.
* **B — New Phase 6 behavior.** New frontend code, or a genuinely new backend capability with no prior equivalent, added without touching any existing contract.
* **C — Controlled modification of an earlier-phase contract.** Every C item below states: why it's required, the affected module/contract, its compatibility impact, and the tests it requires. No C item in this document was chosen unilaterally — each corresponds to one of the human engineering lead's nine decisions.

\---

## 1\. Executive Summary

Phase 6 delivers the editorial CMS frontend for the capabilities already built in Phases 1–5: authentication, draft authoring, the nine-transition editorial workflow, media/cover management, revision history, and audit visibility. Per the architecture doc's own Phase 6 definition (§13), this is fundamentally a **frontend phase** — but the accepted Phase 1 audit identified four real gaps in the existing backend contract that block a usable CMS (no way to learn the caller's own permissions, no author-readable category list, no server-side article filtering/pagination, and an undocumented-but-unenforced comment requirement on two workflow transitions). The human engineering lead has authorized narrow, additive corrections to close exactly these four gaps (Decisions 1, 2, 3, 5 below) and made five further scoping decisions (Decisions 4, 6, 7, 8, 9) that this specification encodes as binding constraints.

**Decisions incorporated (see §20 for full classification detail):**

|#|Decision|Classification|
|-|-|-|
|1|Extend `GET /api/users/me` with resolved roles/permissions|**C**|
|2|Split category read access from category management|**C**|
|3|Add filtering/pagination/deterministic sort to `GET /api/v1/articles`|**C**|
|4|No schedule-creation UI is provided in Phase 6 (Cancel Schedule retained only as a recovery action)|Scope exclusion (governs B)|
|5|Make request-changes/reject comment mandatory|**C**|
|6|No "Delete" action on published/archived content in the CMS|Scope constraint (governs B); backend `DELETE` semantics untouched (**A**)|
|7|No reorganization of Phase 5 public routes; dedicated CMS route segment (`/cms/\*`, LOCKED — OD-1)|Scope constraint (governs B)|
|8|Plain Markdown/text editor, no rich-editor library|Scope constraint (governs B)|
|9|React state/context only, no state/data-fetching library|Scope constraint (governs B)|

**C-level changes, stated precisely:**

* **D1–D4 are the four authorized backend C-level contract changes** (Decisions 1, 2, 3, 5 respectively).
* **D10 is a separate, additive, cross-phase C-level change** to the Phase 5-locked `apps/web/app/robots.ts` (adding `Disallow: /cms/`). It is not one of the four backend changes and is not one of the nine decisions; it is a direct consequence of Decision 7's new `/cms/\*` route segment and is approved (or not) as part of approving this specification.
* Total C-classified items in this document: **five** (D1–D4 and D10). Everything else is **A** (reuse) or **B** (new, additive Phase 6 work — including the Playwright devDependency, D12).

\---

## 2\. Scope and Boundaries

### 2.1 Deliverables

|#|Deliverable|Class|
|-|-|-|
|D1|`GET /api/users/me` returns `roles: string\[]` and `permissions: string\[]` in addition to existing fields. Implemented through one shared, injectable `PermissionResolverService` in `modules/rbac`, reused by `PermissionGuard` (behavior-preserving refactor) and `UsersService`; adds an `RbacModule` class; introduces the single permitted `UsersModule` → RBAC dependency (§4, §6.2)|C|
|D2|New `category.read` permission, seeded and granted to `author`, `editor`, `admin`; `CategoriesController` GET routes gated on `category.read` instead of `category.manage`; POST/PATCH/DELETE remain gated on `category.manage` (unchanged)|C|
|D3|`ArticleListQueryDto` (page, limit, status, categoryId, sortBy, order) on `GET /api/v1/articles`; `limit` valid range 1–100 and `page` ≥ 1, with out-of-range values rejected with HTTP 400 (never clamped); response wrapped in the existing (currently unused) `PaginatedResponse<ArticleSummary>` envelope from `@dailystar/types`; deterministic `id ASC` tie-breaker appended server-side|C|
|D4|Typed `RequestChangesDto` / `RejectDto` with the field name locked to `comment: string` (required, non-empty, ≤1000 chars) replacing the untyped `body: any` currently used by `WorkflowController.requestChanges()` / `.reject()`. The existing request field name `comment` is preserved; no `reason` field is introduced|C|
|D5|New shared domain types in `@dailystar/types`: `ArticleStatus`, `Article`, `ArticleSummary`, `ArticleRevisionSummary`, `SafeUser`, `WorkflowTransitionBody`, `MediaSummary`, `CategorySummary`|B|
|D6|New CMS route tree at `apps/web/app/cms/\*` — a real `/cms` path segment (LOCKED, §19 OD-1) with an ungated `login/` page and all other pages under the `(protected)` route group, which does not appear in URLs (§5.1)|B|
|D7|CMS auth shell: `SessionProvider` (React Context) mounted in a non-gating `cms/layout.tsx`, the ungated `/cms/login` page, and the gating `cms/(protected)/layout.tsx` (redirect-if-unauthenticated)|B|
|D8|Authenticated API client `apps/web/lib/cms-api.ts` (Bearer attachment, 401→refresh-then-retry-once, typed error parsing)|B|
|D9|Article list/filter view, draft editor (plain Markdown/text), review queue, workflow action panel, revision history panel, audit log panel, cover/media picker, category management screen (editor/admin)|B|
|D10|`robots.txt` gains `Disallow: /cms/` alongside the existing `Disallow: /api/`|C — separate, additive, cross-phase change (touches a Phase 5–locked file); distinct from the four backend C changes D1–D4|
|D11|CMS component tests + one full editorial-journey browser E2E written with **Playwright** (login → draft → submit → review → approve → publish → visible on the public site)|B|
|D12|Playwright as a devDependency of `apps/web`: `@playwright/test`, `playwright.config.ts`, an `e2e/` directory, a single documented run script, and E2E fixture provisioning (an author and an editor account; no new backend endpoint)|B|

### 2.2 In scope

* Everything in §2.1.
* Reuse, unmodified, of: auth endpoints, article CRUD/revision endpoints, all nine workflow transition endpoints (the `schedule` endpoint remains callable on the backend but has no Phase 6 UI; `cancel-schedule` is wired only as a recovery action for an already-`SCHEDULED` article — see §8.1 — per Decision 4), media endpoints, audit endpoint, existing category mutation endpoints (now consumed by a new editor/admin-only category management screen).
* The four backend C-level contract changes D1–D4, scoped exactly as decided, plus the separate additive cross-phase change D10 to `robots.ts` — no additional backend changes.

### 2.3 Explicitly out of scope (Not Phase 6)

* **Schedule-creation UI.** No schedule-creation UI is provided in Phase 6 (Decision 4): no control that calls `POST /v1/articles/:id/schedule`, no date/time picker, and no copy implying automatic publishing (the backend has no worker — see INV6-13). The single exception is **Cancel Schedule**, offered only as a recovery action for an article that is already `SCHEDULED` (§8.1).
* Any Delete action surfaced for `PUBLISHED`/`ARCHIVED` articles (Decision 6). The backend `DELETE /v1/articles/:id` endpoint itself is **not modified** — see §17 R-3 and §19 OD-7 for why this is deliberately left as a separate, unauthorized decision.
* Rich-text/WYSIWYG editing (Tiptap, ProseMirror, Slate, Lexical, or any equivalent) — Decision 8.
* Autosave. No requirement or code evidence supports it; on the contrary, §9 documents concrete evidence *against* naive autosave (every `PATCH` creates a permanent, immutable revision — see INV6-02). Explicit **Save** actions only.
* Redux/Zustand/React Query/SWR or any other state/data-fetching library — Decision 9.
* Reorganizing `apps/web/app/{page.tsx,article,category,search,sitemap.xml,og-image,robots.ts}` into a `(public)` route group — Decision 7.
* Tag listing/autocomplete UI. No `GET` endpoint exists for tags (`TagsController` has only `PATCH`/`DELETE`) and this gap was not included in the lead's nine decisions. Tags remain a free-text, comma/chip input that relies on the existing inline `findOrCreate` behavior in `ArticlesService` (category A). LOCKED for Phase 6 — see §19 OD-4.
* Any user/role management screen. No backend endpoint exists (`user:manage`/`role:manage` permissions are seeded but unused by any controller) and this was not authorized. See §19 OD-5.
* A markdown-to-HTML preview pane. Permitted conditionally by Decision 8 but deferred — see §19 OD-6 for the reasoning.
* `WebSockets`, background workers, new UI frameworks, new state-management libraries, Elasticsearch/OpenSearch — no evidence found for any of these; none introduced.
* Populating `packages/ui` with a component library. Components are built co-located under `apps/web/app/cms/\*\*` for Phase 6; extraction into `packages/ui` is deferred until real duplication with the public site appears (avoids speculative abstraction).

\---

## 3\. Preserved Invariants

These carry forward unmodified from Phases 1–5, cross-checked against the actual code during the Phase 1 audit. No Phase 6 change may weaken or contradict any of them.

|ID|Invariant|Source|
|-|-|-|
|INV6-01|`WorkflowModule` is the sole mutator of `Article.status`. No Phase 6 frontend or backend code writes status directly.|Architecture §15 rule 8 / Phase 3|
|INV6-02|`ArticleRevision` rows are append-only; every content-changing `PATCH` creates a new revision. Nothing is ever edited in place.|Phase 2/3, confirmed in `ArticlesService.update()`|
|INV6-03|Four-eyes principle: a user cannot approve their own article (`WorkflowService.approve()` throws unconditionally if `primaryAuthorId === user.sub`). No CMS affordance may attempt to bypass this — the "Approve" action must not even be rendered for the article's own author.|Phase 3|
|INV6-04|`expectedVersion` is mandatory on every workflow transition call; the CMS must always send the article's current `version`.|Phase 3|
|INV6-05|Editing content (`PATCH`) or cover on an `APPROVED`/`SCHEDULED` article silently reverts it to `DRAFT` and clears `approvedRevisionId`/`scheduledFor` ("Pattern A"). The CMS must warn the user before this happens, not just let it happen silently.|Phase 4|
|INV6-06|Cover mutation is rejected with `ARTICLE\_COVER\_IMMUTABLE` once `PUBLISHED` or `ARCHIVED`.|Phase 4|
|INV6-07|Cover mutation is rejected with `COVER\_MUTATION\_NOT\_PERMITTED` for the owning author (not for `article.update.any` holders) while `SUBMITTED\_FOR\_REVIEW`/`UNDER\_REVIEW`.|Phase 4|
|INV6-08|Slug is immutable once `Article.publishedAt IS NOT NULL`, regardless of later title edits.|Phase 2/5 (PB-01)|
|INV6-09|Public visibility triple gate: `status = 'PUBLISHED' AND deletedAt IS NULL AND currentPublishedRevisionId IS NOT NULL`. Any CMS action that sets `deletedAt` on a still-`PUBLISHED` article removes it from the public site immediately, without a status change or an `ARCHIVE` audit entry — see §17 R-3.|Phase 5 INV-01|
|INV6-10|`currentPublishedRevisionId` is the only pointer the public site ever reads. The CMS must never conflate it with `currentRevisionId` or `approvedRevisionId` in any UI copy or preview affordance.|Phase 5 INV-02|
|INV6-11|`PublicController` carries no auth guards and Phase 6 must never route authenticated/mutating CMS actions through it.|Phase 5 INV-10|
|INV6-12|Every workflow transition writes exactly one `AuditLog` row inside the same DB transaction as the state change.|Phase 3|
|INV6-13|`SCHEDULED` has no automated firing mechanism (no `PublicationSchedule` table, no worker). Phase 6 provides no schedule-creation UI and must not build or imply scheduling automation.|Audit finding, confirmed in code; deferred to a future Scheduling phase|
|INV6-14|Non-regression: all existing Phase 1–5 unit and E2E tests continue to pass unchanged, except the specific, itemized additions in §13 required by the five C-classified items in this document (D1–D4 and D10).|Phase 5 INV-12, adapted|
|INV6-15|Existing public routes (`/`, `/article/\[slug]`, `/category/\[slug]`, `/search`, `/sitemap.xml`, `/robots.txt`, `/og-image/\[slug]`) are not moved, renamed, or restructured.|This spec, per Decision 7|

\---

## 4\. System Architecture

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
                     │  │ /cms/login   (NEW, ungated)  │ │
                     │  │ /cms/\*  under (protected)    │ │
                     │  │   layout = the only auth gate│ │
                     │  └───────────────┬───────────┘ │
                     └──────────────────┼───────────────┘
                                        │ fetch, Bearer + credentials:'include'
                     ┌──────────────────▼───────────────┐
                     │  apps/api  (NestJS, UNCHANGED       │
                     │  module boundaries)                  │
                     │  auth · users(+D1) · rbac(+D1) ·      │
                     │  articles(+D3) · workflow(+D4) ·      │
                     │  media · categories-tags(+D2) ·       │
                     │  audit · public · search              │
                     └──────────────────┬───────────────┘
                                        │
                     ┌──────────────────▼───────────────┐
                     │ PostgreSQL · Redis · MinIO (unchanged) │
                     └───────────────────────────────────┘
```

Four existing NestJS feature modules receive small changes (D1: `UsersModule`; D2: `CategoriesTagsModule`; D3: `ArticlesModule`; D4: `WorkflowModule`), and D1 additionally formalizes the existing `modules/rbac` directory as a module. No migration is required for any of D1–D4 — see each item's compatibility note in §20.

**Module-dependency rule (replaces V1.1's blanket "no new cross-module dependency" statement).** Exactly **one** new cross-module dependency is introduced and permitted: **`UsersModule` → the shared RBAC permission-resolution abstraction** required by D1. No other module gains any new cross-module dependency (D2, D3 and D4 stay inside their existing modules). The D1 structure is:

```
PermissionGuard ─────────► PermissionResolverService ◄───────── UsersService
 (modules/rbac/guards)      (modules/rbac, provided and          (modules/users)
                             exported by RbacModule)
UsersModule ──imports──► RbacModule (@Global, leaf module)
AuthModule  ──imports──► UsersModule            (existing edge, unchanged)
```

* `RbacModule` is a **leaf**: it imports no feature module (no `UsersModule`, `AuthModule`, `ArticlesModule`, `AuditModule`, …) and depends only on the same `prisma` singleton (`database/client`) that `PermissionGuard` already uses today. Every dependency edge therefore points *toward* `RbacModule`, never out of it, so **a circular dependency is structurally impossible**; `RbacModule` must never import a feature module.
* `RbacModule` is `@Global()`, mirroring the existing `AuthModule` pattern, because `PermissionGuard` is not registered in any module: Nest instantiates it inside each host module's injector via `@UseGuards(...)`, so the resolver must be resolvable in every host module. `UsersModule` still lists `RbacModule` in its `imports` so the D1 dependency is explicit in the module graph.
* `PermissionResolverService` is the single place that runs the user → roles → permissions query (currently inlined in `PermissionGuard.canActivate()`); neither `PermissionGuard` nor `UsersService` may contain a second copy of it.

\---

## 5\. CMS Frontend Architecture

### 5.1 Route structure

Per Decision 7 ("dedicated CMS route structure," existing routes untouched) and the **LOCKED** OD-1, Phase 6 adds a real `cms` path segment. The only route group introduced is `(protected)`, **nested inside** `cms/`, and it exists purely to scope the auth-gating layout; route-group folders never appear in URLs.

```
apps/web/app/
├── page.tsx                    ← Phase 5, unchanged
├── article/\[slug]/page.tsx     ← Phase 5, unchanged
├── category/\[slug]/page.tsx    ← Phase 5, unchanged
├── search/page.tsx             ← Phase 5, unchanged
├── sitemap.xml/route.ts        ← Phase 5, unchanged
├── og-image/\[slug]/route.ts    ← Phase 5, unchanged
├── robots.ts                   ← Phase 5, D10 additive change only
├── layout.tsx                  ← Phase 5, unchanged (root <html>/<body>)
└── cms/                        ← NEW, Phase 6 (real path segment)
    ├── layout.tsx              # NON-GATING: mounts SessionProvider only.
    │                           #   No redirects, no auth checks.
    ├── session-provider.tsx
    ├── login/
    │   └── page.tsx            # /cms/login — OUTSIDE (protected), never gated
    └── (protected)/            # route group: NOT part of any URL
        ├── layout.tsx          # THE ONLY AUTH GATE (client-rendered)
        ├── page.tsx            # /cms — dashboard (role-aware landing)
        ├── articles/
        │   ├── page.tsx        # /cms/articles — list (D3-backed)
        │   ├── new/page.tsx    # /cms/articles/new — create draft
        │   └── \[id]/page.tsx   # /cms/articles/\[id] — editor + workflow panel
        │                       #   + revisions + audit, as sections/tabs
        ├── review/
        │   └── page.tsx        # /cms/review — list pre-filtered to
        │                       #   SUBMITTED\_FOR\_REVIEW / UNDER\_REVIEW
        └── categories/
            └── page.tsx        # /cms/categories — editor/admin only, full CRUD
```

**Resulting URLs:** `/cms/login`, `/cms`, `/cms/articles`, `/cms/articles/new`, `/cms/articles/\[id]`, `/cms/review`, `/cms/categories`. The `(protected)` folder name never appears in any of them. There must be **no** `apps/web/app/cms/page.tsx` (it would collide with `(protected)/page.tsx`, both resolving to `/cms`).

**Why the gate moved (fixes a V1.1 defect).** In V1.1, `cms/layout.tsx` was described as an auth-gated layout while `/cms/login` was its child. An unauthenticated visitor to `/cms/login` would have been redirected by the gate back to `/cms/login`, indefinitely. In V1.2 the login page is a sibling of `(protected)`, not a descendant of any gating layout.

**Gating and redirect rules (normative — no other redirect logic exists):**

|Component|`status = 'loading'`|`status = 'unauthenticated'`|`status = 'authenticated'`|
|-|-|-|-|
|`cms/layout.tsx` (provider only)|renders children|renders children|renders children|
|`cms/(protected)/layout.tsx` (the gate)|renders a loading state; **never redirects while loading**|`router.replace('/cms/login')`|renders children|
|`cms/login/page.tsx`|renders a loading state (form hidden)|renders the login form|`router.replace('/cms')`|

The two redirects fire on **mutually exclusive** session states from one source of truth (`SessionProvider`), so no redirect cycle can occur. After a successful login the destination is always `/cms` (no return-to-path feature is specified in Phase 6). The gate is client-rendered (`'use client'`), consistent with the architecture doc §3.2 ("CMS is client-heavily-rendered since it's behind auth and SEO doesn't apply"). The Phase 5 root `apps/web/app/layout.tsx` is untouched; `cms/layout.tsx` is nested inside it. The Phase 5 public route structure is completely unchanged, and no Phase 5 file is moved or renamed (INV6-15).

**Why a real `/cms` segment (OD-1, LOCKED).** A `(cms)` route group would produce URLs with no `/cms` prefix at all (e.g. `/login`, `/articles`), risking collision with future public routes and leaving the authenticated surface without a clean prefix for `robots.txt` (D10) or any future edge rule.

### 5.2 Session and state management (Decision 9)

No new library. A single React Context, `SessionProvider` (`apps/web/app/cms/session-provider.tsx`), mounted by the non-gating `apps/web/app/cms/layout.tsx` so that `/cms/login` and everything under `(protected)` share **one** in-memory session (the access token survives client-side navigation from login into the protected area), holds:

```
{ user: SafeUser | null, roles: string\[], permissions: string\[],
  accessToken: string | null, status: 'loading'|'authenticated'|'unauthenticated',
  login(), logout(), refresh() }
```

* On first mount of `cms/layout.tsx` the provider starts in `loading` and attempts one silent `POST /api/auth/refresh` (cookie-based, see §6.1); on success it calls `GET /api/users/me` (D1) and becomes `authenticated`, on failure it becomes `unauthenticated`. A successful `POST /api/auth/login` from the login page stores the returned access token, calls `GET /api/users/me`, and sets `authenticated`. **`authenticated` is set only when `GET /api/users/me` returns 200.** A 401 from `GET /api/users/me` (including the inactive-user case, §6.2) is handled by the API client's single refresh-and-retry (§5.3); if it still fails, the session is cleared and the status becomes `unauthenticated`.
* `permissions: string\[]` from D1 drives all UI-gating (button visibility, route redirects) — this directly resolves audit gap §4.1 / Open Decision §9.1.
* Access token held in memory only (component state via the context), never in `localStorage`/`sessionStorage`, consistent with the existing backend design (refresh token is the only persisted credential, and it's an httpOnly cookie the frontend never touches directly).
* All other state (form fields, list filters, loading/error flags) is local `useState`/`useReducer` per component. No global store beyond `SessionProvider`.

### 5.3 API client (D8)

`apps/web/lib/cms-api.ts`, separate from the existing untouched `apps/web/lib/api.ts` (Phase 5, public-only, no auth):

* Wraps `fetch` against `API\_BASE` (reuses the existing `NEXT\_PUBLIC\_API\_URL` env convention), attaching `Authorization: Bearer <accessToken>` and `credentials: 'include'` on every call (the cookie carries the refresh token cross-origin per the existing CORS configuration — no change needed there).
* On a `401`, attempts exactly one `POST /api/auth/refresh`, retries the original request once with the new token, and if that also fails, clears the session (status becomes `unauthenticated`), after which the `(protected)` layout redirects to `/cms/login` per the rules in §5.1. The API client itself never navigates; it only clears session state. This prevents both infinite refresh loops and redirect cycles.
* Parses the existing `ApiErrorResponse` shape (`statusCode`, `message`, `error`, `timestamp`, `path`) already defined in `@dailystar/types`, and additionally surfaces the specific string codes the backend already returns inside `message` for 409/403 cases (`VERSION\_REQUIRED`, `VERSION\_MISMATCH`, `CONCURRENCY\_CONFLICT`, `ARTICLE\_COVER\_IMMUTABLE`, `COVER\_MUTATION\_NOT\_PERMITTED`, `FILE\_TOO\_LARGE`) so the UI can render a specific message rather than a generic error (see §11).

### 5.4 Editor (Decision 8)

* A plain `<textarea>`-based (or minimal contentEditable-free) Markdown/text editor bound directly to `ArticleRevision.body`, matching the storage model exactly as documented in the audit (§8.4: plain text, Markdown by convention, chosen explicitly in `phase2\_articles\_core\_spec.md` over structured JSON).
* No Tiptap/ProseMirror/Slate/Lexical. No autosave (see §2.3).
* A live Markdown preview pane is **not included in v1** — permitted-but-conditional per Decision 8, deferred and LOCKED for Phase 6 per §19 OD-6.
* Title, excerpt, category (D2-backed picker), tags (free-text chip input, no listing endpoint — see §2.3), and cover image (existing Media endpoints) are plain form fields alongside the body textarea.

\---

## 6\. Backend/API Contract

### 6.1 Authentication (A — fully reused, no changes)

|Endpoint|Behavior (unchanged)|
|-|-|
|`POST /api/auth/register`|Creates a user, always assigned the `author` role. **Not wired into the Phase 6 UI** — the CMS is login-only and user provisioning remains outside the CMS (§19 OD-5, LOCKED); the endpoint itself is untouched.|
|`POST /api/auth/login`|Returns `{ accessToken, user }` in body; sets httpOnly `refreshToken` cookie (`path=/api/auth`, `SameSite=Strict`).|
|`POST /api/auth/refresh`|Reads cookie, returns new `{ accessToken }`, rotates cookie.|
|`POST /api/auth/logout`|Revokes refresh session, clears cookie.|

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
  "roles": \["editor"],
  "permissions": \["article.create", "article.read.any", "..."] }
```

* **Why required:** the audit (§4.1) established that no endpoint exists today for a client to learn its own resolved permission set. Without it, the CMS cannot correctly gate UI (e.g., whether to render "Approve"), only discover capability by trial-and-error against 403s — an explicitly rejected option per the lead's decision.
* **Affected module/contract:** `UsersModule` (`UsersController.getMe`, `UsersService`, `users.module.ts`) and the `modules/rbac` directory (a **behavior-preserving** refactor of `PermissionGuard` plus the new `RbacModule` and `PermissionResolverService`), all Phase 1. `app.module.ts` gains the `RbacModule` import.
* **Permitted dependency and resolver contract (locked):** `getMe` carries only `AuthGuard`, so `request.userPermissions` is not populated on that route, and the query that produces it lives inline in `PermissionGuard.canActivate()`. D1 extracts that query — unchanged in what it selects and returns — into a single shared, injectable **`PermissionResolverService`** (`apps/api/src/modules/rbac/permission-resolver.service.ts`), provided and exported by a new **`RbacModule`** (`apps/api/src/modules/rbac/rbac.module.ts`, `@Global()`, leaf module — see the module-dependency rule in §4). The resolver exposes one operation: given a user id, it returns that user's resolved role names and permission names, or `null` if the user does not exist or is inactive.

  * `PermissionGuard` calls the resolver and maps `null` to the **same** `UnauthorizedException('User not found or inactive')` it throws today; it still sets `request.userPermissions` and still applies the same `every(...)` permission check and the same `ForbiddenException('Insufficient permissions')`. Its externally observable behavior (status codes, messages, ordering) does not change.
  * `UsersService` calls the same resolver to populate `roles` and `permissions` for `getMe`. `getMe` resolves the user's status as follows (**locked**):

|User state|`GET /api/users/me` result|
|-|-|
|Active user|**200** + existing fields + `roles` + `permissions`|
|Inactive user (valid token, `isActive = false`)|**401 Unauthorized** — `UnauthorizedException('User not found or inactive')`, the same exception and message `PermissionGuard` already throws for this state|
|Missing user|**404** — the existing `NotFoundException('User not found')`, unchanged|

    Order of evaluation: `getMe` first loads the user via the existing `findById`; a missing user yields the existing 404 before the resolver is consulted. If the user exists, the resolver is called; a `null` result (inactive user) yields the 401 above. The previous behavior — returning the profile with HTTP 200 for an inactive user — is **removed**; there is no `roles: \[]` / `permissions: \[]` fallback. (If the account is deleted between the two calls, the resolver's `null` yields the same 401; that race is acceptable.) **Rationale:** the CMS `SessionProvider` treats a successful `GET /users/me` as "authenticated", and `PermissionGuard` already treats inactive users as unauthorized; the two must not disagree about whether an inactive user is authenticated. `AuthService.login` and `AuthService.refresh` already reject inactive users, so with this rule an inactive user can no longer obtain or keep a session anywhere in the system.

  * This is the **only** new cross-module dependency in Phase 6: `UsersModule` → `RbacModule`. `RbacModule` imports no feature module, so no circular dependency can arise; any future change that makes `RbacModule` import a feature module violates this specification.
* **Compatibility impact:** the **response shape is additive** — every existing field is preserved verbatim, and no existing test asserts an exact/closed response shape for `getMe` (confirmed: no snapshot-style assertion found). The **status behavior for inactive users is tightened**: an inactive user holding a still-valid access token previously received 200 and now receives 401. No existing test in the repository exercises an inactive user against `/users/me` (confirmed: no `isActive` reference in `apps/api/test/`), so no known in-repository consumer or test breaks; an undocumented external caller relying on 200 for inactive users would, which is the intended, authorized effect (C classification retained). The `PermissionGuard` refactor is behavior-preserving by requirement, not by assumption — see the guard-equivalence tests below.
* **Required tests:** unit test asserting `roles`/`permissions` match the seeded role/permission data for each of the three seeded roles; E2E test confirming the field is present and correct after login for an `author`, an `editor`, and an `admin` account; **E2E assertion for the inactive-user case: a user who has logged in and is then deactivated (`isActive = false`, set directly in the database) receives HTTP 401 from `GET /api/users/me` with the still-valid access token, while an active user still receives 200 and a nonexistent user id in a valid token still receives the existing 404;** **resolver unit tests** (correct role/permission sets for each seeded role; `null` for a missing user and for an inactive user); **guard-equivalence unit tests** (`PermissionGuard` still returns 401 for a missing/inactive user, 403 for an unmet permission, passes when all required permissions are held, and still sets `request.userPermissions`); a **DI-graph check** that the application module graph compiles with `RbacModule` present (the existing `app.e2e-spec.ts` bootstrap must still pass, proving no circular import); a **full regression run of every existing backend E2E suite**, because the guard sits in front of nearly every protected route (architecture §9 non-negotiable RBAC test-matrix rule); and a regression run of the existing `auth.e2e-spec.ts` (which already contains the only `GET /users/me` tests — an unauthenticated 401 case and an authenticated success case; no dedicated users unit or E2E spec exists) to confirm no existing assertion breaks. Unit tests for `UsersService`/`UsersController.getMe` cover all three rows of the state table. New role/permission assertions belong in that file or a new `users.e2e-spec.ts`.

### 6.3 D2 — Category read/manage split (C)

* **New permission:** `category.read`, seeded via the existing idempotent `seed.ts` upsert pattern, granted to `author`, `editor`, and `admin` (all three — editor/admin already have `category.manage`, which is a superset in practice, but `category.read` is granted explicitly to all three so the guard logic is uniform and doesn't need an OR-condition across two permission names).
* **`CategoriesController` change:** the current class-level `@RequirePermission('category.manage')` (gating *every* route including `GET`) is removed. `GET /v1/categories` and `GET /v1/categories/:id` are re-decorated with `@RequirePermission('category.read')`. `POST`, `PATCH`, `DELETE` keep `@RequirePermission('category.manage')`, unchanged.
* **Why required:** the audit (§4.2) established that authors have no authenticated way to list categories for a picker; the only alternative (the public categories endpoint) excludes any category with zero published articles, which is unsuitable for authoring.
* **Affected module/contract:** `CategoriesTagsModule` (`CategoriesController`), Phase 2.
* **Compatibility impact:** strictly additive/loosening for `GET` routes. `editor`/`admin` behavior is unchanged (they already had `category.manage`, and both existing E2E/unit tests for those roles continue to pass unmodified). No schema/migration required — `category.read` is a seed-data row, not a schema change, satisfying the lead's constraint that this "must not require a database schema change." **No removal of any existing capability from any role.**
* **Required tests:** unit/E2E test that an `author`-role token can now successfully call `GET /v1/categories` and `GET /v1/categories/:id` (previously 403); regression test confirming an `author`-role token still receives 403 on `POST`/`PATCH`/`DELETE /v1/categories`; regression run of `categories.controller.spec.ts`, `categories.service.spec.ts`, and `categories-tags.e2e-spec.ts`.
* **Tags are explicitly not part of D2** — no `TagsController` change is authorized (see §2.3, §19 OD-4).

### 6.4 D3 — Article list filtering/pagination/sort (C)

**New query DTO**, mirroring the established `PublicFeedQueryDto` convention (`apps/api/src/modules/public/dto/public-feed-query.dto.ts`), which rejects invalid pagination values through `class-validator` (`@Min`/`@Max`) rather than adjusting them:

```ts
class ArticleListQueryDto {
  page: number = 1;          // @Type(() => Number) @IsInt @Min(1)        — page < 1 => HTTP 400
  limit: number = 20;        // @Type(() => Number) @IsInt @Min(1) @Max(100) — limit < 1 or > 100 => HTTP 400
  status?: ArticleStatus\[];  // CSV-parsed, @IsEnum(ArticleStatus, { each: true })
  categoryId?: string;       // @IsUUID
  sortBy: 'updatedAt' | 'createdAt' | 'title' = 'updatedAt'; // @IsIn
  order: 'asc' | 'desc' = 'desc';                            // @IsIn
}
```

* **Pagination validation (authoritative):** the valid `limit` range is **1–100 inclusive**. `limit < 1` and `limit > 100` are each rejected with **HTTP 400**; `page < 1` is likewise rejected with HTTP 400; non-integer or non-numeric `page`/`limit` values are rejected with HTTP 400. Out-of-range values are **never clamped or corrected silently** — neither in the DTO, the controller, nor the service. The upper bound of 100 numerically matches `MediaController.listOwn`, but that endpoint clamps silently (`Math.min(100, Math.max(1, …))`) and D3 deliberately does **not** copy that behavior; the validation behavior follows `PublicFeedQueryDto`, which returns 400. The envelope's `limit` field always echoes the exact, validated request value (or the default of 20).
* **Response envelope:** `PaginatedResponse<ArticleSummary>` — `{ data: ArticleSummary\[], total, page, limit }`. This type already exists, unused, in `@dailystar/types`; this is its first real consumer.
* **Determinism:** the service appends `id: 'asc'` as a secondary Prisma `orderBy` key after whatever `sortBy` was requested, so pagination is stable across pages even when many rows share a `sortBy` value — the same principle Phase 5's FTS search already applies (`rank DESC, publishedAt DESC, Article.id ASC`), extended here to the authenticated list endpoint for the same reason (deterministic sort was explicitly required by the lead).
* **Ownership scoping is unchanged and authoritative:** the existing rule — non-`article.read.any` callers only ever see `primaryAuthorId = self` — is applied to the Prisma `where` clause *before* any of the new filters, exactly as today. The new filters narrow within that boundary; they cannot be used to see outside it.
* **Why required:** the audit (§4.4) established this endpoint currently returns every accessible article, unfiltered and unpaginated — unworkable for a review queue or a growing draft list, and confirmed by grep to have **zero existing test coverage** (no unit, controller, or E2E test exercises `findAll`/`GET /v1/articles` today).
* **Affected module/contract:** `ArticlesModule` (`ArticlesController.findAll`, `ArticlesService.findAll`), Phase 2.
* **Compatibility impact:** replacing a bare array with a paginated envelope object is **technically a breaking API change**. No in-repository consumer of `GET /v1/articles` exists (confirmed: no unit test, controller test, E2E test, or frontend code calls it today), so **no known current DailyStar consumer is expected to break**. However, the change would break any undocumented external consumer that depends on the array response shape, and this specification does not claim otherwise. The explicit **C** classification is therefore retained. This change also introduces the first test coverage this endpoint has ever had.
* **Required tests:** new unit tests for `ArticlesService.findAll` covering each filter independently and in combination, tie-breaker determinism across two pages with equal `sortBy` values, and ownership-scoping is preserved under every filter combination for a non-`article.read.any` caller; new E2E tests for `GET /v1/articles` covering: (a) `limit=1` and `limit=100` succeed (200) and the response `limit` echoes the requested value; (b) `limit=0`, `limit=-1`, and `limit=101` each return **HTTP 400** (an explicit assertion that `limit=101` does **not** return a 100-item page, i.e. no silent clamping); (c) `page=0` returns 400; (d) non-numeric `limit`/`page` return 400; (e) default `page=1`/`limit=20`/`sortBy=updatedAt`/`order=desc` when omitted; and (f) 400 on an invalid `status` value. The `ArticleListQueryDto` gets its own unit tests for the same boundaries.

### 6.5 D4 — Mandatory comment on request-changes/reject (C)

* **Current state:** `WorkflowController.requestChanges()` / `.reject()` take `@Body() body: any` — no DTO class exists for either, so `class-validator`/the global `ValidationPipe` currently validates nothing on these two routes. `WorkflowService.requestChanges()`/`.reject()` accept `comment` as a fully optional parameter.
* **New DTOs (field name locked):**

```ts
class RequestChangesDto { comment: string; expectedVersion?: number; } // comment: @IsString @IsNotEmpty @MaxLength(1000)
class RejectDto         { comment: string; expectedVersion?: number; } // identical shape
```

* The request field is **`comment: string`** — the name the backend already reads today (`body.comment`) and the name the two existing E2E calls already send. **No `reason` field exists or is accepted** (`forbidNonWhitelisted: true` will reject it as an unknown property). The stored audit key is unchanged: the service continues to write `metadata: { reason: comment }` into `AuditLog` exactly as it does today; that internal storage key is not part of the request contract and is not renamed.
* `comment` is the only newly validated field. `expectedVersion` stays declared as an optional numeric field so that **presence and mismatch enforcement remain exactly where they are today** — in `WorkflowService.getArticle()` (`VERSION\_REQUIRED` → 400, `VERSION\_MISMATCH` → 409). The DTOs must not add a required-validation rule to `expectedVersion`, because doing so would replace the existing `VERSION\_REQUIRED` error code on these two routes with a generic validation error (INV6-04, §11.2).
* **Why required:** the lead's Decision 5, closing the exact gap the audit flagged in §8.8 — the architecture doc's own transition table (§5.2) documents both transitions as "requires a non-empty comment/rejection reason," but the code has never enforced it. The lead has explicitly classified closing this gap as a controlled Phase 6 contract correction.
* **Affected module/contract:** `WorkflowModule` (`WorkflowController`, `WorkflowService.requestChanges`/`.reject`), Phase 3.
* **Compatibility impact:** this **tightens** the contract — a call that previously succeeded with an omitted or empty `comment` will now receive `400 Bad Request`. Confirmed by direct inspection of `apps/api/test/workflow.e2e-spec.ts`: the only two existing calls to these transitions **both already send a non-empty `comment`**; no existing test omits it. **No existing test in the repository will break.** However, tightening a previously-optional field is technically a breaking API change for any undocumented external consumer that omitted `comment`; that is the intended, authorized effect of the correction, and the C classification is retained.
* **Required tests:** new E2E cases asserting `400` when `comment` is omitted or empty-string for both `request-changes` and `reject`; regression run of the existing two passing cases in `workflow.e2e-spec.ts` (lines \~173, \~207) to confirm they still succeed unchanged; unit tests for the new DTOs' validation rules (including: `comment` omitted → 400; `comment` empty string → 400; `comment` of 1001 characters → 400; a body carrying `reason` instead of `comment` → 400; a valid `comment` with an omitted `expectedVersion` still yields the existing `VERSION\_REQUIRED` 400 from the service).

### 6.6 D10 — `robots.txt` addition (C, minor)

* **Change:** add `Disallow: /cms/` to the existing Phase-5-locked robots policy (`allow '/', disallow '/api/'`, sitemap pointer), which did not and could not anticipate the CMS route segment since it didn't exist yet.
* **Affected module/contract:** `apps/web/app/robots.ts`, Phase 5 (locked decision table, §19 of `phase5-technical-spec-v1.5.md`).
* **Compatibility impact:** additive only; the existing `Disallow: /api/` and `Allow: /` rules are untouched.
* **Required tests:** update `apps/web/app/\_\_tests\_\_/robots.test.ts` to assert the new rule alongside the existing ones.

### 6.7 Everything else consumed by the CMS (A — reused as-is)

|Endpoint(s)|Notes|
|-|-|
|`POST/GET/PATCH/DELETE /api/v1/articles/:id`, `/restore`, `/revisions`, `/revisions/:revisionId`, `/cover`|Unmodified. `expectedVersion` handling on plain `PATCH` remains optional-but-recommended-always (INV asymmetry noted in the audit, §5) — the CMS must always send it to get concurrency protection; this is a frontend discipline requirement, not a backend change.|
|`POST /api/v1/articles/:id/{submit-review,start-review,approve,publish,archive}`|Unmodified.|
|`POST /api/v1/articles/:id/{schedule,cancel-schedule}`|Unmodified on the backend; **not called by the Phase 6 UI** (Decision 4).|
|`GET /api/v1/articles/:id/audit`|Unmodified.|
|`POST/GET/DELETE /api/v1/media\*`|Unmodified; already paginated.|
|`POST/GET/PATCH/DELETE /api/v1/categories\*`|POST/PATCH/DELETE unmodified (still `category.manage`-gated); GET modified per D2.|

\---

## 7\. Authentication and Authorization

* **Token handling:** exactly as documented in §6.1/§5.3 — access token in memory via `SessionProvider` (mounted in the non-gating `cms/layout.tsx`), refresh token in the existing httpOnly cookie, never touched directly by frontend code.
* **Route gating:** enforced solely by `cms/(protected)/layout.tsx` (§5.1). `/cms/login` is deliberately outside it. Client-side gating is UX only; the backend guards remain the enforcement point.
* **UI gating:** every workflow-action button, the category management screen, and any `article.read.any`-dependent list scope check the `permissions` array from `SessionProvider` (sourced from D1) before rendering. The backend remains the actual enforcement point in every case (existing guards, unchanged) — frontend gating is UX only, per architecture §3.6's existing principle, carried forward unmodified.
* **Four-eyes in the UI:** the "Approve" action must not be rendered (not just disabled) when `article.primaryAuthorId === session.user.id`, matching INV6-03.
* **Ownership scoping in list views:** the D3 filters operate within, not instead of, the existing ownership rule (§6.4) — an author's article list can never show another author's drafts regardless of query parameters, exactly as today.
* **No new roles, no new auth flow, no MFA** — none introduced; none evidenced as required.

\---

## 8\. Editorial Workflow Interaction

### 8.1 State → available actions matrix (as actually implemented, not the aspirational architecture-doc table)

|Status|Author (owner) can|Editor/Admin can|
|-|-|-|
|`DRAFT`|Edit, Delete (soft, own — `article.delete.own`), Submit for Review|Edit (any); Submit for Review; Delete (any) is **admin only** (`article.delete.any` is seeded for `admin` alone — the `editor` role holds neither `article.delete.any` nor `article.delete.own`)|
|`SUBMITTED\_FOR\_REVIEW`|View only (see §8.2 caveat)|Start Review|
|`UNDER\_REVIEW`|View only (see §8.2 caveat)|Request Changes, Reject, Approve (not on own article — INV6-03)|
|`APPROVED`|—|Publish (no Schedule action — Decision 4); editing content/cover reverts to `DRAFT` (INV6-05, warn first)|
|`PUBLISHED`|—|Archive; editing content/cover reverts to `DRAFT` (INV6-05, warn first)|
|`ARCHIVED`|—|(terminal in current backend — no un-archive transition exists)|
|`SCHEDULED`|—|**No schedule-creation UI is provided in Phase 6** (Decision 4), so the CMS never moves an article into this state. If an article is already `SCHEDULED` (e.g., via direct API use), the CMS renders that state — clearly labelled as *scheduled, but will not auto-publish* (INV6-13) — and offers **Cancel Schedule as a recovery action only**, because that transition returns the article to a supported, unambiguous state (`APPROVED`); not offering it would strand such an article with no CMS-native way back.|

### 8.2 Flagged integrity gap — content edits during review (new finding, not previously in the audit)

While drafting this contract, direct inspection of `ArticlesService.update()` shows it **only** auto-reverts to `DRAFT` for `APPROVED`/`SCHEDULED` articles (INV6-05). It applies **no restriction at all** for `SUBMITTED\_FOR\_REVIEW`/`UNDER\_REVIEW` — an author (or any `article.update.any` holder) can `PATCH` an article's content while it is mid-review, which silently advances `currentRevisionId` out from under the reviewer. Because `WorkflowService.approve()` approves whatever `article.currentRevisionId` happens to be *at the moment of the approve call* (not the revision the reviewer was actually looking at), this is a real content-integrity gap: a reviewer could approve — and an editor subsequently publish — content the reviewer never actually reviewed. Cover mutation has a partial version of this protection already (INV6-07); plain content edits have none.

This finding is **retained**. It was not addressed by the lead's nine decisions, and **this specification does not change backend behavior in response to it.** It is recorded as **OD-2 — DEFERRED (§19): no backend change to review-time editing in Phase 6.**

* **What Phase 6 does:** only the frontend-level mitigation already shown in §8.1 ("View only" for the owning author during review). This reduces but does not eliminate the risk, because an `article.update.any` holder (an editor) can still `PATCH` another user's in-review article, and any direct API caller can as well. Phase 6 implements nothing else for this gap.
* **What Phase 6 does not do:** it does not block, reject, or auto-revert content edits during `SUBMITTED\_FOR\_REVIEW` / `UNDER\_REVIEW`.
* **Classification of any future fix:** any backend correction — rejecting content `PATCH` during review, or auto-reverting to `DRAFT` on such an edit — is a **separately authorized C-level modification** of the Phase 2 `ArticlesService.update()` contract (and, for auto-revert, a new use of `WorkflowService.revertToDraft()` that must preserve INV6-01, INV6-02, INV6-05 and INV6-12). It requires its own specification, compatibility analysis and tests, and **must not be introduced under D1–D4 or D10**. It is not one of the five C items counted in §1.

See §17 R-1 and §19 OD-2.

### 8.3 Revision history / audit

* `GET /v1/articles/:id/revisions` (list) and `/revisions/:revisionId` (single) render as a read-only history panel — reused as-is (A). No diff view is specified in this phase (no diffing library exists in the repo and none is evidenced as required); a simple chronological list with author/timestamp/revision number is in scope, a side-by-side diff is not.
* `GET /v1/articles/:id/audit` renders as a read-only audit panel showing actor, action, before/after state, and timestamp per entry — reused as-is (A).

\---

## 9\. Article/Revisions Model

* No schema change. `ArticleRevision.body` (`@db.Text`, plain string) is the sole content field the editor writes to, matching INV6-02 and the deliberate, already-documented Phase 2 decision to use Markdown text over structured JSON (audited and confirmed intentional, not reopened here per Decision 8).
* Every "Save" in the CMS is a `PATCH /v1/articles/:id` call carrying `expectedVersion` (always sent — see §6.7 note), producing exactly one new `ArticleRevision`. There is no partial-save/patch-a-field concept; the whole editable surface (title/body/excerpt/categoryId/tags) is sent together, matching the existing DTO shape.
* **Why no autosave (restated from §2.3 with the concrete mechanism):** because each save is a permanent, immutable, auditable revision row, a timer-based autosave (e.g., every 10s) would flood `ArticleRevision` with near-duplicate rows, degrade the revision-history view's usefulness, and inflate the exact "unbounded revision-table growth" risk the architecture doc's own §14 risk table already flags as a known, deliberately-deferred concern. This is concrete evidence against introducing autosave, not merely an absence of evidence for it.
* Concurrency: **always** send `expectedVersion` on every `PATCH`. A `409 CONCURRENCY\_CONFLICT` must be caught and surfaced as "this article was changed elsewhere — reload to see the latest version" rather than silently overwritten or silently retried.

\---

## 10\. Media Integration

Fully reused (A), no backend changes:

* Upload via `POST /v1/media` (multipart, single file), validated server-side by MIME + magic bytes (existing behavior, not re-implemented client-side beyond basic UX pre-checks).
* Cover assignment via `PATCH /v1/articles/:id/cover`, which **requires** `expectedVersion` strictly (unlike plain content `PATCH`) and can return `ARTICLE\_COVER\_IMMUTABLE` (INV6-06) or `COVER\_MUTATION\_NOT\_PERMITTED` (INV6-07) — both must be caught and explained in the UI, not shown as generic errors.
* Cover retrieval via `GET /v1/articles/:id/cover` (signed URL) for rendering the current cover in the editor.
* Media library via `GET /v1/media` (paginated, own media only) for picking an existing upload as a cover instead of re-uploading.
* 413 (`FILE\_TOO\_LARGE`) must be caught and shown with the actual size limit, not a generic failure.

\---

## 11\. Validation and Error Handling

### 11.1 Client-side pre-validation (mirrors existing, unchanged server DTOs — A)

|Field|Rule|Source|
|-|-|-|
|`title`|3–150 chars, non-empty|`CreateArticleDto`/`UpdateArticleDto`, unchanged|
|`body`|non-empty (no max)|unchanged|
|`excerpt`|≤500 chars, optional|unchanged|
|`tags`|≤10 items|enforced in `ArticlesService`, unchanged|
|`comment` (request-changes/reject)|non-empty, ≤1000 chars|**new, D4**|

Client-side validation is a UX convenience only; the server DTOs (existing + D4) remain the actual gate.

### 11.2 Known error codes the CMS must handle explicitly (not generic error toasts)

`VERSION\_REQUIRED`, `VERSION\_MISMATCH`, `CONCURRENCY\_CONFLICT`, `ARTICLE\_COVER\_IMMUTABLE`, `COVER\_MUTATION\_NOT\_PERMITTED`, `FILE\_TOO\_LARGE`, plus standard `401` (→ silent refresh, see §5.3), `403` (→ "you don't have permission," hide the action going forward for this session), `404` (→ "not found or you don't have access" — the backend deliberately returns 404 rather than 403 for ownership failures to avoid existence leaks; the CMS must not "correct" this into a more specific message that would defeat that IDOR protection).

### 11.3 Loading / empty states

* List views (articles, review queue, categories, media picker): explicit loading skeleton, explicit "no results for this filter" empty state distinct from "no articles exist yet."
* Editor: explicit save-in-flight state; Save button disabled while a request is in flight (prevents double-submit given there's no idempotency key on `PATCH`).

### 11.4 Unsaved-change behavior

* Standard browser-native "leave without saving?" prompt (`beforeunload`/router-level guard) when the editor form is dirty — no new library required, this is a native browser/Next.js router capability.
* Before any action that triggers INV6-05 (editing an `APPROVED`/`SCHEDULED` article), an explicit confirmation dialog stating the article will revert to Draft and (if `SCHEDULED`) its schedule will be cancelled — required, not optional, given this is a silent, surprising backend behavior the audit specifically flagged.

\---

## 12\. Security Model

No new security surface beyond what D1–D4 introduce, each already covered in §6:

* D1 exposes the caller's **own** permissions only — this is not a privilege-escalation risk (it does not grant anything; it reports what's already true). It does slightly increase what an authenticated user can learn about the permission-name vocabulary of the system, judged an acceptable, minor disclosure.
* D2 is a pure read-permission grant, strictly additive, does not touch any mutating capability.
* D3 does not change authorization logic, only adds filters evaluated **after** the existing ownership `where` clause.
* D4 only adds validation (rejecting previously-accepted-but-undocumented empty input); it does not relax anything.
* CORS/cookie configuration is unchanged (§6.1); the CMS runs same-app, cross-port locally exactly as Phase 5's frontend already does against the API, so no new cross-origin surface is introduced.
* `forbidNonWhitelisted: true` on the global `ValidationPipe` remains in effect; the CMS API client must send exactly the fields each DTO declares.

\---

## 13\. Testing Strategy

|Layer|Scope|
|-|-|
|Backend unit|New tests for D1 (permission resolution correctness per role, `PermissionResolverService` unit tests, `PermissionGuard` behavior-equivalence tests, DI-graph/no-circular-dependency bootstrap check), D2 (read/manage split per role), D3 (filter/pagination/determinism/ownership-scoping, and `limit`/`page` boundary validation returning 400 with no clamping), D4 (DTO validation) — see each item in §6 for specifics|
|Backend E2E|New cases per §6.2/6.3/6.4/6.5/6.6; full regression run of all existing suites (`auth`, `articles`, `workflow`, `categories-tags`, `media`, `public`, `app`) to confirm INV6-14|
|Frontend component|React Testing Library coverage for: `SessionProvider` (login/refresh/logout/permission exposure), **route gating and redirect rules per §5.1** (the `(protected)` layout redirects only when `unauthenticated` and never while `loading`; `/cms/login` renders the form when `unauthenticated`, redirects to `/cms` when `authenticated`; an unauthenticated visit to `/cms/login` does **not** redirect — the regression test for the V1.1 loop defect), the editor form (validation, dirty-state prompt, INV6-05 confirmation dialog), the workflow action panel (correct actions rendered per role × status per §8.1's matrix, four-eyes button suppression), the article list (filter/sort/pagination UI against D3), error-code-specific rendering (§11.2)|
|Frontend browser E2E (**Playwright**)|At least one full editorial journey run in a real browser against the real API: login as author → create draft → submit for review → login as editor → start review → approve → publish → confirm visible on the (unchanged) public site. This satisfies the architecture doc's own Phase 6 acceptance criterion verbatim and the tool the architecture doc §9 already names for this purpose. Playwright specs live in a dedicated `apps/web/e2e/` directory and must be excluded from the existing Jest run (`apps/web/jest.config.ts`) so the two runners do not collide. Fixtures provision an author and an editor account at the database level (the seed creates roles but no users, and no role-assignment API exists — §4.5 of the audit); no new backend endpoint is introduced for this.|
|Non-regression|Existing `apps/web/app/\_\_tests\_\_/\*` (og-route, page, robots \[updated per D10], sitemap-route) must continue to pass.|

\---

## 14\. Acceptance Criteria Matrix

|#|Criterion|Class|Verifies|
|-|-|-|-|
|AC-1|A non-technical editor can complete the entire draft-to-publish flow through the UI without direct API calls|B|Architecture §13 Phase 6 criterion, verbatim|
|AC-2|An author cannot see or trigger any action the backend would reject for their role/ownership (buttons hidden, not just disabled-with-error)|B|§7, §8.1|
|AC-3|`GET /api/users/me` returns correct `roles`/`permissions` for each seeded role, additively; an inactive user with a still-valid token receives HTTP 401 (not 200), an active user receives 200, and a missing user still receives the existing 404|C|§6.2|
|AC-4|An `author`-role token can `GET /v1/categories`/`:id` (200) but still cannot `POST`/`PATCH`/`DELETE` (403)|C|§6.3|
|AC-5|`GET /v1/articles` supports `page`/`limit`/`status`/`categoryId`/`sortBy`/`order`, returns a `PaginatedResponse<ArticleSummary>`, is deterministic across pages, and never returns another user's drafts to a non-`article.read.any` caller regardless of filters; the array → envelope change is recorded as a technically breaking API change (no known in-repository consumer)|C|§6.4|
|AC-6|`request-changes`/`reject` accept the request field `comment: string` and return `400` when `comment` is omitted, empty, or longer than 1000 characters, or when a `reason` field is sent instead; a missing `expectedVersion` still returns the existing `VERSION\_REQUIRED` 400; existing non-empty-comment call sites in `workflow.e2e-spec.ts` still pass unchanged|C|§6.5|
|AC-7|Editing an `APPROVED`/`SCHEDULED` article's content or cover shows an explicit confirmation before the request is sent, naming the Draft-revert/schedule-cancel consequence|B|§11.4, INV6-05|
|AC-8|No schedule-creation UI is provided anywhere in the CMS (no call to `POST /v1/articles/:id/schedule`, no date/time picker); "Cancel Schedule" appears only as a recovery action on an already-`SCHEDULED` article|B|§8.1, Decision 4|
|AC-9|No "Delete" action is rendered for `PUBLISHED`/`ARCHIVED` articles anywhere in the CMS|B|Decision 6|
|AC-10|No rich-text editor dependency appears in `apps/web/package.json`; the body field is a plain text/Markdown control|B|Decision 8|
|AC-11|No Redux/Zustand/React Query/SWR dependency appears in `apps/web/package.json` (Playwright, a devDependency, is the sole Phase 6 addition — AC-16)|B|Decision 9|
|AC-12|Existing Phase 5 public routes and their tests are unmodified except `robots.ts`/`robots.test.ts` (D10)|C (D10) / A (rest)|INV6-15|
|AC-13|A four-eyes violation attempt (own article) never even renders the Approve control for that user|B|INV6-03|
|AC-14|Full non-regression: all pre-existing unit/E2E suites (backend and frontend) pass unchanged|—|INV6-14|
|AC-15|`GET /v1/articles` returns HTTP 400 for `limit` < 1, `limit` > 100, `page` < 1, and non-numeric `page`/`limit`; `limit=1` and `limit=100` succeed; no out-of-range value is ever silently clamped (e.g., `limit=101` never yields a 100-item page)|C|§6.4|
|AC-16|A Playwright browser E2E test executes the complete editorial journey (login → draft → submit → review → approve → publish → visible on the public site) and passes; Playwright is present only as a devDependency, and `apps/web/package.json` gains no other new dependency|B|§13, D11/D12|
|AC-17|Visiting `/cms/login` while unauthenticated shows the login form and never redirects; visiting any `/cms/\*\*` protected URL while unauthenticated redirects to `/cms/login` exactly once; an authenticated visit to `/cms/login` redirects to `/cms`; no `apps/web/app/cms/page.tsx` exists; the `(protected)` segment appears in no URL; no Phase 5 public route or file is moved or modified (other than `robots.ts`, D10)|B|§5.1, INV6-15|
|AC-18|`PermissionGuard` behavior is unchanged after the D1 refactor (same 401/403/pass outcomes, same `request.userPermissions`); the Nest module graph compiles with `RbacModule` (no circular dependency); `UsersModule` → `RbacModule` is the only new cross-module dependency, and `RbacModule` imports no feature module|C|§4, §6.2|

\---

## 15\. File/Module Inventory

### New files (Phase 6)

|File|Purpose|
|-|-|
|`apps/api/src/modules/articles/dto/article-list-query.dto.ts`|D3 query DTO|
|`apps/api/src/modules/workflow/dto/request-changes.dto.ts`|D4|
|`apps/api/src/modules/workflow/dto/reject.dto.ts`|D4|
|`apps/api/src/modules/rbac/rbac.module.ts`|D1 — new `@Global()` leaf `RbacModule`|
|`apps/api/src/modules/rbac/permission-resolver.service.ts`|D1 — shared `PermissionResolverService`|
|`apps/api/src/modules/rbac/permission-resolver.service.spec.ts`|D1 — resolver unit tests|
|`packages/types/src/article.ts` (re-exported from `packages/types/src/index.ts`)|D5 domain types|
|`apps/web/app/cms/layout.tsx`|D7 — non-gating layout; mounts `SessionProvider` only|
|`apps/web/app/cms/session-provider.tsx`|D7 — `SessionProvider` (§5.2)|
|`apps/web/app/cms/login/page.tsx`|D7 — `/cms/login`, outside `(protected)`|
|`apps/web/app/cms/(protected)/layout.tsx`|D7 — the only auth gate|
|`apps/web/app/cms/(protected)/page.tsx`|Dashboard (`/cms`)|
|`apps/web/app/cms/(protected)/articles/page.tsx`|D3-backed list|
|`apps/web/app/cms/(protected)/articles/new/page.tsx`|Create|
|`apps/web/app/cms/(protected)/articles/\[id]/page.tsx`|Edit/workflow/revisions/audit shell|
|`apps/web/app/cms/(protected)/review/page.tsx`|Review queue|
|`apps/web/app/cms/(protected)/categories/page.tsx`|Category management|
|`apps/web/lib/cms-api.ts`|D8 authenticated client|
|CMS component test files co-located under each route|D11|
|`apps/web/e2e/editorial-journey.spec.ts`|D11 — Playwright editorial-journey test|
|`apps/web/playwright.config.ts`|D12 — Playwright configuration|
|`apps/web/e2e/fixtures/\*`|D12 — provisions one `author` and one `editor` account directly in the database before the journey runs (binding constraints: database-level only, uses the existing seeded roles, no new backend endpoint)|

### Modified files

|File|Change|
|-|-|
|`apps/api/src/modules/users/users.controller.ts`, `users.service.ts`, `users.module.ts`|D1 — `getMe` roles/permissions; `UsersModule` imports `RbacModule`|
|`apps/api/src/modules/rbac/guards/permission.guard.ts`|D1 — delegate to `PermissionResolverService`; behavior-preserving|
|`apps/api/src/app.module.ts`|D1 — import `RbacModule`|
|`apps/api/src/database/prisma/seed.ts`|D2 (new permission row)|
|`apps/api/src/modules/categories-tags/categories.controller.ts`|D2 (guard split)|
|`apps/api/src/modules/articles/articles.controller.ts`, `articles.service.ts`|D3|
|`apps/api/src/modules/workflow/workflow.controller.ts`, `workflow.service.ts`|D4 — typed `RequestChangesDto`/`RejectDto` (`comment: string`) on the two routes|
|`apps/web/app/robots.ts`|D10|
|`apps/web/app/\_\_tests\_\_/robots.test.ts`|D10|
|`apps/api/test/workflow.e2e-spec.ts`, `articles.e2e-spec.ts`, `categories-tags.e2e-spec.ts`, `auth.e2e-spec.ts` (or a new `users.e2e-spec.ts`)|New test cases per §13|
|`packages/types/src/index.ts`|D5|
|`apps/web/package.json`|D12 — add `@playwright/test` as a devDependency and one E2E run script; no other dependency change|
|`apps/web/jest.config.ts`|D12 — exclude `e2e/` from the Jest run so Playwright specs are not executed by Jest|
|`pnpm-lock.yaml`|D12 — lockfile update for the Playwright devDependency|
|`.github/workflows/ci.yml`|D12 — one added E2E job (Wave 6) that runs the single documented Playwright script against a stack with Postgres, Redis and MinIO available; existing lint/typecheck/test/build jobs unchanged|

**No file deletions. No migration files (D1–D4 require zero Prisma schema changes — confirmed per-item in §6).** V1.0 and V1.1 are left in place unmodified alongside this V1.2 document.

\---

## 16\. Dependency Map

* **Backend module graph (D1):** `UsersModule` → `RbacModule` is the only new cross-module dependency; `PermissionGuard` (in every host module) → `PermissionResolverService`; `RbacModule` is a leaf with no imports of feature modules, so no cycle exists. D1's resolver extraction must land before any change that relies on `getMe` roles/permissions.
* **Frontend route dependencies:** `cms/login/page.tsx` and `cms/(protected)/\*\*` both depend on `SessionProvider` from the non-gating `cms/layout.tsx`; `(protected)/layout.tsx` is the only component that redirects unauthenticated users, and `login/page.tsx` is the only component that redirects authenticated users away from login. `cms-api.ts` depends on `SessionProvider` state but never navigates.
* D6–D9 (frontend routes/session/API client) depend on D1 (need `roles`/`permissions` to gate anything) and D2 (need a category source for the editor form).
* D9 article editor depends on D3 only for the *list* view, not the editor itself (create/edit uses the existing single-article endpoints, unmodified).
* D4 is independent of D1–D3; can be built and tested in isolation.
* D10 depends on D6 existing (can't disallow a route that doesn't exist yet), but is otherwise independent.
* **D11/D12 (Playwright E2E)** depend on everything else: D1–D4 (backend contracts), D6–D9 (the CMS UI under test), and D10 only insofar as the E2E's public-site check must not regress. D12's fixtures depend on the existing `seed.ts` roles; they need database-level user provisioning because no user-creation/role-assignment API exists beyond `POST /auth/register` (which always assigns `author`).
* **The only new external package dependency introduced by Phase 6 is `@playwright/test`, as a devDependency of `apps/web`.** It is explicitly justified by the architecture doc §9 (which names Playwright for the login → publish journey) and by the Phase 6 acceptance criterion, which cannot be verified without a real browser. No runtime dependency is added, and Decisions 8 and 9 continue to forbid rich-editor and state/data-fetching libraries.

\---

## 17\. Risks and Mitigations

|ID|Risk|Mitigation|
|-|-|-|
|R-1|Content-integrity gap during review (§8.2) — an in-review article's content can change under the reviewer without any backend safeguard beyond cover mutation's partial protection|Frontend-only partial mitigation in this phase (owning author sees read-only during review). No backend change is made: OD-2 is **DEFERRED** (§19). Any future fix is a separately authorized **C-level** backend change to the Phase 2 `ArticlesService.update()` contract and is not part of D1–D4 or D10|
|R-2|D3's array → paginated-envelope change is technically a breaking API change. No in-repository consumer exists, so no known current DailyStar consumer is expected to break, but undocumented external consumers relying on the array shape would|Retained as an explicit **C** item with full compatibility analysis (§6.4); new tests (including strict `limit`/`page` 400 behavior) close the pre-existing coverage gap; the lead should confirm no external consumer exists before approving|
|R-3|Soft-`DELETE`-on-`PUBLISHED` semantic gap (audit §8.9) is unresolved by Decision 6, which only restricts the *CMS UI* from offering Delete on non-draft content — the backend endpoint itself still permits it for the article's owner (`article.delete.own`, held by `author`) or any `article.delete.any` holder (`admin` only), in any status, with no audit-log entry (unlike `archive`)|Not fixed in Phase 6 per the lead's explicit instruction not to silently change `DELETE` semantics; OD-7 is **DEFERRED** (§19): no Phase 6 fix; any future change to `DELETE` semantics is a separately authorized C-level backend change|
|R-4|`SCHEDULED`-state articles created before Phase 6 (or via direct API use during Phase 6) could confuse editors if the CMS doesn't clearly label "scheduled, but will not auto-publish"|§8.1 table requires the CMS to render this state explicitly with that caveat, not hide it|
|R-5|Revision-table growth (architecture §14, pre-existing, known risk)|Reinforced, not worsened, by this spec — no autosave (§9) actively avoids making this worse|
|R-6|Playwright (selected for Phase 6 browser E2E, OD-3 resolved) is a new dependency with real cost: browser binaries, a full running stack (API, Postgres, Redis, MinIO) for the E2E, database-level fixture provisioning of an editor account (no role-assignment API exists), and possible flakiness/CI-time growth. The existing CI (`ci.yml`) has no E2E job and Jest could accidentally pick up Playwright specs|Playwright added as a devDependency only, in `apps/web`; specs isolated under `apps/web/e2e/` and excluded from Jest (§13, §15); exactly one required editorial-journey spec (not a large suite); CI wiring scoped to Wave 6 as a single added job (§15); fixtures use DB-level provisioning, no new backend endpoint|
|R-7|D1 refactors `PermissionGuard`, which sits in front of nearly every protected backend route; a subtle behavior change would be a security regression. Adding the missing `RbacModule` also risks an accidental circular import if a future change makes it import a feature module|Behavior-preserving by requirement, proven by guard-equivalence unit tests and a full regression run of every existing backend E2E suite (§6.2, AC-18); `RbacModule` is a leaf that imports no feature module (§4); the app-bootstrap E2E fails on a cycle|
|R-8|**Existing gap, not introduced or fixed by Phase 6 (informational).** Workflow transition routes pass `body.expectedVersion` straight into `WorkflowService.getArticle()`, which skips the version check when the value is exactly `null`; a client that sends JSON `"expectedVersion": null` therefore bypasses the otherwise-mandatory concurrency check (INV6-04). The Phase 6 CMS always sends the article's numeric `version` and never `null`|No Phase 6 backend change. D4's DTOs deliberately leave `expectedVersion` handling as-is (§6.5). Any future correction is a separately authorized C-level change to the Phase 3 `WorkflowController`/`WorkflowService` contract|

\---

## 18\. Deferred Scope

Restated from §2.3 for traceability: schedule-creation UI and automated scheduled publishing (→ future Scheduling phase), rich-text editing, Markdown preview pane (§19 OD-6, LOCKED), tag listing/autocomplete (§19 OD-4, LOCKED), registration and any user/role management UI (§19 OD-5, LOCKED), `packages/ui` component extraction, diff-style revision comparison, the review-time content-integrity fix (§8.2/R-1 — OD-2, DEFERRED; any future fix is a separately authorized C-level change), the `DELETE`-semantics gap in R-3 (OD-7, DEFERRED; any future fix is a separately authorized C-level change), the `expectedVersion: null` bypass (R-8; any future fix is a separately authorized C-level change).

\---

## 19\. Open Decisions

**V1.2 status: no unresolved decisions remain.** Every item below is either LOCKED (decided for Phase 6, implementation must follow it as written), DEFERRED (explicitly not addressed in Phase 6; implementation does nothing about it), or RESOLVED. Approval of this specification approves each entry as recorded. No entry leaves an architectural choice for implementation to invent.

|ID|Decision|Status|Phase 6 outcome (binding)|Sections|
|-|-|-|-|-|
|OD-1|CMS URL structure|**LOCKED**|A real `/cms/\*` path segment. Inside it, only the nested `(protected)` route group is used (gating layout scope; not in URLs). A top-level `(cms)` route group is not used.|§5.1, §6.6 (D10)|
|OD-2|Must content editing be blocked while an article is `SUBMITTED\_FOR\_REVIEW` / `UNDER\_REVIEW`?|**DEFERRED**|No backend change to review-time editing in Phase 6. Frontend mitigation only (§8.1, §8.2). Any future correction is a separately authorized **C-level** backend change to the Phase 2 `ArticlesService.update()` contract, not part of D1–D4 or D10.|§8.1, §8.2, §17 R-1|
|OD-3|Browser E2E tooling|**RESOLVED** (V1.1)|Playwright (`@playwright/test`), devDependency of `apps/web`, the sole new Phase 6 dependency.|D11/D12, §13, §15, §16, AC-16, R-6, Wave 6|
|OD-4|Tag handling in the CMS|**LOCKED** for Phase 6|Free-text tags only (chip/comma input relying on the existing inline `findOrCreate`). No `GET /v1/tags` endpoint and no tag autocomplete or tag-management UI.|§2.3, §5.4|
|OD-5|Registration and user provisioning|**LOCKED**|The CMS is login-only. No registration screen. User provisioning remains outside the CMS (out-of-band, e.g. seed/database); `POST /auth/register` is untouched and not wired into the UI. No user/role management UI.|§2.3, §6.1, §18|
|OD-6|Markdown preview pane|**LOCKED FOR PHASE 6**|Deferred: no preview pane and no Markdown-rendering dependency in Phase 6.|§5.4, §18|
|OD-7|Soft-`DELETE` vs. `archive` backend semantics on published content|**DEFERRED**|`DELETE /v1/articles/:id` semantics are unchanged; no Phase 6 fix. The CMS never offers Delete on `PUBLISHED`/`ARCHIVED` articles (Decision 6). Any future change is a separately authorized **C-level** backend change.|§17 R-3|

\---

## 20\. Repository vs Phase 6 Alignment

### Existing capabilities that Phase 6 can reuse

Auth (login/refresh/logout), full article CRUD + revisions, all nine workflow transitions, audit log endpoint, full media pipeline, category mutation endpoints (for the new management screen), the `PublicFeedQueryDto`/pagination convention (mirrored for D3), the `ApiErrorResponse`/`PaginatedResponse<T>` envelope types (first real use).

### Missing capabilities (identified in the audit; status after this spec)

Own-permission visibility — **closed by D1.** Author category read access — **closed by D2.** Article list filtering — **closed by D3.** Comment enforcement gap — **closed by D4.** Tag listing — **still missing, LOCKED out of Phase 6 (OD-4).** User/role management and registration — **still missing, LOCKED out of Phase 6 (OD-5, §18).** `packages/ui`/`packages/types` domain coverage — **partially closed (D5 types only; no component library).**

### Discrepancies (from the audit, unresolved by this spec)

Stale `README.md`/`docs/architecture/README.md` phase-status banners (§8.1 of the audit) — cosmetic, not touched by this spec. Missing Phase 1 checkpoint doc — not touched. `PublicationSchedule` phase-number conflict between `schema.prisma`'s comment and the architecture doc — not touched, irrelevant until the Scheduling phase. Dead colon-style permissions in seed data — not touched (harmless, unused).

### Potential breaking changes

D3's array → paginated-envelope change is **technically a breaking API change**: no known in-repository consumer exists, so no known current DailyStar consumer is expected to break, but undocumented external consumers would (§6.4). D4's stricter validation is likewise technically breaking for any undocumented external caller that omitted `comment`; no existing test breaks (§6.5). D2 is additive in its externally observable API. D1's response shape is additive, but D1 also tightens `GET /users/me` for inactive users (200 → 401): technically a behavior change for any undocumented external caller, with no known in-repository test or consumer affected (§6.2); D1 additionally refactors `PermissionGuard` internally (behavior-preserving, R-7). D10 is purely additive.

### Security-sensitive areas

D1 (exposes permission names to the authenticated caller — judged acceptable, §12 — **and** refactors `PermissionGuard`, the enforcement point for nearly every protected route, hence the guard-equivalence tests and full backend regression run, R-7/AC-18), D2 (loosens a read gate — judged acceptable and bounded, §12), the four-eyes UI suppression (§7, §8.1 — must not be the *only* enforcement, backend guard remains authoritative and unchanged), error-message handling around 404-not-403 for ownership failures (§11.2 — must not be "improved" into a leakier message).

### Architectural decisions requiring approval

**None remain open.** OD-1, OD-4, OD-5, OD-6 are LOCKED; OD-2 and OD-7 are DEFERRED (no Phase 6 fix; any future fix is a separately authorized C-level change); OD-3 is RESOLVED (§19). Approving this specification approves: the five C-classified items (D1–D4 and the separate cross-phase D10), the single permitted new cross-module dependency (`UsersModule` → `RbacModule`, §4), and the single new devDependency (Playwright). Every other item traces directly to one of the nine decisions already issued.

\---

## 21\. Proposed High-Level Implementation Waves

High-level only, per instruction — no detailed tasks. Derived from §16's dependency map.

* **Wave 1 — Backend foundation (D1, D2, D4).** Independent of each other and of any frontend work; highest leverage (unblocks everything else). D1 comes first within the wave: `RbacModule` + `PermissionResolverService` extraction, the behavior-preserving `PermissionGuard` refactor, and `getMe` roles/permissions — each proven by the guard-equivalence tests and a full backend regression run before anything depends on it (§6.2). Includes the required tests for D2 and D4 (§6.3/6.5).
* **Wave 2 — Backend list capability (D3).** Slightly higher complexity (new DTO, envelope change, determinism requirement); can proceed in parallel with Wave 1 but is a prerequisite for the Wave 4 list/review UI.
* **Wave 3 — CMS shell (D6, D7, D8).** The `cms/` route tree exactly as in §5.1: non-gating `cms/layout.tsx` + `SessionProvider`, ungated `cms/login/page.tsx`, gating `cms/(protected)/layout.tsx`, and the authenticated API client. Includes the redirect-rule tests (AC-17). Depends on Wave 1 (needs D1's permissions to do anything meaningful post-login).
* **Wave 4 — Article authoring \& listing (D9 partial: editor, create/edit, list view).** Depends on Waves 1–3 and D2 (category picker) and D3 (list view).
* **Wave 5 — Editorial workflow UI (D9 partial: workflow panel, review queue, revision/audit panels, cover/media picker, category management screen).** Depends on Wave 4 existing; this is where INV6-03/05/06/07 all become user-visible and testable together.
* **Wave 6 — D10 + testing/hardening (D11, D12).** `robots.txt` update, full component-test sweep, Playwright setup (devDependency, config, Jest exclusion, fixtures, CI wiring) and the single required full editorial-journey Playwright E2E, full non-regression pass across both apps.

\---

*End of specification (V1.2). Status remains DRAFT — Awaiting Human Engineering Lead Approval. Per the governing instructions, `requirements.md`, `design.md`, and `tasks.md` are not produced at this stage, and no implementation code has been written.*

