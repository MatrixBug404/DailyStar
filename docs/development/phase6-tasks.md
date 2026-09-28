# Phase 6 Implementation Tasks

This document defines the implementation tasks for Phase 6, structured strictly into the six approved waves from `phase6-technical-spec-v1.2.md` (§21).

## Wave 1: Backend Foundation (D1, D2, D4)
*Prerequisite for all other waves.*

### Task 1.1: RBAC Refactor & `GET /users/me` (D1)
*   **Files**: `apps/api/src/modules/rbac/rbac.module.ts`, `apps/api/src/modules/rbac/permission-resolver.service.ts`, `apps/api/src/modules/rbac/guards/permission.guard.ts`, `apps/api/src/app.module.ts`, `apps/api/src/modules/users/users.module.ts`, `apps/api/src/modules/users/users.controller.ts`, `apps/api/src/modules/users/users.service.ts`, `apps/api/src/modules/rbac/permission-resolver.service.spec.ts`
*   **Action**: Create `@Global()` leaf `RbacModule` and `PermissionResolverService`. Refactor `PermissionGuard` to use the resolver (behavior-preserving). Update `UsersService` to use the resolver for `getMe`.
*   **Tests / Criteria (AC-3, AC-18)**: Guard-equivalence unit tests, resolver unit tests, DI-graph compile check (`app.e2e-spec.ts`).
*   **Regression Gate (AC-14)**: Full run of all existing backend E2E suites MUST pass. E2E assertion for inactive user returning 401.

### Task 1.2: Category Read/Manage Split (D2)
*   **Files**: `apps/api/src/database/prisma/seed.ts`, `apps/api/src/modules/categories-tags/categories.controller.ts`
*   **Action**: Upsert `category.read` permission to `author`, `editor`, and `admin`. Change `CategoriesController` GET routes to use `@RequirePermission('category.read')`.
*   **Tests / Criteria (AC-4)**: E2E test verifying `author` can `GET /v1/categories` but receives 403 on POST/PATCH/DELETE. Run `categories-tags.e2e-spec.ts`.

### Task 1.3: Mandatory Comments (D4)
*   **Files**: `apps/api/src/modules/workflow/dto/request-changes.dto.ts`, `apps/api/src/modules/workflow/dto/reject.dto.ts`, `apps/api/src/modules/workflow/workflow.controller.ts`
*   **Action**: Create typed DTOs enforcing `comment: string`. Update `WorkflowController` to use these DTOs instead of `@Body() body: any`.
*   **Tests / Criteria (AC-6)**: E2E tests asserting HTTP 400 for omitted/empty comment, or provided `reason`. Confirm existing `workflow.e2e-spec.ts` non-empty cases still pass.

### Task 1.4: Shared Domain Types (D5)
*   **Files**: `packages/types/src/article.ts`, `packages/types/src/index.ts`
*   **Action**: Create `article.ts` with `ArticleStatus`, `Article`, `ArticleSummary`, `ArticleRevisionSummary`, `SafeUser`, `WorkflowTransitionBody`, `MediaSummary`, `CategorySummary`. Re-export from `index.ts`.
*   **Tests / Criteria**: Run `pnpm --filter @dailystar/types build` and `pnpm run typecheck`. All exports resolve cleanly.

## Wave 2: Backend List Capability (D3)
*Can run parallel to Wave 1; prerequisite for Wave 4.*

### Task 2.1: Article List Filtering & Pagination
*   **Files**: `apps/api/src/modules/articles/dto/article-list-query.dto.ts`, `apps/api/src/modules/articles/articles.controller.ts`, `apps/api/src/modules/articles/articles.service.ts`
*   **Action**: Create `ArticleListQueryDto` enforcing boundaries (`page >= 1`, `1 <= limit <= 100`). Update `findAll` to return `PaginatedResponse<ArticleSummary>` and append `id ASC` secondary sort.
*   **Tests / Criteria (AC-5, AC-15)**: Unit tests for boundaries and deterministic sorting. E2E tests for HTTP 400 on `limit=0`, `limit=101`, `page=0`, non-numeric values (no silent clamping). Verify ownership scoping is preserved.

