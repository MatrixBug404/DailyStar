# Phase 6 Requirements

This document defines the functional, security, compatibility, and acceptance requirements for Phase 6, derived directly from `phase6-technical-spec-v1.2.md`.

## Deliverables (D1–D12)

### Backend C-Level Changes (Authorized Modifications)
These are controlled modifications to earlier-phase contracts.

*   **REQ-D1 (Class C):** `GET /api/users/me` MUST return `roles: string[]` and `permissions: string[]` additively. Active users return HTTP 200. Inactive users with a valid token MUST return HTTP 401. Missing users continue to return HTTP 404. This MUST be implemented via a single shared `PermissionResolverService`.
*   **REQ-D2 (Class C):** A new `category.read` permission MUST be seeded for `author`, `editor`, and `admin` roles. `CategoriesController` GET routes MUST be gated by `category.read`. POST/PATCH/DELETE MUST remain gated by `category.manage`.
*   **REQ-D3 (Class C):** `GET /api/v1/articles` MUST accept `ArticleListQueryDto` (`page`, `limit`, `status`, `categoryId`, `sortBy`, `order`). `limit` MUST be between 1 and 100 inclusive. Out-of-range values or non-numeric values for `limit` and `page` MUST return HTTP 400 and MUST NEVER be clamped silently. The response MUST be a `PaginatedResponse<ArticleSummary>`. Sorting MUST be deterministic (tie-breaker `id ASC`).
*   **REQ-D4 (Class C):** `WorkflowController.requestChanges()` and `.reject()` MUST require a `comment` field (string, non-empty, ≤1000 chars) via typed DTOs. A missing or empty `comment` MUST return HTTP 400. `reason` MUST NOT be accepted. `expectedVersion` missing MUST continue to return the existing `VERSION_REQUIRED` HTTP 400.
*   **REQ-D10 (Class C, Cross-phase):** `apps/web/app/robots.ts` MUST output `Disallow: /cms/` alongside the existing `Disallow: /api/`.

### Frontend Additions (Class B)
*   **REQ-D5:** New shared domain types MUST be added to `@dailystar/types`: `ArticleStatus`, `Article`, `ArticleSummary`, `ArticleRevisionSummary`, `SafeUser`, `WorkflowTransitionBody`, `MediaSummary`, `CategorySummary`.
*   **REQ-D6:** The CMS MUST be mounted at a real `apps/web/app/cms/*` route segment. It MUST NOT use a `(cms)` route group. `cms/login` MUST be ungated. All other CMS pages MUST live under a `(protected)` route group.
*   **REQ-D7:** A React Context `SessionProvider` MUST be mounted in a non-gating `cms/layout.tsx`. Authentication gating MUST occur solely in `cms/(protected)/layout.tsx` (redirects to `/cms/login` when unauthenticated). `/cms/login` MUST redirect to `/cms` when authenticated.
*   **REQ-D8:** An authenticated API client (`apps/web/lib/cms-api.ts`) MUST wrap `fetch`, attach `Authorization: Bearer`, handle exactly one 401 refresh-then-retry, and parse specific error codes (e.g., `VERSION_REQUIRED`).
*   **REQ-D9:** The CMS MUST provide: article list/filter, draft editor (plain Markdown/text, no WYSIWYG), review queue, workflow action panel, revision history, audit log, cover/media picker, and category management screen.
*   **REQ-D11:** CMS component tests and one full editorial-journey browser E2E test MUST be written (login -> draft -> submit -> review -> approve -> publish).
*   **REQ-D12:** Playwright MUST be added as a devDependency in `apps/web` for the E2E test. No other new runtime dependencies (e.g., Redux, rich-text editors) are permitted.

## Preserved Invariants (INV6-01 to INV6-15)

*   **INV6-01:** `WorkflowModule` is the sole mutator of `Article.status`.
*   **INV6-02:** `ArticleRevision` rows are append-only. No in-place editing of body.
*   **INV6-03:** Four-eyes principle: a user cannot approve their own article. The UI MUST NOT render the Approve action for the author.
*   **INV6-04:** `expectedVersion` is mandatory on workflow transitions.
*   **INV6-05:** Editing content/cover on an `APPROVED`/`SCHEDULED` article silently reverts to `DRAFT`. The UI MUST explicitly warn the user before saving.
*   **INV6-06:** Cover mutation is rejected on `PUBLISHED`/`ARCHIVED` (`ARTICLE_COVER_IMMUTABLE`).
*   **INV6-07:** Cover mutation is rejected for the author while under review (`COVER_MUTATION_NOT_PERMITTED`).
*   **INV6-08:** Slug is immutable once published.
*   **INV6-09:** Public visibility gate relies on `status = 'PUBLISHED' AND deletedAt IS NULL`.
*   **INV6-10:** Public site reads `currentPublishedRevisionId` exclusively.
*   **INV6-11:** `PublicController` carries no auth guards.
*   **INV6-12:** Exactly one `AuditLog` row per workflow transition.
*   **INV6-13:** `SCHEDULED` state has no automated worker. No schedule-creation UI is provided in Phase 6.
*   **INV6-14:** All existing Phase 1-5 tests MUST pass unchanged (with specified itemized additions).
*   **INV6-15:** Existing public routes are untouched.

