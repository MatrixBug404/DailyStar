# Phase 6 Design

This document maps the Phase 6 requirements to concrete repository modules, architectures, and files, based strictly on `phase6-technical-spec-v1.2.md`.

## Backend Architecture & Modules

### D1: RBAC Refactor & User Permissions (`apps/api/src/modules/rbac` & `users`)
*   **`RbacModule`**: A new `@Global()` leaf module in `apps/api/src/modules/rbac/rbac.module.ts`. It MUST NOT import any feature module.
*   **`PermissionResolverService`**: A new service inside `RbacModule` that queries `prisma.user` to resolve role and permission names. It returns `null` for inactive or missing users.
*   **`PermissionGuard`**: Refactored to delegate to `PermissionResolverService`. Its external behavior (401/403/200) MUST remain identical to its current state.
*   **`UsersModule`**: Imports `RbacModule`. `UsersService` calls `PermissionResolverService`. `UsersController.getMe` returns 200 with added `roles`/`permissions` for active users, 401 for inactive users, and 404 for missing users.

### D2: Category Read/Manage Split (`apps/api/src/modules/categories-tags`)
*   **Seed Data (`database/prisma/seed.ts`)**: Upserts the new `category.read` permission and grants it to `author`, `editor`, and `admin`.
*   **`CategoriesController`**: The class-level `@RequirePermission('category.manage')` is removed. `GET` routes receive `@RequirePermission('category.read')`. POST/PATCH/DELETE receive `@RequirePermission('category.manage')`.

### D3: Article List Filtering (`apps/api/src/modules/articles`)
*   **`ArticleListQueryDto`**: New DTO in `articles/dto/article-list-query.dto.ts`. Uses `class-validator` to enforce `page >= 1` and `1 <= limit <= 100`. Returns HTTP 400 on violations; no silent clamping.
*   **`ArticlesController` & `ArticlesService`**: `findAll` returns `PaginatedResponse<ArticleSummary>`. Enforces `id ASC` as a secondary deterministic sort. Ownership `where` clause remains authoritative.

### D4: Workflow Comments (`apps/api/src/modules/workflow`)
*   **DTOs**: `RequestChangesDto` and `RejectDto` added to `workflow/dto/`, enforcing `comment: string` (`@IsString`, `@IsNotEmpty`, `@MaxLength(1000)`).
*   **`WorkflowController`**: Updates `.requestChanges()` and `.reject()` to use the new typed DTOs instead of `@Body() body: any`.
*   **Version Check Preserved**: `expectedVersion` remains optional in the DTO, ensuring `WorkflowService.getArticle()` still yields `VERSION_REQUIRED` when missing.

### D5: Shared Domain Types (`packages/types`)
*   **`packages/types/src/article.ts`**: Defines `ArticleStatus` (enum matching backend/prisma), `Article`, `ArticleSummary`, `ArticleRevisionSummary`, `SafeUser`, `WorkflowTransitionBody`, `MediaSummary`, `CategorySummary`.
*   **`packages/types/src/index.ts`**: Re-exports all domain types from `./article`.

## CMS Frontend Architecture (`apps/web`)

### Route Tree (D6 & D7)
*   **Path**: `apps/web/app/cms/`
*   `cms/layout.tsx`: Non-gating, mounts `SessionProvider`.
*   `cms/login/page.tsx`: Ungated login form.
*   `cms/(protected)/layout.tsx`: Client-rendered (`'use client'`). Redirects to `/cms/login` if `status === 'unauthenticated'`. Does not redirect while `status === 'loading'`.
*   `cms/(protected)/*`: Includes `/cms` (dashboard), `/cms/articles`, `/cms/articles/new`, `/cms/articles/[id]`, `/cms/review`, and `/cms/categories`.

### State Management & API Client
*   **`SessionProvider`**: Manages `user`, `roles`, `permissions`, `accessToken`, and `status`. Performs token refresh on initial load and maps `GET /users/me` 401 to `unauthenticated`. No other global state management libraries are allowed (Decision 9).
*   **`cms-api.ts`**: Autowraps `fetch` with `Bearer` tokens. Handles single 401 retry-with-refresh. Exposes string error codes (`VERSION_MISMATCH`, etc.).

### UI Components (D9)
*   **Editor**: Plain `<textarea>` for Markdown editing. No rich-text library (Decision 8).
*   **Action Button Gating (AC-2, AC-9, INV6-03)**: Workflow and management buttons are hidden (not disabled) if the authenticated user lacks permission or fails ownership checks. The "Approve" button is never rendered for the article author. "Delete" is never rendered for `PUBLISHED` or `ARCHIVED` articles.
*   **Schedule State (AC-8, INV6-13)**: No date picker or schedule creation affordance exists. "Cancel Schedule" is displayed exclusively as a recovery action on an already-`SCHEDULED` article.
*   **Categories**: Uses D2 `GET /categories` endpoint.
*   **Unsaved Changes**: Intercepts navigation with a native confirmation. Explicitly warns before saving over an `APPROVED` or `SCHEDULED` article (INV6-05).

## Testing Strategy
*   **Backend Unit**: Resolvers, guard-equivalence, DTO boundaries (D3 400s), and DI-graph check (no cycles).
*   **Backend E2E**: New cases for D1 (401 on inactive), D2 (author gets 200 on categories), D3 (limits and sorts), D4 (missing comment). Full regression of all existing suites (INV6-14).
*   **Frontend**: React Testing Library for `SessionProvider`, gating redirects (crucial: no redirect cycles), editor validation, and permission-driven UI.
*   **Browser E2E (D11/D12)**: Playwright (`@playwright/test` devDependency only). Excluded from Jest. Provisions fixtures at the DB level. Executes full editorial journey.
*   **D10**: `apps/web/app/robots.ts` updated with `Disallow: /cms/` and covered in `robots.test.ts`.

## Traceability
*   Source: `phase6-technical-spec-v1.2.md`
*   Architecture & Modules correspond to Spec §4, §6.
*   Frontend Route Tree & State correspond to Spec §5.
*   Testing corresponds to Spec §13, §14.