## Wave 3: CMS Shell (D6, D7, D8)
*Requires Wave 1 (D1).*

### Task 3.1: Route Structure & Session Provider
*   **Files**: `apps/web/app/cms/layout.tsx`, `apps/web/app/cms/session-provider.tsx`, `apps/web/app/cms/login/page.tsx`, `apps/web/app/cms/(protected)/layout.tsx`, `apps/web/app/cms/(protected)/page.tsx`, `apps/web/lib/cms-api.ts`
*   **Action**: Implement the non-gating layout, `SessionProvider`, ungated login page, `(protected)` gating layout, and `(protected)/page.tsx` dashboard landing page (`/cms`). Implement `cms-api.ts` with token injection and 401 retry logic. Ensure NO `apps/web/app/cms/page.tsx` exists.
*   **Tests / Criteria (AC-17)**: React Testing Library for gating rules: `(protected)` redirects to `/login` when unauthenticated; `/login` redirects to `/cms` when authenticated; NO redirect while `loading`.

## Wave 4: Article Authoring & Listing (D9 partial)
*Requires Waves 1, 2, and 3.*

### Task 4.1: Editor and Article List
*   **Files**: `apps/web/app/cms/(protected)/articles/page.tsx`, `apps/web/app/cms/(protected)/articles/new/page.tsx`, `apps/web/app/cms/(protected)/articles/[id]/page.tsx`
*   **Action**: Implement the D3-backed list view with filters. Implement the plain text/Markdown editor bound to `ArticleRevision.body`.
*   **Tests / Criteria (AC-1, AC-10)**: RTL tests for editor form, D3 filter propagation, and dirty-state browser prompt.

## Wave 5: Editorial Workflow UI (D9 partial)
*Requires Wave 4.*

### Task 5.1: Workflow, Revisions, Categories, Media
*   **Files**: `apps/web/app/cms/(protected)/articles/[id]/page.tsx` (workflow/revision/audit tabs), `apps/web/app/cms/(protected)/review/page.tsx`, `apps/web/app/cms/(protected)/categories/page.tsx`
*   **Action**: Implement workflow action buttons (gated by permissions/ownership). Suppress "Approve" for author. Add INV6-05 confirmation dialog for editing `APPROVED`/`SCHEDULED` articles. Implement revision history and category management.
*   **Tests / Criteria (AC-2, AC-7, AC-8, AC-9, AC-13)**: RTL tests confirming four-eyes suppression and INV6-05 dialog triggering.

## Wave 6: Hardening & E2E (D10, D11, D12)
*Requires Waves 1-5.*

### Task 6.1: `robots.txt` Update (D10)
*   **Files**: `apps/web/app/robots.ts`, `apps/web/app/__tests__/robots.test.ts`
*   **Action**: Add `Disallow: /cms/`. Ensure `/api/` remains disallowed. Update tests.
*   **Tests / Criteria (AC-12)**: Run `pnpm test robots.test.ts`.

### Task 6.2: Playwright Integration & Editorial Journey (D11, D12)
*   **Files**: `apps/web/package.json`, `apps/web/jest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/e2e/editorial-journey.spec.ts`, `apps/web/e2e/fixtures/*`, `.github/workflows/ci.yml`
*   **Action**: Install `@playwright/test` as devDependency. Exclude `e2e/` from Jest. Write DB-level fixture provisioning (author/editor roles). Write the full E2E journey. Add Wave 6 to CI.
*   **Tests / Criteria (AC-1, AC-11, AC-16)**: The Playwright spec MUST pass a full draft-to-publish flow in a real browser.

### Task 6.3: Final Non-Regression Gate
*   **Action**: Execute `pnpm test`, `pnpm run test:ci`, and all E2E suites.
*   **Criteria (AC-14)**: Full non-regression of Phase 1-5 capabilities (INV6-14, INV6-15).

## Traceability
*   Source: `phase6-technical-spec-v1.2.md`
*   Waves directly correspond to Spec §21.