## Acceptance Criteria (AC-1 to AC-18)

*   **AC-1:** A non-technical editor can complete the entire draft-to-publish flow through the UI without direct API calls.
*   **AC-2:** An author cannot see or trigger any action the backend would reject for their role/ownership (buttons hidden, not just disabled-with-error).
*   **AC-3:** `GET /api/users/me` returns correct `roles`/`permissions` for each seeded role, additively; an inactive user with a valid token receives HTTP 401, an active user receives 200, and a missing user receives 404.
*   **AC-4:** An `author`-role token can `GET /v1/categories`/`:id` (200) but still cannot `POST`/`PATCH`/`DELETE` (403).
*   **AC-5:** `GET /v1/articles` supports `page`/`limit`/`status`/`categoryId`/`sortBy`/`order`, returns a `PaginatedResponse<ArticleSummary>`, is deterministic across pages (`id ASC` tie-breaker), and preserves ownership scoping.
*   **AC-6:** `request-changes`/`reject` accept `comment: string` and return 400 when `comment` is omitted, empty, >1000 chars, or when `reason` is sent; missing `expectedVersion` returns `VERSION_REQUIRED` 400.
*   **AC-7:** Editing an `APPROVED`/`SCHEDULED` article's content or cover shows an explicit confirmation before saving, naming the Draft-revert/schedule-cancel consequence (INV6-05).
*   **AC-8:** No schedule-creation UI is provided anywhere in the CMS; "Cancel Schedule" appears only as a recovery action on an already-`SCHEDULED` article.
*   **AC-9:** No "Delete" action is rendered for `PUBLISHED`/`ARCHIVED` articles anywhere in the CMS (OD-7 / Decision 6).
*   **AC-10:** No rich-text editor dependency appears in `apps/web/package.json`; body field is a plain text/Markdown control.
*   **AC-11:** No Redux/Zustand/React Query/SWR dependency appears in `apps/web/package.json`.
*   **AC-12:** Existing Phase 5 public routes and their tests are unmodified except `robots.ts`/`robots.test.ts` (D10).
*   **AC-13:** A four-eyes violation attempt (own article) never renders the Approve control for that user (INV6-03).
*   **AC-14:** Full non-regression: all pre-existing unit/E2E suites pass unchanged (INV6-14).
*   **AC-15:** `GET /v1/articles` returns HTTP 400 for `limit < 1`, `limit > 100`, `page < 1`, and non-numeric values; out-of-range values are never silently clamped.
*   **AC-16:** A Playwright browser E2E test executes the complete editorial journey (login → draft → submit → review → approve → publish → visible on public site) and passes; Playwright is present only as a devDependency.
*   **AC-17:** Visiting `/cms/login` while unauthenticated shows the login form and never redirects; visiting any `/cms/**` protected URL while unauthenticated redirects to `/cms/login` exactly once; authenticated visit to `/cms/login` redirects to `/cms`; no `apps/web/app/cms/page.tsx` exists (prevents collision with `(protected)/page.tsx`); `(protected)` segment appears in no URL.
*   **AC-18:** `PermissionGuard` behavior is unchanged after the D1 refactor; Nest module graph compiles with `RbacModule` (no circular dependency); `UsersModule` → `RbacModule` is the only new cross-module dependency.

## Security, Compatibility, and Error Contracts

*   **Error Codes:** The CMS MUST explicitly handle `VERSION_REQUIRED`, `VERSION_MISMATCH`, `CONCURRENCY_CONFLICT`, `ARTICLE_COVER_IMMUTABLE`, `COVER_MUTATION_NOT_PERMITTED`, and `FILE_TOO_LARGE`.
*   **404 over 403:** The CMS MUST NOT change 404s (used for IDOR protection on missing ownership) into 403s.
*   **Compatibility:** D1-D4 and D10 represent explicit, approved API surface changes. All other API endpoints MUST remain unchanged (Class A).

## Decisions (Locked & Deferred)

*   **LOCKED:** CMS URL structure is `/cms/*` (OD-1).
*   **LOCKED:** Tag handling is free-text chip input only; no tag autocomplete UI or GET endpoint (OD-4).
*   **LOCKED:** Registration and user management are excluded from the CMS (OD-5).
*   **LOCKED:** No markdown preview pane in Phase 6 (OD-6).
*   **DEFERRED:** No backend change to review-time editing (OD-2). Any future fix is a separate C-level change.
*   **DEFERRED:** No Phase 6 change to `DELETE` semantics on published content (OD-7). Any future fix is a separate C-level change.

## Traceability
*   Source: `phase6-technical-spec-v1.2.md`
*   Deliverables D1-D12 correspond to Spec §2.1.
*   Invariants INV6-01-INV6-15 correspond to Spec §3.
*   Open Decisions correspond to Spec §19.
*   Error Contracts correspond to Spec §11.2.
