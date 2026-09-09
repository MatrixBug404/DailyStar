# DailyStar — Phase 2 Specification: Articles Core

**Document type:** Reviewed, implementation-ready phase specification (no implementation code)
**Authoritative parent document:** `docs/architecture/dailystar_architecture.md`
**Prerequisite:** Phase 0 (scaffolding) and Phase 1 (Identity & RBAC) — complete and validated
**Status:** Draft v1.0, ready for Antigravity

> **Note on inputs:** This review was produced against the architecture document I authored earlier in this engagement and the Phase 1 scope described in your prompt (`User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `RefreshSession`, JWT access tokens, secure refresh-token cookies, refresh rotation, logout/revocation, auth guard, permission guard). I was not given the actual contents of `docs/development/phase-0-checkpoint.md` or the current repository state, so this specification reasons from the documented architecture and stated Phase 1 scope rather than from live code. Before Antigravity begins implementation, it should perform the "inspect before modifying" step from the Antigravity guidelines and reconcile any discrepancy between this spec and what's actually in the repo — and flag any such discrepancy rather than silently resolving it.

---

## 0. Integration With Phase 1 Identity & RBAC

Phase 2 introduces no new authentication mechanism and no new identity concept. It consumes Phase 1 as-is:

- Every Articles Core endpoint sits behind the existing **authentication guard** (valid access token required) except explicitly public read paths — and Phase 2 has none, since there is no publishing yet. **Every Phase 2 endpoint requires authentication.** There is no anonymous access to any article data in this phase (public read-only access is a Phase 5 concern, gated on `PUBLISHED` status, which doesn't exist until Phase 3).
- Authorization uses the existing **permission guard**, extended with a new set of Phase 2 permission strings (Section 4) inserted into the `Permission`/`RolePermission` tables via an additive seed update — no changes to the Phase 1 schema itself.
- `AuthorProfile` (introduced in this phase) is a **1:1 extension of `User`**, not a new identity concept — it exists so public-facing author metadata (display name, bio, avatar) can evolve independently of the private `User` record, exactly as specified in the parent architecture (Section 4.2 of the architecture doc). A `User` does not need an `AuthorProfile` to use the system (e.g., a reader-only account in later phases); an `AuthorProfile` is created automatically the first time a `User` with the `author` role creates an article, or explicitly via a profile-setup step — **this is a decision Antigravity must make consistently and is specified in Section 21.**
- Ownership checks (Section 4) are a **new, Phase-2-specific layer** built on top of Phase 1's guards — Phase 1 has no concept of "resource ownership" because it had no owned resources yet. This phase is where that pattern is introduced for the first time, and it should be built as a **reusable pattern** (not a one-off), since later phases (media, comments) will need the same shape of check.


## 1. Article Domain Model

### 1.1 Design principle

`Article` holds **identity, ownership, and current pointers**. `ArticleRevision` holds **content**. Nothing that represents "what the article says" lives on `Article` — everything that represents "what the article *is* administratively" (who owns it, what state it's in, where it lives) does. This split is what makes the append-only revision history (Section 2) actually trustworthy: if title/body lived on `Article` too, there'd be two sources of truth that could drift.

### 1.2 `Article` fields

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID, PK | Stable identity, never reused, never derived from content (unlike slug) |
| `slug` | string, unique (partial, see Section 15) | URL-facing identifier; mutable during Phase 2 draft life (Section 8) |
| `status` | enum | Phase 2 restricts this to a single legal value, `DRAFT` (Section 3) — modeled as a real enum column now so Phase 3 adds values via migration, not a type change |
| `primaryAuthorId` | UUID, FK → `User.id` | The owning author for ownership checks (Section 4). Set once at creation; **not reassignable in Phase 2** (author transfer, if ever needed, is a Future concern requiring its own audit trail — out of scope now, flagged in Section 21) |
| `categoryId` | UUID, FK → `Category.id`, nullable | Optional at draft stage. The architecture's Phase-3 workflow requires a category before submission-for-review, not before saving a draft — a writer should be able to start drafting before deciding on a section |
| `currentRevisionId` | UUID, FK → `ArticleRevision.id`, **not nullable after creation** | Points at the latest revision (Section 2). This is a **new field name not present in the parent architecture document**, which only specified `current_published_revision_id` (meaningful only once publishing exists). See Section 1.4 for why this is a deliberate, flagged addition |
| `version` | integer, default `1` | Optimistic-concurrency counter (Section 7). Increments on every mutation to `Article` — including creating a new revision, since that changes `currentRevisionId` |
| `createdAt` | timestamptz | Standard audit timestamp |
| `updatedAt` | timestamptz | Standard audit timestamp, updated on every mutation |
| `deletedAt` | timestamptz, nullable | Soft-delete marker (Section 11) |
| `createdBy` | UUID, FK → `User.id` | Actor who created the article — usually equal to `primaryAuthorId`, but kept separate because an editor/admin could theoretically create an article on behalf of an author later; recording actor distinctly from ownership is cheap and avoids ambiguity |
| `updatedBy` | UUID, FK → `User.id`, nullable | Actor of the most recent mutation — useful once editors can touch other authors' drafts (Section 4), so it's visible in the UI *who* last touched it |

**Deliberately excluded from `Article`:** `title`, `body`, `excerpt`, `coverMediaId`. All three of the first are pure content and belong exclusively to `ArticleRevision`. `coverMediaId` is deferred entirely — see Section 1.5.

### 1.3 What about a cover image placeholder?

The parent architecture asked Phase 2 to "consider" a cover media placeholder/reference. **Recommendation: do not add a `coverMediaId` field to `Article` in Phase 2.** Reasoning:

- Media management is explicitly a **Phase 4** concern in the roadmap (the `Media` table doesn't exist yet in Phase 2's scope, and this Phase 2 brief explicitly excludes it from "Do NOT implement").
- Adding a nullable FK to a table that doesn't exist yet is not possible without either forward-declaring `Media` early (scope creep into Phase 4) or using an untyped placeholder string field that would need to be replaced by a real FK later (a throwaway migration).
- The cleanest path is: **Phase 2 ships with no cover-image field at all**; Phase 4 adds `coverMediaId` to `Article` via its own additive migration once `Media` exists. This is a one-line future migration, not an architectural risk, and it avoids Phase 2 owning a stub it doesn't need.

This is a case where the safest resolution to an ambiguous instruction ("consider... if appropriate") is to explicitly *not* do it and say why, rather than half-build a dependency on a later phase.

### 1.4 Flagged addition: `currentRevisionId` vs the architecture's `current_published_revision_id`

The parent architecture document only defines `current_published_revision_id` (nullable until first publish). It was written before Phase 2 was scoped in detail and implicitly assumed articles reach `Article` only alongside a workflow that eventually publishes them. Phase 2 needs a pointer to "the latest revision" **before any concept of publishing exists** — e.g., to know which revision to show when an author opens their draft.

**Resolution:** introduce `currentRevisionId` now (always set, points at the most recent revision regardless of status) and **reserve** `currentPublishedRevisionId` as a Phase-3 addition (nullable, only set once a revision is actually published). These are two different pointers with two different lifecycles — conflating them would force `currentRevisionId` to go backward in a confusing way once editing-after-publish exists (Section 5.3 of the parent architecture: publishing an update creates a new revision, but the *published* pointer shouldn't move until that revision is itself approved). Keeping them separate from the start avoids a breaking rename in Phase 3.

**This is called out explicitly per your instruction to surface architectural ambiguities rather than silently resolve them.** If you'd prefer `currentRevisionId` be named `latestRevisionId` instead, that's a pure naming decision with no structural consequence — flagged as an open naming choice for you to confirm before Antigravity runs the migration.

---

## 2. Article Revision Model

### 2.1 Fields

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID, PK | |
| `articleId` | UUID, FK → `Article.id` | |
| `authorId` | UUID, FK → `User.id` | Who authored *this specific revision* — usually the article's `primaryAuthorId`, but not always (an editor could create a revision on someone else's draft under ownership rules in Section 4) |
| `revisionNumber` | integer | Sequential, starting at `1`, monotonically increasing **per article** (not globally). Human-readable ("Revision 3"), and doubles as a cheap, explicit concurrency signal independent of the UUID `id` (Section 7) |
| `title` | string | See validation in Section 12 |
| `body` | text (Markdown source — see 2.2) | The article content |
| `excerpt` | string, nullable | Short summary/dek; author-supplied in Phase 2, not AI-generated (that's Phase 9+) |
| `createdAt` | timestamptz | The only timestamp a revision needs — revisions are never updated, so there is deliberately **no `updatedAt` column on `ArticleRevision`**, which is itself a small enforcement of immutability at the schema level (a table with no update timestamp is a signal, not just a convention, that rows shouldn't be updated) |

**Deliberately excluded:** no `deletedAt` on `ArticleRevision`. Revisions are never individually deleted — only the parent `Article` is soft-deleted, which implicitly hides its entire revision history. An individually-deletable revision would break the audit guarantee the parent architecture requires.

### 2.2 Content representation: Markdown, not structured JSON, not raw HTML

**Recommendation: `body` is stored as sanitized Markdown source text.** Rendering to HTML happens at read time (in the API response layer or the frontend), using a Markdown renderer configured to disallow raw HTML passthrough (e.g., a CommonMark-compliant renderer with raw-HTML disabled) — so even though the source is plain text, nothing resembling `<script>` can ever reach a browser as executable markup, because the renderer only ever emits the fixed set of HTML tags Markdown syntax maps to.

**Why not structured JSON (e.g., a ProseMirror/Tiptap document tree)?**
Structured JSON is the *technically* stronger choice for a rich WYSIWYG editor with precise formatting control, and is worth reconsidering when Phase 6 (CMS frontend) picks an actual editor component. But committing to a specific structured-JSON schema now means the database schema is coupled to a specific frontend editor library's document format before that library has been chosen — a real over-engineering risk given the parent architecture's explicit "avoid unnecessary complexity" and "do not introduce technologies merely because they are popular" constraints. Markdown is a stable, editor-agnostic, human-readable, diffable format that doesn't lock in a future decision.

**Why not raw HTML?** Explicitly disallowed by this phase's brief and by the parent architecture's security section — persisted HTML is a stored-XSS vector no matter how carefully it's sanitized on the way in, because sanitization rules can go stale as new HTML/CSS attack vectors emerge, whereas Markdown-with-no-raw-HTML has no attack surface to go stale.

**Trade-off acknowledged and flagged:** if Phase 6's CMS editor turns out to need rich embedded elements Markdown doesn't express well (e.g., inline pull-quotes, embedded media blocks with custom layout), a migration to structured JSON becomes a real Phase 6-or-later conversation. That's an acceptable, explicitly-flagged risk rather than a silent one — Markdown-to-structured-JSON is a mechanical, scriptable migration (parse and re-serialize), not a data-loss risk, since Markdown is a strict subset of what most structured formats can represent.

### 2.3 What happens when an author edits a draft

```
Draft Article (currentRevisionId → Revision N)
        │
   author clicks "save" with edited content
        │
        ▼
Validate content (Section 12) + check article.version matches
client's expected version (Section 7)
        │
        ▼
Create ArticleRevision N+1 (immutable, new row)
        │
        ▼
Article.currentRevisionId ← Revision N+1's id
Article.version ← Article.version + 1
Article.updatedAt ← now()
Article.updatedBy ← actor
        │
        ▼
Revision N remains in the database, untouched, forever
(queryable via GET /articles/:id/revisions)
```

**Every save of content creates a new revision. There is no in-place content update, ever — this is the concrete mechanism, not just a policy, that satisfies "revisions are append-only."** The `Article` row itself is updated (its pointer, version, and timestamps change), but no `ArticleRevision` row is ever updated after creation. Section 6 specifies exactly which `PATCH` payload fields trigger this behavior versus metadata-only changes that don't need a new revision.

---

## 3. Article Status During Phase 2

**Recommendation: `status` is a real enum column, but Phase 2 permits exactly one value to be written by application code: `DRAFT`.**

Rejected alternative — no `status` column at all (implicitly "everything is a draft since nothing else exists yet"): this would require a schema migration just to *add* the column in Phase 3, which also means backfilling every existing row, on a column that is fundamental to the entire rest of the system. Adding the enum column now, constrained to one legal value by application-layer validation (not a DB CHECK constraint, since the DB constraint would itself need migrating in Phase 3), costs nothing today and avoids a needless migration later.

**Simplest safe representation:**
- Prisma enum `ArticleStatus` with a single member for now: `DRAFT`. (Prisma enums support additive changes — Phase 3 adds `SUBMITTED_FOR_REVIEW`, `UNDER_REVIEW`, `APPROVED`, `SCHEDULED`, `PUBLISHED`, `ARCHIVED`, `FAILED_TO_PUBLISH` as a purely additive migration.)
- Every `Article` is created with `status = DRAFT` and the `ArticlesService` **does not expose any endpoint or code path capable of setting `status` to anything else** in Phase 2 — there is no `WorkflowModule` yet, and Phase 2 must not informally invent one. If a `PATCH /articles/:id` request body includes a `status` field, it is **rejected** (see Section 12, mass-assignment protection) rather than silently ignored, so that Antigravity doesn't accidentally build half of Phase 3's state machine while attempting to be "helpful."

---

## 4. Ownership and Authorization

### 4.1 Two distinct layers, enforced independently

1. **Role permission** — "can a user with this role ever perform this class of operation?" Enforced by the existing Phase 1 `PermissionGuard`, checking resolved permissions against a required-permission decorator on the route handler. This never looks at *which* article is being acted on.
2. **Resource ownership** — "can *this* user perform the operation on *this specific* article?" Enforced by a **new Phase 2 ownership check inside the service layer**, after the permission guard has already passed, by comparing `article.primaryAuthorId` to the authenticated user's id. This is deliberately **not** a guard (Section 4.3 explains why) — it needs the loaded `Article` row, which a route-level guard doesn't have without an extra DB round-trip duplicating what the service is about to do anyway.

Both layers must pass. A user with `article:update:own` who is *not* the owner is denied at layer 2 even though layer 1 succeeded. A user with no update permission at all is denied at layer 1 and layer 2 is never reached.

### 4.2 Permission set introduced in Phase 2

| Permission string | Granted to | Meaning |
|---|---|---|
| `article.create` | author, editor, admin | Can create a new article (always becomes its owner as `primaryAuthorId = self`) |
| `article.read.own` | author | Can read articles where `primaryAuthorId = self` |
| `article.read.any` | editor, admin | Can read any non-deleted article regardless of owner |
| `article.update.own` | author | Can edit articles where `primaryAuthorId = self` |
| `article.update.any` | editor, admin | Can edit any author's draft |
| `article.delete.own` | author | Can soft-delete their own draft |
| `article.delete.any` | admin | Can soft-delete any draft — **deliberately not granted to editor**, see 4.4 |
| `article.revision.create.own` | author | Can create a new revision on their own article |
| `article.revision.create.any` | editor, admin | Can create a new revision on any author's draft |
| `category.manage` | editor, admin | Create/update/delete categories (Section 9) |
| `tag.manage` | editor, admin | Explicit tag management operations beyond inline find-or-create (Section 10) |

These are inserted via an additive seed update to the existing `Permission`/`RolePermission` tables from Phase 1 — no schema change to those tables, only new rows.

### 4.3 Why ownership is a service-layer check, not a guard

NestJS guards run before the route handler and, in the general case, before the target resource has been loaded from the database. Implementing ownership as a guard would mean either (a) the guard itself queries the database (duplicating the service's own lookup, and now there are two places that can disagree about "does this article exist"), or (b) the guard trusts a route param blindly. **Recommendation:** the service method that handles the operation is responsible for: load the article → check it's not soft-deleted → check ownership/permission-any → perform the operation. This keeps a single source of truth for "does this article exist and can this user touch it," which is also exactly where the IDOR protection in Section 13 lives.

A **role-only** guard (the existing Phase 1 `PermissionGuard`) still runs first, as a cheap fast-fail — it doesn't need to know about ownership, only "does this user's role even have a chance of performing this class of action."

### 4.4 Flagged ambiguity: "Editor can edit drafts when appropriate"

The brief's Editor capability list says editors "can edit drafts when appropriate" without defining "appropriate." This is genuinely ambiguous and has real security consequences if guessed wrong (too permissive → editors casually rewrite authors' unsubmitted, unfinished work without any triggering event; too restrictive → editors can't do the collaborative editing the newsroom obviously needs).

**Recommended resolution for Phase 2:** grant `editor` **`article.read.any` and `article.update.any` unconditionally** (an editor can view and edit *any* draft at any time, including creating new revisions on it) — but explicitly **do not** grant `editor` delete permission on other authors' drafts (`article.delete.any` stays admin-only). Rationale: editing is recoverable (it's just another revision — the original is never lost, Section 2.3), so a permissive edit policy has a low blast radius given the append-only revision history; deletion is a much higher-consequence, harder-to-casually-reverse action even under soft-delete (Section 11), so it's held to a stricter standard. This also matches the parent architecture's Phase-3 workflow, where an editor's real "appropriate" moment to edit is during review — but restricting *when* an editor can touch a draft would require workflow state that doesn't exist until Phase 3, so Phase 2 cannot enforce a time-based "only during review" rule without inventing part of the Phase 3 state machine early, which the brief explicitly forbids.

**This is flagged for your confirmation.** If you'd prefer editors be blocked from touching drafts entirely until Phase 3 workflow exists, that's also defensible and requires only removing `article.update.any` from the editor seed row — a one-line change to this spec, called out now so it isn't decided silently.

### 4.5 Admin

`admin` receives every permission in Section 4.2 (`.any` variants plus create), and additionally is the only role that can hard-delete in a future phase (not Phase 2 — Section 11). No new administrative capability beyond the union of the above is introduced in Phase 2; a dedicated `AdminModule` dashboard is Phase 12 per the roadmap.

---

## 5. Article CRUD API

### 5.1 Recommended routes (refined from the brief's starting list)

| Method | Path | Auth | Permission (layer 1) | Ownership (layer 2) |
|---|---|---|---|---|
| `POST` | `/api/v1/articles` | Required | `article.create` | N/A (creator becomes owner) |
| `GET` | `/api/v1/articles` | Required | `article.read.own` or `article.read.any` | Query is scoped server-side (5.3) |
| `GET` | `/api/v1/articles/:id` | Required | `article.read.own` or `article.read.any` | Owner or `.any` role, else 404 (Section 13) |
| `PATCH` | `/api/v1/articles/:id` | Required | `article.update.own` or `article.update.any` | Owner or `.any` role, else 404 |
| `DELETE` | `/api/v1/articles/:id` | Required | `article.delete.own` or `article.delete.any` | Owner or `.any` role, else 404 |
| `POST` | `/api/v1/articles/:id/restore` | Required | same as delete | Owner or admin — restores a soft-deleted article (Section 11) |
| `GET` | `/api/v1/articles/:id/revisions` | Required | read permission | Owner or `.any` role, else 404 |
| `GET` | `/api/v1/articles/:id/revisions/:revisionId` | Required | read permission | Same as above — fetch one specific historical revision |
| `POST` | `/api/v1/articles/:id/revisions` | Required | revision-create permission | Owner or `.any` role, else 404 |

**Refinement from the brief's starting list:** I added `restore` (needed by Section 11's soft-delete requirement, which the original route list didn't account for) and `GET .../revisions/:revisionId` (needed to actually view a specific historical version, not just list them — listing alone doesn't satisfy "revision history works" in the acceptance criteria). I deliberately did **not** add a separate category/tag CRUD table here — those are a distinct resource group with their own routes, specified in Sections 9–10.

### 5.2 Request/response responsibilities

- `POST /articles` — body: `{ title, body, excerpt?, categoryId?, tags?: string[] }`. Creates `Article` (status `DRAFT`) **and** its first `ArticleRevision` (`revisionNumber = 1`) atomically in a single DB transaction — an `Article` must never exist with zero revisions, since `currentRevisionId` is non-nullable (Section 1.2). Response: full article representation (Section 14) including the embedded current revision.
- `GET /articles` — see 5.3.
- `GET /articles/:id` — returns the article plus its current revision embedded (not the full revision history — that's the dedicated endpoint).
- `PATCH /articles/:id` — see Section 6 for exactly what triggers a new revision vs. a metadata-only update. Requires `expectedVersion` in the body (Section 7).
- `DELETE /articles/:id` — sets `deletedAt`; returns `204 No Content`. Does not accept a body.
- `POST /articles/:id/restore` — clears `deletedAt`; returns the restored article.
- `GET /articles/:id/revisions` — paginated list of revision summaries (`id, revisionNumber, authorId, createdAt` — **not** full body, to keep the list payload small; fetch full content via the single-revision endpoint).
- `POST /articles/:id/revisions` — explicit "create a revision without changing other metadata" endpoint, for a CMS editor UI that separates "save content" from "change category/tags." Functionally a specialization of what `PATCH` also triggers when its body includes content fields — kept as its own endpoint because a revision-creation action has different semantics worth naming explicitly (see Section 6.3 for why both exist rather than only one).

### 5.3 Pagination, filtering, sorting

- **Pagination:** offset-based (`page`, `limit`, default `limit=20`, max `limit=100`). Recommendation over cursor-based pagination: at Phase 2 scale (a single newsroom's draft volume), offset pagination is simpler to implement and reason about, and cursor pagination's main advantage (stable pagination under high write concurrency on a large dataset) doesn't yet apply. Flagged as a Future reconsideration if article volume grows large enough for offset pagination's performance characteristics to matter (deep-page `OFFSET` cost) — a concrete, measurable trigger, consistent with the parent architecture's stated philosophy.
- **Filtering:** `authorId` (editors/admins only — for an author, this is implicitly forced to `self` and any client-supplied value is ignored, not honored, to prevent scope escalation via query param), `categoryId`, `tagId`, `q` (simple case-insensitive substring match on the current revision's title — explicitly **not** the Phase 5 full-text search feature; this is a small CMS convenience, documented as such so nobody mistakes it for search infrastructure).
- **Sorting:** `sortBy=updatedAt|createdAt|title` (default `updatedAt`), `sortOrder=asc|desc` (default `desc`).
- **Default scope enforcement (critical):** `GET /articles` **never** returns another author's drafts to a user who only holds `.own` permissions, regardless of query parameters supplied — this is enforced by the service building the base query from the *resolved* permission set, not by trusting client-supplied filters, which is the same principle as the IDOR protection in Section 13.
- Soft-deleted articles are excluded from `GET /articles` and `GET /articles/:id` by default in all cases (Section 11) — there is no query parameter to include them in Phase 2 (an "include deleted" admin view is a reasonable Phase 12 dashboard feature, not needed now).

### 5.4 Error responses

Standard envelope (Section 14.1) with these Phase-2-relevant cases:

| Situation | Status | Error code |
|---|---|---|
| Not authenticated | 401 | `UNAUTHENTICATED` |
| Authenticated, role permission missing entirely | 403 | `FORBIDDEN` |
| Authenticated, article doesn't exist OR exists but caller has no visibility into it | 404 | `NOT_FOUND` (see Section 13 for why these two cases are merged) |
| Validation failure (Section 12) | 400 | `VALIDATION_ERROR` with field-level `details` |
| Slug conflict on create/update | 409 | `SLUG_CONFLICT` |
| Stale `expectedVersion` on update | 409 | `CONFLICT` (Section 7) |
| Category or tag reference invalid/deleted | 400 | `INVALID_REFERENCE` |
| Attempt to set a disallowed field (e.g. `status`, `primaryAuthorId`) | 400 | `VALIDATION_ERROR` (field rejected at DTO level, see Section 13) |

---

## 6. Draft Editing — Exact Rule

**Rule: `PATCH /articles/:id` inspects which fields are present in the request body and behaves accordingly, per this table — the split is by field, not by endpoint.**

| Fields in `PATCH` body | Behavior |
|---|---|
| `title` and/or `body` and/or `excerpt` present | Creates a **new `ArticleRevision`** (`revisionNumber` = current + 1), copying forward any of `title`/`body`/`excerpt` **not** included in this particular request from the current revision (a partial content edit doesn't blank out the fields the client didn't send). `Article.currentRevisionId` and `version` update as in Section 2.3. |
| Only `categoryId` and/or `tags` and/or `slug` present (no content fields) | **Metadata-only update** — no new revision is created. `Article.categoryId`/`slug`/tag associations update directly; `Article.version` still increments (any mutation bumps version, since concurrency protection needs to catch metadata races too, e.g. two editors reassigning category simultaneously) |
| Any combination of the above | Both effects apply together in one transaction: new revision for content fields, direct update for metadata fields, single `version` bump, single `updatedAt`/`updatedBy` write |
| `status`, `primaryAuthorId`, `id`, `currentRevisionId`, or any other non-editable field present | **Request rejected with 400**, entire request fails (not silently ignored) — see Section 13 mass-assignment protection |

**Why both `PATCH /articles/:id` (with content fields) and `POST /articles/:id/revisions` exist:** they're two entry points to the *same underlying operation* (create a revision), kept separate because they serve different call sites cleanly — `PATCH` is the natural "save my edits" action from a draft editor UI that may also be touching category/tags in the same request, while `POST .../revisions` is useful for a "save as new version" explicit action or for programmatic/scripted revision creation (e.g. a future AI-assisted-edit tool) where no metadata change is implied. **Antigravity should implement both against a single shared service method** (`ArticlesService.createRevision(...)`) so there is exactly one code path that actually inserts an `ArticleRevision` row — not two independent implementations that could drift.

---

## 7. Optimistic Concurrency

### 7.1 Strategy: `Article.version` integer, checked on every mutating request

**Recommendation: use the `version` integer column already defined on `Article` (Section 1.2), not `updatedAt` timestamp comparison and not the revision number alone.**

Why not `updatedAt`: timestamp comparison is subject to clock/precision ambiguity (two writes in the same millisecond, or driver-level timestamp truncation) and is a real, if narrow, correctness risk — an integer counter has no such ambiguity.

Why not `revisionNumber` alone: `revisionNumber` only changes when content changes (Section 6); a metadata-only update (e.g., category reassignment) wouldn't bump it, so two editors racing on category vs. tags wouldn't be caught. `version` bumps on *any* mutation, which is the actual concurrency guarantee needed.

Why not a full row-hash/ETag: unnecessary complexity for what an integer counter already solves cleanly at this scale — flagged explicitly as the kind of "advanced" solution this project's stated philosophy says to avoid absent a concrete need.

### 7.2 Client contract

Every `PATCH /articles/:id` and `POST /articles/:id/revisions` request body must include `expectedVersion: number`, the version the client last observed (returned in every article response, Section 14). The service performs a conditional update:

```
UPDATE Article SET ..., version = version + 1
WHERE id = :id AND version = :expectedVersion
```

If zero rows are affected, the version didn't match — someone else mutated the article since the client last read it.

### 7.3 Conflict behavior

```
Client A reads Article, sees version = 4
Client B PATCHes the same article → server accepts (version 4 matched) → new version = 5
Client A PATCHes with expectedVersion = 4 → server finds version is now 5, no rows match
→ 409 Conflict
```

**Recommended status code: `409 Conflict`**, not `412 Precondition Failed`. Rationale: `412` is the technically-idiomatic choice when using HTTP conditional headers (`If-Match`/`ETag`), but this design uses an application-level body field (`expectedVersion`) rather than HTTP conditional headers, specifically because it's simpler for a JSON API client to reason about (no header-parsing edge cases, works identically over any HTTP client library without special conditional-request support) — and `409` is the more conventional status for "the resource state conflicts with the request" in body-based JSON APIs. This is a deliberate simplicity trade-off, flagged as such; switching to `If-Match`/`412` remains available as a Future refinement if the team later wants strict HTTP-conditional-request semantics (e.g. for CDN/proxy-level conditional caching benefits) — not needed at this phase.

**Response body on conflict:**

```
{
  "statusCode": 409,
  "error": "CONFLICT",
  "message": "This article was modified by someone else. Reload and try again.",
  "currentVersion": 5
}
```

Returning `currentVersion` lets the client refetch and retry without a second round trip just to discover the new version.

---

## 8. Slug Architecture

- **Generation:** on creation, if no `slug` is explicitly supplied, derive one from the first revision's `title` — lowercase, diacritics stripped/transliterated, non-alphanumeric characters collapsed to single hyphens, leading/trailing hyphens trimmed, capped at a max length (e.g., 150 chars, truncating on a word boundary rather than mid-word).
- **Normalization:** the same transformation is applied whether the slug is auto-derived or explicitly client-supplied, so `My Great Title!` and `my-great-title` both normalize to the same canonical form — this prevents near-duplicate slugs that differ only in casing/punctuation.
- **Uniqueness:** enforced by a database-level unique constraint scoped to non-deleted articles (Section 15) — application-level checking alone is not sufficient under concurrent requests (classic TOCTOU race), so the DB constraint is the real guarantee and the application-level pre-check is only there to produce a clean `409 SLUG_CONFLICT` instead of a raw DB error surfacing to the client.
- **Conflict handling on auto-generation:** if the derived slug collides with an existing one, append a numeric suffix (`-2`, `-3`, ...) automatically rather than failing the create request — a human didn't choose this slug, so silently disambiguating it is reasonable UX. If the client explicitly supplied a slug and it collides, **do not auto-suffix** — return `409 SLUG_CONFLICT` and let the human choose, since silently changing a slug someone deliberately typed is surprising behavior.
- **Editability during draft:** slug **is editable** at any point while `status = DRAFT`, via `PATCH` (Section 6, metadata-only field), subject to the same normalization/uniqueness rules.
- **Stability after publication (forward-looking, enforced starting Phase 3, designed for now):** once an article reaches `PUBLISHED` in Phase 3, the slug becomes immutable — this is a Phase 3 enforcement rule, but Phase 2's job is to **not build anything that makes that future rule hard to add**. Concretely: keep slug mutation as a normal field update with no caching/CDN/redirect assumptions baked in yet (those arrive with the public site in Phase 5), and don't expose a "slug history" concept in Phase 2 that Phase 3 would then have to reconcile — a redirect-on-slug-change feature, if wanted, belongs to Phase 5 alongside the public site itself, not here.

---

## 9. Category Model

| Field | Type | Notes |
|---|---|---|
| `id` | UUID, PK | |
| `name` | string, required | Display name |
| `slug` | string, unique | Normalized like article slugs (Section 8) |
| `parentId` | UUID, FK → `Category.id`, nullable | Self-referential hierarchy |
| `createdAt`/`updatedAt` | timestamptz | |

- **Hierarchy depth:** capped at **3 levels** (e.g., `News > National > Elections`), enforced in the service layer at creation/reparenting time (walk up from the proposed parent, reject if it would exceed depth 3). Justification: real newsroom taxonomies are practically 2–3 levels deep; unlimited nesting adds real UI/query complexity (recursive queries, breadcrumb rendering) for a benefit no stated requirement calls for — a concrete instance of "avoid unnecessary complexity."
- **Uniqueness:** `slug` unique globally (not per-parent) — two different sections both slugging to `national` would be confusing even if they're under different parents; global uniqueness is simpler and matches how the public URL structure will likely work in Phase 5.
- **Deletion behavior:** a category **cannot be deleted** while it has (a) child categories or (b) any non-deleted article referencing it — the delete endpoint returns `409` with a clear error (`CATEGORY_IN_USE`) rather than cascading. Cascading delete was explicitly considered and rejected: silently reassigning or orphaning articles' categories as a side effect of an unrelated admin action is exactly the kind of surprising, hard-to-audit behavior the parent architecture's "publishing workflows must be auditable" principle argues against. An editor/admin must explicitly reassign or remove the dependent articles/children first.
- **Who manages categories in Phase 2:** `editor` and `admin` only (`category.manage` permission, Section 4.2). Authors cannot create/edit/delete categories — keeps the taxonomy centrally controlled, consistent with "keep category management simple" and avoids an author accidentally fragmenting the taxonomy with a near-duplicate category.

---

## 10. Tag Model

| Field | Type | Notes |
|---|---|---|
| `Tag.id` | UUID, PK | |
| `Tag.name` | string, required | Display form, e.g. `Climate Change` |
| `Tag.slug` | string, unique | Normalized (lowercase, trimmed, hyphenated) — this is the actual uniqueness/dedup key, not `name` |
| `ArticleTag.articleId` | UUID, FK | |
| `ArticleTag.tagId` | UUID, FK | |
| `ArticleTag` composite unique | `(articleId, tagId)` | Prevents the same tag being attached twice to one article |

- **Normalization/dedup:** on any tag reference (creating an article with `tags: ["Climate Change"]`), the service normalizes the string to a slug and does a **find-or-create**: if a `Tag` with that slug exists, reuse it; otherwise create it. This is a plain, predictable rule — not "clever" automation like NLP-based tag suggestion (explicitly out of scope; that's an AI-newsroom-era feature, Phase 9+, and even there it would be a *proposal*, never auto-applied, per the parent architecture's AI boundaries).
- **Who can create tags:** **authors can create new tags inline** while editing their own article (via the find-or-create above) — recommended because tags are additive, low-risk, per-article metadata, unlike categories which define the site's structural taxonomy. A wrong/redundant tag has near-zero blast radius and is trivially fixed; a fragmented category tree is a structural problem. `tag.manage` (Section 4.2) is reserved for *editor/admin-only* operations beyond inline creation — specifically, **renaming or deleting** an existing tag (which affects every article using it) is `editor`/`admin`-only, not something an author can do by editing their own draft.
- **Maximum tags per article:** **10**. Justification: a reasonable ceiling that prevents tag-spam/keyword-stuffing (an SEO anti-pattern the parent architecture's SEO-architecture goals would want to avoid) while comfortably covering legitimate multi-topic articles; not an arbitrary round number chosen without reason — flagged as a configurable constant, not a hardcoded magic number, so the team can tune it later without a schema change.

---

## 11. Soft Delete

- **Meaning of `deletedAt`:** a non-null timestamp means "this article is hidden from normal use but not destroyed." It is the *only* deletion mechanism in Phase 2 — there is no hard-delete endpoint or code path.
- **Default query behavior:** every read path (`GET /articles`, `GET /articles/:id`, revision listing) excludes soft-deleted articles by default, with no query parameter to override this in Phase 2 (Section 5.3).
- **Who can delete:** the owning author (`article.delete.own`) or an admin (`article.delete.any`) — **not** editors, per the flagged decision in Section 4.4.
- **Recovery:** the owning author or an admin can call `POST /articles/:id/restore` to clear `deletedAt`, with no time limit or approval step in Phase 2 — since a draft that was never published carries no public-facing consequence, self-service restore is safe and good UX. (A retention/expiry policy — e.g., permanently purging soft-deleted drafts after N days — is a reasonable Future addition once storage/compliance considerations actually call for it; not needed now.)
- **Permanence:** deletion in Phase 2 is **never permanent**. Hard deletion of article data is explicitly out of scope for this phase and, per the parent architecture's Antigravity guidelines, would require explicit human approval as a destructive operation — it belongs to a deliberately separate, later admin-tooling conversation, not something Phase 2 should build "while we're in here."

---

## 12. Data Validation

| Field | Rule | Justification |
|---|---|---|
| `title` | Required, 5–200 characters | A floor prevents empty/placeholder junk titles; a 200-char ceiling is generous for even long headlines while catching obvious data-entry errors (e.g., pasted body text into the title field) |
| `body` | Required for revision creation, 1–200,000 characters | No meaningful minimum beyond "not empty" — writers must be able to save an early, short, in-progress draft; strict content-completeness requirements belong to the Phase 3 submit-for-review validation, not draft-save. The 200,000-char ceiling (~30,000+ words) protects against payload abuse/runaway input while comfortably exceeding any realistic news article length |
| `excerpt` | Optional, max 500 characters | Generous for a summary/dek without allowing it to become a second article body |
| `slug` | `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–150 characters | Matches standard URL-slug conventions; the regex prevents leading/trailing/doubled hyphens and any character that would need URL-encoding |
| `categoryId` | Optional; if present, must reference an existing, non-deleted `Category` | Prevents dangling/invalid references (Section 15 indexes support this check efficiently) |
| `tags` | Optional array, max 10 entries (Section 10), each entry 2–40 characters pre-normalization | Prevents both spam (Section 10) and degenerate single-character tags |

**Mass-assignment protection:** the create/update DTOs are **allow-lists**, not the raw request body passed through — `id`, `status`, `primaryAuthorId`, `currentRevisionId`, `version`'s *target* value (as opposed to `expectedVersion`, which is a legitimate input, Section 7), `createdAt`, `createdBy` are never accepted as client input on any endpoint. NestJS's `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true` (or equivalent) rejects any request containing an unrecognized field with `400 VALIDATION_ERROR`, rather than silently stripping it — silent stripping would hide a client bug (or a probing attack) instead of surfacing it.

---

## 13. Security

Addressing each item from the brief explicitly:

- **Authorization / IDOR:** every service method that operates on an existing article performs the load-then-check sequence from Section 4.3. **Critical rule: `GET`/`PATCH`/`DELETE /articles/:id` return `404 Not Found` — not `403 Forbidden` — when the requester has no visibility into that article at all** (not the owner, not holding a `.any` permission). Returning `403` would confirm the article's existence to someone who shouldn't even know it's there, which is itself an information leak for a system whose whole point is that unpublished drafts are confidential. `403` is reserved for the narrower case where the requester *can* see the resource (e.g., an editor viewing any draft) but is attempting an action they're not permitted to perform on it — a case that doesn't actually arise much in Phase 2's permission model (Section 4.2's granted permissions are fairly coarse) but is specified now so the pattern is consistent as later phases add more nuanced permission checks.
- **Ownership bypass:** covered structurally by Section 4 — there is exactly one code path (`ArticlesService`) that performs ownership checks, and controllers never bypass it by querying Prisma directly.
- **Mass assignment:** covered in Section 12.
- **Unsafe HTML / malicious rich-text:** covered in Section 2.2 — Markdown-only storage with raw-HTML-disabled rendering removes the stored-XSS surface entirely rather than relying on sanitization-on-the-way-in, which is a weaker defense (sanitizer bugs/bypasses are a recurring real-world vulnerability class).
- **Overly permissive query filters:** covered in Section 5.3 — filters are applied *within* a server-computed scope (derived from the caller's actual permissions), never used to expand that scope. An author sending `?authorId=<someone-else>` gets their own results, not an error and not someone else's data — silently ignoring the attempted override (rather than erroring) avoids revealing whether the targeted author/article exists.
- **Soft-delete bypass:** every query (Section 5.3, Section 11) includes `deletedAt IS NULL` as a base condition applied by the service layer itself, not as an optional filter a caller could omit — so there's no request shape that returns deleted articles in Phase 2.
- **Leaking drafts to unauthorized users:** this is the central threat model of Phase 2, addressed by the combination of: mandatory authentication on every route, permission-guard as a first gate, ownership-check as a second gate, 404-not-403 to avoid existence leakage, and default-excluded soft-deleted rows. **The explicit non-negotiable stated in the brief — "a valid authenticated user must not automatically be able to access another user's draft simply because they know its ID" — is satisfied precisely because the ownership check in Section 4.3 runs on every single-resource endpoint, unconditionally, regardless of how the ID was obtained.**

---

## 14. API Response Design

### 14.1 Standard envelope

Success responses return the resource directly (no unnecessary wrapper) for single-resource endpoints; list endpoints return `{ data: [...], pagination: { page, limit, total, totalPages } }`. Error responses use the shape shown in Section 5.4.

### 14.2 Article representation

```
{
  "id": "...",
  "slug": "...",
  "status": "DRAFT",
  "primaryAuthorId": "...",
  "primaryAuthor": { "id": "...", "displayName": "...", "avatarUrl": "..." },  // from AuthorProfile, embedded — see note
  "categoryId": "..." | null,
  "category": { "id": "...", "name": "...", "slug": "..." } | null,
  "tags": [ { "id": "...", "name": "...", "slug": "..." } ],
  "currentRevision": {
    "id": "...", "revisionNumber": 3, "title": "...", "body": "...", "excerpt": "...", "createdAt": "..."
  },
  "version": 4,
  "createdAt": "...", "updatedAt": "...",
  "createdBy": "...", "updatedBy": "..." | null
}
```

**Note on embedding author info:** embed a minimal `primaryAuthor` object (id, display name, avatar — sourced from `AuthorProfile`, not the raw `User` record) rather than requiring the client to make a second request. **Never embed** `User` fields like email or password hash — the join goes through `AuthorProfile` specifically because it's the public-safe subset by design (Section 0). If a `User` has no `AuthorProfile` yet, fall back to a minimal placeholder (`{ id, displayName: null }`) rather than erroring the whole article response.

Internal-only fields never returned in any response: nothing in Phase 2's schema is inherently sensitive at the DB level beyond the `User` exclusion above, but as a general rule Antigravity should use explicit Prisma `select`, not `include` of entire related rows, so that any future sensitive field added to `User` is excluded by default rather than requiring someone to remember to blacklist it later.

### 14.3 Revision list vs. single revision

List endpoint (`GET /articles/:id/revisions`) returns summaries only: `{ id, revisionNumber, authorId, createdAt }` — no `title`/`body`/`excerpt`, to keep a long history's list payload small. Full content is fetched via `GET /articles/:id/revisions/:revisionId`.

### 14.4 Soft-deleted articles

Never appear in any Phase 2 response shape by default (Section 11); there is no "deleted" flag surfaced in the standard article representation since a client should never see one in the first place.

---

## 15. Database Indexes and Constraints

| Index / constraint | On | Why |
|---|---|---|
| Partial unique index on `slug` WHERE `deletedAt IS NULL` | `Article` | Enforces uniqueness among *live* articles only, while allowing a soft-deleted article's old slug to be reused by a new article — a full (non-partial) unique index would permanently lock a slug even after its article is deleted, which is unnecessary and would surprise authors |
| B-tree index on `primaryAuthorId` | `Article` | Every author's "my drafts" list query (`GET /articles?authorId=self`) filters on this — the single most common query pattern in Phase 2 |
| B-tree index on `categoryId` | `Article` | Supports category-filtered listing (used now for CMS filtering, and again by the public site in Phase 5) |
| B-tree index on `status` | `Article` | Cheap to add now, low value in Phase 2 (only one status value exists) but essential the moment Phase 3 introduces multiple statuses and workflow queries filter on it constantly — adding it later would mean an index build on a populated table instead of an empty one |
| Partial index on `deletedAt` WHERE `deletedAt IS NOT NULL` | `Article` | Supports the soft-delete exclusion filter efficiently without indexing the (much larger) set of non-deleted rows redundantly |
| Composite unique index on `(articleId, revisionNumber)` | `ArticleRevision` | Enforces the per-article sequential numbering guarantee (Section 2.1) at the database level, not just in application logic |
| B-tree index on `articleId` | `ArticleRevision` | Supports the revision-history listing query (already covered by the composite index above as its leading column, so this is effectively free, not a separate index) |
| Unique index on `slug` | `Category` | Enforces global slug uniqueness (Section 9) |
| B-tree index on `parentId` | `Category` | Supports hierarchy traversal (listing children of a category, computing depth) |
| Unique index on `slug` | `Tag` | Enforces the dedup key (Section 10) |
| Composite unique index on `(articleId, tagId)` | `ArticleTag` | Prevents duplicate tag associations (Section 10) — this *is* the constraint that makes `ArticleTag` a proper join table rather than allowing accidental duplicate rows |

**Explicitly not indexed:** `title`/`excerpt` on `ArticleRevision` — the `q` substring filter (Section 5.3) is a small-scale CMS convenience over a modest dataset in Phase 2, not a performance-critical path; adding a text-search index for it now would be exactly the kind of premature optimization the parent architecture warns against, given that real search is an explicitly deferred, separate Phase 5 concern with its own indexing strategy.

---

## 16. Testing Strategy

### 16.1 Unit tests (`ArticlesService`, `CategoriesService`, `TagsService` in isolation, repositories mocked)

- Article creation produces exactly one `Article` + one `ArticleRevision` (`revisionNumber = 1`) in a single transaction; a simulated transaction failure leaves neither row persisted.
- Validation rejects: empty title, title > 200 chars, body > 200,000 chars, excerpt > 500 chars, malformed slug, more than 10 tags, category reference to a non-existent/deleted category.
- Ownership check: owner passes, non-owner without `.any` fails, non-owner with `.any` passes.
- Slug normalization produces identical output for varied casing/punctuation input; auto-suffix logic on collision for auto-generated slugs; hard failure (no auto-suffix) on collision for explicitly-supplied slugs.
- Revision creation: content-field presence triggers new revision; metadata-only fields do not; combined payload does both correctly (Section 6).
- Category hierarchy: depth-3 creation succeeds, depth-4 creation rejected; deletion blocked when children or articles reference it.
- Tag find-or-create: duplicate name (different casing) resolves to the same `Tag` row, not a new one.
- Concurrency: matching `expectedVersion` succeeds and increments `version`; stale `expectedVersion` raises the conflict condition without mutating any row.

### 16.2 Integration tests (real test database, full request → response cycle)

- Author creates a draft, reads it back, edits it (content and metadata separately and combined), views its revision history, deletes it, restores it.
- Author A cannot read, edit, or delete Author B's draft via direct ID access — verify `404`, not `403` and not `200`.
- Editor can read and edit any author's draft; editor **cannot** delete another author's draft (Section 4.4's resolved rule) — verify `403`.
- Admin can perform every operation, including delete on any author's draft.
- `GET /articles` returns only the caller's own drafts for an author, and honors category/tag/status/search filters within that scope; an author's attempt to filter by another author's `authorId` silently returns their own results, not an error and not the other author's data.
- Revision history returns revisions in order with correct `revisionNumber` sequencing; fetching a specific past revision returns its exact immutable content, unaffected by later edits.
- Slug conflict on explicit slug returns `409 SLUG_CONFLICT`; auto-generated slug collision auto-suffixes without error.
- Category hierarchy CRUD: create nested categories to the depth limit, verify the limit is enforced via the API (not just the service unit test); attempt deletion of a category with an attached article, verify `409 CATEGORY_IN_USE`.
- Duplicate tag submission (same tag, different casing) on article creation results in one `ArticleTag` association, not a validation error and not a duplicate `Tag` row.
- Soft-deleted article is invisible to `GET /articles` and `GET /articles/:id` (`404`) for its own owner until restored.

### 16.3 Security tests (explicit, separate from functional integration tests)

- **IDOR:** systematically attempt `GET`/`PATCH`/`DELETE` on another user's article ID across every role combination that should be denied; assert `404` specifically (not just "not 200").
- **Privilege escalation attempts:** an authenticated `author` token attempting `category.manage`-gated or `article.delete.any`-gated operations is rejected at the permission-guard layer (`403`), verified independently of any ownership scenario.
- **Mass assignment:** a `PATCH` body including `status`, `primaryAuthorId`, `id`, `currentRevisionId`, or `version` (as a target rather than `expectedVersion`) is rejected wholesale with `400`, and — critically — none of the *other*, legitimate fields in that same request are applied either (the whole request fails, nothing partially succeeds), verified by checking the article is completely unchanged afterward.
- **Unauthorized revision creation:** a user without `article.revision.create.own`/`.any` on the target article cannot create a revision via either `PATCH` or `POST .../revisions`.
- **Unauthorized deletion:** covered by the IDOR and privilege-escalation cases above, plus the specific editor-cannot-delete-any case from Section 4.4.
- **Deleted article access:** every read/write endpoint against a soft-deleted article's ID returns `404` for non-admin/non-owner-restore callers, confirmed for `GET`, `PATCH`, and revision-listing specifically (not just `GET /articles/:id`).

### 16.4 Regression requirement

**Phase 1's authentication/RBAC test suite must still pass unmodified** after Phase 2 lands — Phase 2 only *adds* rows to `Permission`/`RolePermission` via seed and *adds* new modules; it must not alter any Phase 1 schema, guard, or token-handling behavior. Antigravity should run the full existing test suite, not just the new Phase 2 tests, before considering the phase complete (Section 20).

---

## 17. Folder / Module Structure

Building directly on the folder structure already established in the parent architecture document:

```
apps/api/src/modules/
├── articles/
│   ├── articles.controller.ts        # thin — routes → service calls only
│   ├── articles.service.ts           # article CRUD, ownership checks, concurrency handling
│   ├── revisions.service.ts          # the single shared createRevision(...) path (Section 6)
│   ├── author-profiles.service.ts    # AuthorProfile get-or-create logic (Section 21)
│   ├── dto/
│   │   ├── create-article.dto.ts
│   │   ├── update-article.dto.ts     # explicit allow-list, Section 12
│   │   └── query-articles.dto.ts     # pagination/filter/sort params
│   ├── guards/
│   │   └── article-ownership.guard.ts   # OR a service-layer helper, per Section 4.3's recommendation
│   │                                     # (kept here as a folder placeholder either way — see note below)
│   └── slug.util.ts                  # generation/normalization (Section 8), reused by categories/tags
│
├── categories-tags/
│   ├── categories.controller.ts
│   ├── categories.service.ts         # hierarchy rules, depth limit, deletion guard (Section 9)
│   ├── tags.controller.ts
│   ├── tags.service.ts               # find-or-create, rename/delete (Section 10)
│   └── dto/
│
└── (existing Phase 1 modules: auth/, users/, rbac/ — unchanged, only their seed data grows)
```

**Note on the ownership check's location:** Section 4.3 recommends the ownership check live inside the service method, not a guard, because it needs the loaded entity. The folder listing above keeps a `guards/` subfolder as a placeholder only in case Antigravity's actual implementation prefers a custom decorator/guard hybrid (NestJS supports guards that call into a service to load data) — **the architectural requirement is single-source-of-truth ownership logic, not a specific NestJS primitive**; Antigravity should pick whichever concretely avoids duplicating the "does this article exist and is it visible to this caller" check in more than one place.

**No additional top-level modules are justified in Phase 2.** `categories-tags` bundling two related, simple reference-data resources under one module (as the parent architecture already proposed) remains appropriate — they're both small, share very similar admin-management characteristics (Section 9–10), and splitting them into two modules now would be premature structural overhead for two resources this simple. Revisit only if either grows meaningfully more complex (e.g., category-based permissions in a later phase).

---

## 18. Frontend Scope

**Phase 2 is backend/domain-foundation-only.** No CMS UI is required to complete this phase.

**Optional, explicitly-labeled smoke-testing surface (not required for Phase 2 completion):**
- A minimal, unstyled route under `apps/web/app/(cms)/articles-debug/` with a plain HTML form for create/edit and a plain list view, wired directly to the Phase 2 API — useful for a human reviewer to manually verify the backend without needing a REST client, but explicitly **not** the real CMS UI (which is Phase 6, with real design, real UX, revision-diff views, etc.). If Antigravity builds this, it must be clearly marked (in a code comment and in the phase completion report, Section 20) as a temporary debug aid to be deleted or replaced in Phase 6, not extended.
- If time/scope doesn't allow even this, Phase 2 is equally complete via API-level testing alone (Section 16) — the optional frontend adds convenience, not correctness.

---

## 19. Migration Strategy

- **All changes are additive.** New Prisma models (`Article`, `ArticleRevision`, `AuthorProfile`, `Category`, `Tag`, `ArticleTag`) plus new enum (`ArticleStatus`, single value `DRAFT` for now, Section 3). No existing Phase 1 model (`User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `RefreshSession`) is altered, renamed, or dropped.
- **Migration naming:** follow the existing Phase 1 convention exactly (Antigravity should inspect the actual migration filenames already in the repo before naming this one, per the "inspect before modifying" rule) — a descriptive name along the lines of `add_articles_core` prefixed with the tool-generated timestamp.
- **Ordering:** this migration must run **after** all Phase 1 migrations and depends on `User.id` existing as a valid FK target (for `Article.primaryAuthorId`/`createdBy`/`updatedBy`, `ArticleRevision.authorId`, `AuthorProfile.userId`) — no other ordering constraint.
- **Seed changes:** additive upserts only — insert the new `Permission` rows from Section 4.2 and their `RolePermission` associations for `author`/`editor`/`admin`. The seed script must be **idempotent** (safe to re-run against a database that already has Phase 1 seed data) — use upsert-by-unique-key (e.g., permission name) rather than blind insert, consistent with good migration/seed hygiene generally and explicitly required by the parent architecture's "never make destructive changes without approval" guideline (a non-idempotent seed that errors or duplicates on re-run is its own kind of operational risk).
- **Phase 1 data integrity:** existing `User`/`Role`/`Permission`/`RolePermission`/`UserRole`/`RefreshSession` rows must remain fully intact and functional after this migration — verified concretely by the regression requirement in Section 16.4.
- **No destructive migration is proposed anywhere in this phase.**

---

## 20. Phase 2 Acceptance Criteria

Phase 2 is complete only when **all** of the following are true:

- [ ] `Article`, `ArticleRevision`, `AuthorProfile`, `Category`, `Tag`, `ArticleTag` schemas exist exactly as specified in Sections 1, 2, 9, 10 (or with any deviations explicitly re-confirmed against this spec, per Section 21's naming flags)
- [ ] Migration applies cleanly to a database already containing Phase 1 schema and seed data, with no destructive operation
- [ ] Seed script idempotently adds Phase 2 permissions and role mappings (Section 4.2, 19)
- [ ] Full article CRUD works per Section 5, including the refined route set (restore, single-revision fetch)
- [ ] Ownership enforcement works exactly per Section 4 and 13 (404-not-403 rule verified, not just permission-denial verified)
- [ ] Revision history works: creation, sequential numbering, immutability, list + single-fetch endpoints (Section 2, 5, 16.2)
- [ ] Slug handling works: generation, normalization, uniqueness, auto-suffix on auto-generated collision, hard-fail on explicit collision, editability during draft (Section 8)
- [ ] Soft delete works: default exclusion, restore, no hard-delete path exists (Section 11)
- [ ] Optimistic concurrency works: matching version succeeds, stale version returns `409` with `currentVersion` in the body (Section 7)
- [ ] Category hierarchy works: depth limit enforced, deletion blocked while in use (Section 9)
- [ ] Tag find-or-create and normalization work; max-10 limit enforced; rename/delete restricted to `tag.manage` (Section 10)
- [ ] All Section 16.3 security tests pass, specifically including the IDOR 404-not-403 assertions
- [ ] All Section 16.1 unit tests pass
- [ ] All Section 16.2 integration tests pass
- [ ] Lint passes across the modified/added codebase
- [ ] Typecheck passes
- [ ] Build passes (backend; frontend build passes too if the optional Section 18 debug UI was built)
- [ ] **The full pre-existing Phase 1 authentication/RBAC test suite still passes, unmodified, with no test skipped or altered to accommodate Phase 2 changes**
- [ ] None of the explicitly out-of-scope Phase 3+ concerns (Section "Do NOT implement" below) have been introduced anywhere in the codebase, including partially

---

## ANTIGRAVITY IMPLEMENTATION SPECIFICATION

This section is the condensed, implementation-ready extract of the full specification above. It is written to be handed to Antigravity directly.

### 1. Database models and key fields

**`Article`**: `id` (UUID PK), `slug` (string, unique among non-deleted rows), `status` (enum `ArticleStatus`, only `DRAFT` valid in Phase 2), `primaryAuthorId` (FK → User.id), `categoryId` (FK → Category.id, nullable), `currentRevisionId` (FK → ArticleRevision.id, not null after creation), `version` (int, default 1), `createdAt`, `updatedAt`, `deletedAt` (nullable), `createdBy` (FK → User.id), `updatedBy` (FK → User.id, nullable). No `title`/`body`/`excerpt`/`coverMediaId` on this model (Section 1).

**`ArticleRevision`**: `id` (UUID PK), `articleId` (FK), `authorId` (FK → User.id), `revisionNumber` (int, sequential per article starting at 1), `title` (string), `body` (text, Markdown source), `excerpt` (string, nullable), `createdAt`. No `updatedAt`, no `deletedAt` (Section 2).

**`AuthorProfile`**: `id` (UUID PK), `userId` (FK → User.id, unique — 1:1), `displayName` (string), `bio` (text, nullable), `avatarUrl` (string, nullable), `createdAt`, `updatedAt`. Created lazily: the first time a `User` holding the `author` role successfully creates an `Article`, if no `AuthorProfile` exists for them, create one with `displayName` defaulted from their `User` record's name field (exact source field to be confirmed against the actual Phase 1 `User` schema during implementation — flagged, since this spec doesn't have visibility into the exact Phase 1 `User` field names).

**`Category`**: `id` (UUID PK), `name` (string), `slug` (string, unique), `parentId` (FK → Category.id, nullable, self-referential), `createdAt`, `updatedAt`.

**`Tag`**: `id` (UUID PK), `name` (string), `slug` (string, unique).

**`ArticleTag`**: `articleId` (FK), `tagId` (FK), composite unique `(articleId, tagId)`.

### 2. Relationships
`User 1—* Article` (as primaryAuthor), `User 1—* ArticleRevision` (as author), `User 1—1 AuthorProfile`, `Article 1—* ArticleRevision`, `Article *—1 ArticleRevision` (currentRevisionId), `Article *—0..1 Category`, `Article 1—* ArticleTag *—1 Tag`, `Category 1—* Category` (self-ref parent/child).

### 3. Constraints
Partial unique `Article.slug WHERE deletedAt IS NULL`; unique `Category.slug`; unique `Tag.slug`; composite unique `(ArticleRevision.articleId, ArticleRevision.revisionNumber)`; composite unique `(ArticleTag.articleId, ArticleTag.tagId)`; category hierarchy max depth 3, enforced in service logic, not a DB constraint.

### 4. Indexes
Per Section 15: `Article.primaryAuthorId`, `Article.categoryId`, `Article.status`, partial `Article.deletedAt WHERE NOT NULL`, `ArticleRevision.articleId` (covered by the composite unique), `Category.parentId`. Do not add a text-search index on revision content in this phase.

### 5. REST endpoints
Per Section 5.1's table exactly — `POST/GET /articles`, `GET/PATCH/DELETE /articles/:id`, `POST /articles/:id/restore`, `GET /articles/:id/revisions`, `GET /articles/:id/revisions/:revisionId`, `POST /articles/:id/revisions`, plus standard CRUD for `Category` and `Tag` under `categories-tags` gated by `category.manage`/`tag.manage`.

### 6. Permission requirements
New permission strings and role grants exactly per Section 4.2's table. Insert via additive, idempotent seed upsert (Section 19). Do not modify Phase 1's permission-guard implementation itself — only its data.

### 7. Ownership rules
Service-layer check (not primarily a route guard) comparing `article.primaryAuthorId` to the authenticated user, applied on every single-resource endpoint, before any mutation and before returning any single-resource read. `editor` gets `.any` read/update but **not** `.any` delete (Section 4.4 — confirm this resolution before implementation, since it resolves an ambiguity in the source brief).

### 8. Revision rules
Every content change (`title`/`body`/`excerpt`) creates a new, immutable `ArticleRevision` row and advances `Article.currentRevisionId` + `version`. Metadata-only changes (`category`, `tags`, `slug`) update `Article` directly without a new revision, but still advance `version`. Exactly one shared service method performs revision creation, called by both `PATCH /articles/:id` and `POST /articles/:id/revisions`.

### 9. Slug rules
Auto-generate from title if not supplied; normalize consistently regardless of source; auto-suffix on collision only for auto-generated slugs; hard-fail (`409 SLUG_CONFLICT`) on collision for explicitly-supplied slugs; editable at any point while `status = DRAFT`; DB-level partial unique constraint is the real uniqueness guarantee, not just application logic.

### 10. Category/tag behavior
Categories: `editor`/`admin`-managed only, max depth 3, deletion blocked while children or articles reference it (`409 CATEGORY_IN_USE`), no cascade. Tags: find-or-create inline by any author editing their own article, normalized/deduped by slug, max 10 per article; rename/delete of an existing tag is `editor`/`admin`-only via `tag.manage`.

### 11. Soft-delete rules
`deletedAt` timestamp only; excluded from all default reads with no override query param in Phase 2; restorable by owner or admin via a dedicated endpoint, no time limit; no hard-delete path exists anywhere in this phase's code.

### 12. Concurrency strategy
`Article.version` integer counter; client sends `expectedVersion` in every mutating request body; conditional update (`WHERE version = expectedVersion`) determines success; zero rows affected → `409 CONFLICT` with `currentVersion` in the response body.

### 13. Validation rules
Per Section 12's table exactly — title 5–200 chars, body 1–200,000 chars, excerpt max 500 chars, slug regex `^[a-z0-9]+(-[a-z0-9]+)*$` 3–150 chars, category must reference an existing non-deleted row, max 10 tags each 2–40 chars. DTOs are strict allow-lists (`whitelist: true, forbidNonWhitelisted: true`); disallowed fields (`status`, `primaryAuthorId`, `id`, `currentRevisionId`, target `version`, `createdAt`, `createdBy`) cause the entire request to fail with `400`, nothing partially applied.

### 14. Error semantics
`401` unauthenticated; `403` authenticated but role-permission entirely absent; **`404`** (not `403`) when the resource doesn't exist *or* exists but the caller has no visibility into it — this collapsing of the two cases is a deliberate, non-negotiable anti-IDOR measure; `400` validation/mass-assignment failures; `409 SLUG_CONFLICT` on explicit slug collision; `409 CONFLICT` (with `currentVersion`) on stale optimistic-concurrency version; `400 INVALID_REFERENCE` for a bad category/tag reference.

### 15. Testing requirements
Full suites per Section 16 (unit, integration, security) are mandatory, not optional, for phase completion — with particular emphasis on the IDOR 404-vs-403 assertions and the Phase-1-regression requirement (Section 16.4), which must be run and must pass unmodified.

### 16. Migration requirements
Purely additive migration; no alteration of any Phase 1 table; idempotent seed upserts for new permissions/role-grants; migration name follows the existing repo convention (inspect it first); ordering depends only on `User` already existing.

### 17. Acceptance criteria
Exactly the checklist in Section 20 — all items must be satisfied, including the explicit confirmation that no Phase 3+ concept has leaked into the implementation.

### 18. Explicit list of things Antigravity must NOT implement in Phase 2

- Any `status` value on `Article` other than `DRAFT`, or any code path capable of writing one
- A `WorkflowModule`, state machine, or any transition endpoint (`submit`, `approve`, `reject`, `publish`, `schedule`, `archive`) — even a stub
- `PublicationSchedule` table or any scheduling logic
- Any public, unauthenticated read endpoint for articles
- `Media` table, file upload handling, or a `coverMediaId` field on `Article` (Section 1.3) — deferred to Phase 4
- Search infrastructure beyond the small `q` substring-filter convenience explicitly scoped in Section 5.3 (no full-text index, no Elasticsearch/OpenSearch integration)
- `Comment` table or any comment functionality
- `Source`, `NewsItem`, `NewsIngestion`, `AIAnalysis` tables, or any AI-provider integration
- `Notification` table or notification dispatch logic
- Analytics/pageview tracking, admin dashboard aggregation endpoints
- CDN configuration or edge caching
- Redis-based caching of article data (Redis remains scoped to Phase 1's auth/rate-limiting use in this phase)
- A production-quality CMS frontend (Section 18 — at most an explicitly-labeled optional debug UI)
- Hard/permanent deletion of any article data
- Author-transfer (reassigning `primaryAuthorId` to a different user) functionality
- Any modification to Phase 1's `User`, `Role`, `Permission`, `RolePermission`, `UserRole`, or `RefreshSession` schemas, or to the authentication/token logic itself

---

*End of Phase 2 specification. No implementation code is included, per project constraints. Two decisions are explicitly flagged above for your confirmation before Antigravity proceeds: (1) the editor's exact edit/delete boundary (Section 4.4), and (2) the `currentRevisionId` naming choice (Section 1.4). Everything else in this document is a firm, implementation-ready recommendation.*
