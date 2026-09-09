# DailyStar — System Architecture & Implementation Specification

**Document type:** Architecture & Planning Specification (no implementation code)
**Audience:** Human engineering team + AI coding agent (Antigravity) implementing this repo phase by phase
**Status:** Draft v1.0

---

## 1. Executive Architecture Summary

DailyStar is a modern digital news portal combining a public-facing news site, an editorial CMS, and an AI-assisted newsroom pipeline — all built with a bias toward **simplicity a small student/developer team can actually ship**, while leaving deliberate seams for scaling later.

Core architectural decisions, at a glance:

- **Monolith-first, modular internally.** A single well-structured backend service (not microservices) with clear internal module boundaries (editorial, identity, media, search, AI, ingestion). Microservices are explicitly deferred — they solve organizational scaling problems this team doesn't have yet, and would add deployment/observability overhead disproportionate to the team size.
- **Decoupled frontend.** A separate frontend application talking to the backend over a versioned REST (or GraphQL, see trade-off below) API. This keeps the public site, CMS, and any future mobile client independent of backend internals.
- **Relational database as system of record.** PostgreSQL for all structured data (users, articles, revisions, workflow state, audit logs). Relational integrity matters enormously for an editorial audit trail; document databases are deferred to specific, justified use cases (e.g., raw ingested news payloads).
- **AI is a pipeline stage, not an actor.** Every AI-produced artifact (summary, category suggestion, duplicate flag) is stored as a *proposal* attached to content, never as a mutation of published state. Publication always requires a human transition.
- **Everything that changes editorial state is audited.** Article lifecycle transitions, role changes, and publishing actions write immutable audit log entries.
- **Background work is queue-based**, not inline in HTTP request/response cycles — ingestion, AI analysis, scheduled publishing, and notifications all run asynchronously.

This document specifies architecture and contracts only. No implementation code is included, per the project constraints.

---

## 2. Technology Stack (With Justification)

| Layer | Choice | Why | Rejected Alternatives (and why) |
|---|---|---|---|
| Frontend | **Next.js (React) + TypeScript** | Server-side rendering / static generation for SEO-critical public pages; same ecosystem serves both public site and CMS; huge community, easy for a student team to hire/learn into | Plain React SPA (poor SEO for news content without SSR); Vue/Nuxt (smaller ecosystem, no strong reason to prefer over React for this team); Angular (too heavyweight for team size) |
| Styling | **Tailwind CSS** | Fast, consistent, avoids CSS architecture debates for a small team | Styled-components (runtime cost), plain CSS (slower iteration) |
| Backend API | **Node.js + TypeScript (NestJS)** | Shares language with frontend (lowers cognitive load for small team), NestJS enforces modular structure (controllers/services/modules) which maps directly onto the domain boundaries this system needs (editorial, identity, AI, ingestion) | Django (great framework, but forces the team into Python when frontend is TS — two languages to maintain); Express alone (too unopinionated, team will reinvent structure poorly); Go (excellent for scale, but slower iteration speed for a student team and smaller ecosystem for CMS-style CRUD) |
| Database | **PostgreSQL** | Strong relational integrity for workflow/audit data, JSONB support covers the semi-structured needs (AI analysis payloads, raw ingested items) without a second database, mature, free, well-documented | MySQL (comparable, but Postgres's JSONB + full-text search reduce need for extra infra early on); MongoDB as primary store (would weaken integrity guarantees for RBAC/workflow, which is the highest-risk part of this system) |
| ORM / Migrations | **Prisma (or TypeORM) with SQL migration files** | Type-safe schema access from TypeScript backend, first-class migration tooling | Raw SQL only (higher velocity cost for a small team); Sequelize (weaker TS support) |
| Auth | **Custom JWT (access + refresh) issued by backend, argon2/bcrypt password hashing** | Full control over RBAC claims embedded in tokens; avoids vendor lock-in for a project with custom roles (author/editor/admin) | Third-party auth-as-a-service (Auth0/Clerk) — viable Phase-2 upgrade, but adds cost/vendor dependency the MVP doesn't need; session-cookie-only auth (harder to scale across future separate frontend/mobile clients) |
| Cache | **Redis** | De facto standard for cache + queue backing + rate limiting; one piece of infra serving three needs | Memcached (no pub/sub, no queue support) |
| Background jobs / queue | **BullMQ (Redis-backed)** | Same Redis instance already in the stack; simple job/queue API that matches Node/TS backend | RabbitMQ/Kafka (real message brokers, correct *future* choice at higher ingestion volume — deferred, see Future section) |
| Search | **PostgreSQL full-text search (MVP) → OpenSearch/Elasticsearch (Phase 2+)** | Postgres FTS is "good enough" for MVP article search with zero extra infrastructure; defer a dedicated search engine until content volume or search UX (facets, relevance tuning, fuzzy matching) demands it | Elasticsearch from day one (real operational burden — cluster ops, mapping design — unjustified at MVP scale) |
| Media storage | **S3-compatible object storage (AWS S3 or MinIO for local/dev)** | Standard, cheap, decouples media from app servers, works identically in dev (MinIO) and prod (S3) | Storing files on local disk/DB blobs (doesn't survive redeploys/scale-out) |
| AI provider | **Anthropic Claude API (Messages API), provider-abstracted behind an internal `AIService` interface** | Strong summarization/classification quality; abstraction layer means the provider can be swapped without touching editorial workflow code | Hardcoding a single vendor SDK throughout the codebase (creates lock-in and makes testing harder) |
| Observability | **Structured logging (pino/winston) + OpenTelemetry traces + Sentry for error tracking** | Minimum viable observability stack that scales from "one developer reading logs" to "production incident response" without a rewrite | Building custom logging/metrics (wasted effort vs. mature OSS tools) |
| CI/CD | **GitHub Actions** | Free for small/student teams, tight integration with the GitHub-hosted repo, sufficient for lint/test/build/deploy pipelines | Jenkins (unnecessary ops overhead for this team size) |
| Hosting (MVP) | **Single managed platform (e.g., Railway/Render/Fly.io) for backend + managed Postgres + managed Redis; Vercel for the Next.js frontend** | Minimizes DevOps burden so the team can focus on the product; both scale into containers/Kubernetes later without an architecture rewrite because the app is already 12-factor (env-config, stateless processes) | Self-managed Kubernetes from day one (large ops burden with no present payoff) |

**Guiding principle used throughout:** every "advanced" technology (Elasticsearch, Kafka, microservices, Kubernetes) is named explicitly as a **Future** upgrade path with a concrete trigger condition, not as a Phase-1 dependency. This avoids over-engineering while proving the architecture doesn't box the team in.

---

## 3. System Architecture Overview

### 3.1 High-level component diagram (textual)

```
                        ┌───────────────────────┐
                        │      Public Users       │
                        └────────────┬────────────┘
                                     │ HTTPS
                        ┌────────────▼────────────┐
                        │   Next.js Public Site     │  (SSR/SSG, SEO pages)
                        └────────────┬────────────┘
                                     │ REST/GraphQL (versioned, HTTPS)
┌───────────────┐        ┌──────────▼───────────┐        ┌────────────────────┐
│  Editorial CMS │◄──────►│   Backend API (NestJS) │◄──────►│  PostgreSQL (RDS)   │
│  (Next.js app) │        │  - Auth module         │        └────────────────────┘
└───────────────┘        │  - Articles module      │        ┌────────────────────┐
                          │  - Workflow module      │◄──────►│  Redis (cache/queue) │
                          │  - Media module         │        └────────────────────┘
                          │  - Search module        │        ┌────────────────────┐
                          │  - AI module            │◄──────►│  Object Storage (S3)│
                          │  - Ingestion module      │        └────────────────────┘
                          │  - Notifications module │        ┌────────────────────┐
                          └──────────┬───────────┘        │  Claude API (external)│
                                     │                        └────────────────────┘
                          ┌──────────▼───────────┐
                          │   Background Workers    │
                          │  (BullMQ consumers)     │
                          │  - ingestion jobs        │
                          │  - AI analysis jobs      │
                          │  - publish-scheduler     │
                          │  - notification dispatch │
                          └────────────────────────┘
```

### 3.2 Frontend architecture

Two separate Next.js applications (or one app with two route groups, see trade-off below) sharing a common component/design-system package:

- **Public site** — reads published content only, via public read endpoints. SSR/ISR (incremental static regeneration) for article pages to satisfy SEO and load-time requirements. No direct database access, ever — always through the API.
- **Editorial CMS** — authenticated app for authors/editors/admins. Client-heavily-rendered (CSR) since it's behind auth and SEO doesn't apply; talks to the same backend API using authenticated requests.

**Trade-off — one Next.js app vs two:**
- *One app, two route groups* (`/`, `/cms/*`) is simpler to deploy and share code, recommended for MVP.
- *Two separate apps* gives cleaner deploy/scaling isolation (public traffic spikes won't affect CMS availability) — recommended once public traffic volume justifies independent scaling (Phase 2+).

Frontend never contains business logic (approval rules, publishing rules, RBAC decisions) — it only reflects state and calls API endpoints that enforce those rules server-side. This directly satisfies the "avoid tightly coupling frontend to business logic" constraint.

### 3.3 Backend/API architecture

NestJS modular monolith. Each domain is a **module** with its own controller, service, and data-access layer (repository pattern over Prisma/TypeORM):

- `AuthModule` — login, refresh, password reset, session/token issuance
- `UsersModule` — user + author profile management
- `RBACModule` — role/permission definitions and guards
- `ArticlesModule` — article CRUD, revisions
- `WorkflowModule` — lifecycle state machine, transition validation
- `CategoriesTagsModule`
- `MediaModule` — upload orchestration, signed URLs to object storage
- `SearchModule` — query interface, abstracts Postgres FTS today / Elasticsearch later
- `SchedulingModule` — scheduled publish jobs
- `AIModule` — provider-abstracted AI calls (summarization, classification, embeddings for dedup)
- `IngestionModule` — source management, fetch/normalize pipeline
- `NotificationsModule`
- `AuditModule` — write-only audit log service, called by other modules, never bypassed
- `AdminModule` — dashboard aggregation endpoints

**API style:** versioned REST (`/api/v1/...`) is recommended over GraphQL for MVP — the domain is CRUD + workflow-transition shaped, which REST expresses cleanly with clear per-resource semantics (POST /articles/:id/submit-for-review), and it keeps the learning curve lower for a student team. GraphQL is a legitimate Phase-2+ option if the frontend needs highly flexible querying (e.g., a complex admin dashboard) — noted as a trade-off, not a rejection.

Each module exposes a service layer that is the *only* way to mutate state — controllers never touch the database directly. This is what keeps business logic out of the frontend and out of stray controller code.

### 3.4 Database architecture

Single PostgreSQL instance for MVP (with read replica added in Phase 2 for read-heavy public traffic). Schema is normalized for integrity around users/roles/articles/workflow; JSONB columns used narrowly for genuinely semi-structured data (raw ingested payloads, AI analysis results) rather than as a way to avoid schema design.

Key design principles:
- Every workflow-relevant table has `created_at`, `updated_at`, and where relevant `created_by`/`updated_by`.
- Soft-delete (`deleted_at`) on Article and Media rather than hard delete, to preserve auditability.
- Foreign keys enforced at the DB level, not just application level — this is a newsroom system; referential integrity failures are unacceptable (e.g., an ArticleRevision must never outlive its Article).
- Full entity/relationship detail is in Section 4 (Database Architecture) below.

### 3.5 Authentication architecture

- Credentials: email + password, hashed with **argon2id** (bcrypt acceptable fallback).
- Tokens: short-lived **JWT access token** (15 min) + long-lived **refresh token** (7–30 days), refresh token stored server-side (hashed) so it can be revoked (logout-everywhere, compromised-account response).
- Access token carries minimal claims: `sub` (user id), `roles`, `tokenVersion`. Permissions are *not* embedded — they're derived server-side from roles at request time, so permission changes take effect without waiting for token expiry (checked against `tokenVersion`/role lookup, not baked into a stale JWT).
- Password reset via time-limited signed token emailed to the user; no security questions.
- Rate limiting on login/reset endpoints (Redis-backed) to blunt brute-force attempts.
- MFA (TOTP) is explicitly **Phase 2** — noted as a requirement for admin/editor accounts once the platform has real editorial power at stake, not required to ship MVP.

### 3.6 Authorization / RBAC model

Role-based, with permissions as the underlying primitive so roles stay adjustable without code changes:

- **Role** — named bundle (e.g., `author`, `editor`, `admin`, `reader`)
- **Permission** — atomic capability (e.g., `article:create`, `article:submit_review`, `article:approve`, `article:publish`, `article:archive`, `user:manage`, `source:manage`)
- **RolePermission** — join table
- **UserRole** — join table (a user can hold more than one role, e.g., `author` + `editor` during a transition period)

Enforcement happens via a NestJS **Guard** on every mutating endpoint, checking the resolved permission set for the authenticated user — never via frontend-only checks (frontend hides UI for UX only; the backend is the actual gate). Ownership-based rules (e.g., "authors can edit their own drafts, not others'") are enforced as an additional service-layer check beyond role permission (row-level authorization), since pure RBAC can't express "your own content only."

---

## 4. Database Architecture — Entities & Relationships

### 4.1 Entity summary

| Entity | Purpose |
|---|---|
| `User` | Login identity for anyone with an account (authors, editors, admins) |
| `Role` | Named permission bundle |
| `Permission` | Atomic capability |
| `RolePermission` | Role ↔ Permission join |
| `UserRole` | User ↔ Role join |
| `AuthorProfile` | Public-facing author info (bio, avatar, byline) — separate from `User` so private account data never leaks into public author pages |
| `Article` | The canonical article record; holds current lifecycle state and pointer to current published revision |
| `ArticleRevision` | Immutable snapshot of article content at a point in time |
| `Category` | Hierarchical section (e.g., Politics > Elections) |
| `Tag` | Free-form label |
| `ArticleTag` | Article ↔ Tag join |
| `Media` | Uploaded file metadata (image/video), pointer to object storage key |
| `Comment` | Reader comment on a published article |
| `Source` | External news source definition (RSS feed, API, etc.) |
| `NewsItem` | Raw ingested item from a `Source`, pre-normalization |
| `NewsIngestion` | Run/batch record of an ingestion job (for auditability of the pipeline itself) |
| `AIAnalysis` | AI-generated proposal data (summary, category suggestion, dedup score) attached to a `NewsItem` or `Article`, always in a proposal state until a human acts on it |
| `PublicationSchedule` | Scheduled-publish record: article + target datetime + status |
| `AuditLog` | Immutable record of every state-changing action across the system |
| `Notification` | In-app/email notification record for a user |

### 4.2 Relationships (textual ER)

```
User 1───* UserRole *───1 Role 1───* RolePermission *───1 Permission
User 1───1 AuthorProfile
User 1───* Article            (as primary author)
User 1───* ArticleRevision    (as revision author)
User 1───* AuditLog           (as actor)
User 1───* Notification       (as recipient)

Article 1───* ArticleRevision
Article *───1 ArticleRevision  (currentPublishedRevisionId, nullable until first publish)
Article *───1 Category
Article 1───* ArticleTag *───1 Tag
Article 1───* Comment
Article 1───* Media            (via ArticleRevision content references, plus a coverImage FK)
Article 1───0..1 PublicationSchedule
Article 1───* AIAnalysis       (proposals attached to this article, e.g. AI-suggested category)

Category 1───* Category        (self-referential parent/child for hierarchy)

Source 1───* NewsItem
Source 1───* NewsIngestion
NewsItem 1───0..1 AIAnalysis    (classification/summarization/dedup proposal)
NewsItem *───0..1 Article       (nullable — set once an editor turns a NewsItem into a draft Article)
NewsIngestion 1───* NewsItem    (items produced by that run)

AuditLog *───1 User (nullable, for system actions)
AuditLog *───0..1 Article (polymorphic-ish: entity_type + entity_id, see note below)
```

**Note on AuditLog:** modeled as a generic table (`entity_type`, `entity_id`, `action`, `actor_id`, `before_state` JSONB, `after_state` JSONB, `created_at`) rather than one FK per entity type, since it must cover articles, users, sources, and schedules uniformly without schema churn every time a new auditable entity is added.

### 4.3 Key field notes (selected entities, not exhaustive column lists)

- **Article**: `id, slug, title, current_status (enum), category_id, primary_author_id, current_published_revision_id (nullable FK), created_at, updated_at, deleted_at (nullable)`. The `slug` is unique and immutable once published, for stable SEO URLs.
- **ArticleRevision**: `id, article_id, author_id, title, body (rich content — stored as structured JSON/MD, not raw HTML, to avoid persisted XSS vectors), excerpt, cover_media_id, status_at_creation, created_at`. Revisions are append-only; nothing is ever mutated in place, which is what makes the audit trail trustworthy.
- **AIAnalysis**: `id, subject_type (enum: news_item/article), subject_id, analysis_type (enum: summary/classification/dedup/entity_extraction), payload (JSONB), confidence_score, model_used, status (enum: proposed/accepted/rejected), reviewed_by (nullable FK), reviewed_at (nullable), created_at`. The `status` field is the technical enforcement of "AI proposes, humans dispose."
- **PublicationSchedule**: `id, article_id, scheduled_for (timestamptz), status (enum: pending/executed/cancelled/failed), created_by, executed_at (nullable), failure_reason (nullable)`.

### 4.4 MVP vs Phase 2 vs Future — entity rollout

**MVP (must exist for first working version):**
`User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `AuthorProfile`, `Article`, `ArticleRevision`, `Category`, `Tag`, `ArticleTag`, `Media`, `AuditLog`. This is enough to run a full manual editorial CMS with no AI and no ingestion: draft → review → approve → publish, by humans, fully audited.

**Phase 2 (added once MVP is stable):**
`Comment` (reader engagement), `PublicationSchedule` (scheduled publishing), `Notification`, `Source`, `NewsItem`, `NewsIngestion`, `AIAnalysis` (the full AI newsroom pipeline arrives here as one coherent slice, not scattered across phases, because it's genuinely one feature with mutual dependencies).

**Future (only when the platform needs it):**
- Table partitioning on `AuditLog` and `ArticleRevision` by date, once volume warrants it.
- A separate `SearchIndex`/materialized-view layer once migrating off Postgres FTS to Elasticsearch.
- `CommentModeration` sub-entities (flags, moderation queue) once comment volume requires structured moderation rather than manual review.
- Multi-tenancy fields (`organization_id`) if DailyStar ever needs to support multiple newsroom brands on one deployment — deliberately *not* designed in from day one, since speculative multi-tenancy is a classic over-engineering trap for a single-newsroom product.

---

## 5. Editorial Architecture — Article Lifecycle

### 5.1 State machine

```
DRAFT ──submit──► SUBMITTED_FOR_REVIEW ──start review──► UNDER_REVIEW
                                                             │
                                    ┌────────────────────────┼───────────────────┐
                                    ▼                        ▼                   ▼
                              request changes            approve             reject
                                    │                        │                   │
                                    ▼                        ▼                   ▼
                                  DRAFT                  APPROVED            DRAFT
                                                             │
                                          ┌──────────────────┼───────────────────┐
                                          ▼                                      ▼
                                  publish now                          schedule publish
                                          │                                      │
                                          ▼                                      ▼
                                     PUBLISHED ◄───────── scheduler fires ── SCHEDULED
                                          │
                                update (new revision) ──► PUBLISHED (new current revision)
                                          │
                                       archive
                                          ▼
                                     ARCHIVED
```

### 5.2 Transition table

| From → To | Who can perform it | Validation | Notes |
|---|---|---|---|
| (new) → `DRAFT` | `author`, `editor`, `admin` | Title + non-empty body required | Creates `Article` + first `ArticleRevision` |
| `DRAFT` → `SUBMITTED_FOR_REVIEW` | Owning author, `editor`, `admin` | Title, body, category all set; at least one revision exists | Writes AuditLog entry; notifies editors |
| `SUBMITTED_FOR_REVIEW` → `UNDER_REVIEW` | `editor`, `admin` | Reviewer must not be the article's sole author (four-eyes principle) unless the account holds `editor` role explicitly for the owning author's team | Assigns `reviewer_id`; notifies author |
| `UNDER_REVIEW` → `DRAFT` (changes requested) | `editor`, `admin` | Requires a non-empty review comment | Article returns to author; does not create a new revision by itself |
| `UNDER_REVIEW` → `APPROVED` | `editor`, `admin` | Reviewer ≠ author (enforced) | Locks the specific `ArticleRevision` being approved as `current_published_revision_id` candidate |
| `UNDER_REVIEW` → `DRAFT` (rejected) | `editor`, `admin` | Requires rejection reason | |
| `APPROVED` → `PUBLISHED` | `editor`, `admin` | Slug uniqueness check; SEO metadata present | Sets `published_at`; writes AuditLog; triggers cache invalidation + search index update |
| `APPROVED` → `SCHEDULED` | `editor`, `admin` | `scheduled_for` must be in the future | Creates `PublicationSchedule` row; a queue job is enqueued with a delay/cron check |
| `SCHEDULED` → `PUBLISHED` | System (scheduler worker), no human in the loop for the *timing*, but the *content* was already human-approved | Re-validates article is still `APPROVED` state and slug still unique at execution time | If validation fails at execution time, transitions to `FAILED_TO_PUBLISH` and notifies editors — **never silently drops a scheduled publish** |
| `SCHEDULED` → `APPROVED` (cancel) | `editor`, `admin` | | Cancels the `PublicationSchedule` row |
| `PUBLISHED` → `PUBLISHED` (update) | Owning author (creates new revision, goes back through review) or `editor`/`admin` (direct minor edit, policy-configurable) | New `ArticleRevision` created; `current_published_revision_id` only updates after this new revision is itself approved (or immediately, for admin trusted-edit configuration — this policy choice should be made explicitly by the team, not implicit) | Every update to published content is itself auditable and revisioned — a news correction history is a real editorial requirement |
| `PUBLISHED` → `ARCHIVED` | `editor`, `admin` | | Soft-delete semantics; article remains queryable by direct URL (or 410 Gone, per SEO policy) but drops from listings/search |

### 5.3 Cross-cutting rules

- **Every transition writes an `AuditLog` row** with actor, from-state, to-state, timestamp, and any reviewer comment. This is not optional and is enforced at the service layer (the `WorkflowModule` is the only code path allowed to mutate `Article.current_status`).
- **Revision handling:** a revision is never edited in place. "Editing a draft" means creating a new `ArticleRevision` row; the `Article.current_status` and pointers update, but history is preserved permanently. This gives editors a real diff/history view for free.
- **Authorization is checked twice:** role/permission (can this *type* of user ever do this transition) and ownership/assignment (can *this specific* user do it to *this specific* article — e.g., a reviewer can't approve their own submission).
- **Failure cases** are first-class, not exceptions to handle later: a scheduled publish that fails validation becomes an explicit `FAILED_TO_PUBLISH` status with a notification to editors, not a silently-skipped cron tick. A concurrent-edit conflict (two people editing the same draft) is detected via an `updated_at`/version check and surfaced as a conflict response, not a silent overwrite.

---

## 6. AI Newsroom Architecture

### 6.1 Pipeline

```
News Sources ──► Ingestion ──► Normalization ──► Deduplication ──► Classification
                                                                          │
                                                                          ▼
                                                                  Summarization
                                                                          │
                                                                          ▼
                                                                Metadata Extraction
                                                                          │
                                                                          ▼
                                                              Editorial Review Queue
                                                                          │
                                                                          ▼
                                                                Human Approval
                                                                          │
                                                                          ▼
                                                            (becomes normal Article,
                                                             re-enters the standard
                                                             editorial lifecycle above)
```

### 6.2 Stage-by-stage design

1. **Ingestion** — scheduled background jobs (per `Source`, e.g., every N minutes) fetch raw content (RSS/API/scraper, depending on source type) and write immutable `NewsItem` rows plus a `NewsIngestion` run record. Ingestion failures are logged and retried with backoff; a source that fails repeatedly is flagged for admin attention, never silently disabled.
2. **Normalization** — raw source-specific formats (RSS XML, API JSON, etc.) are mapped into a common `NewsItem` shape (title, body, source URL, published_at, source metadata) by source-type-specific adapters. This isolates source quirks from the rest of the pipeline.
3. **Deduplication** — see Section 6.3 below.
4. **Classification** — AI call proposes a `Category` and tag suggestions for the `NewsItem`, written as an `AIAnalysis` row with `status = proposed`. Never auto-applied to a live `Article`.
5. **Summarization** — AI call proposes a short summary/excerpt, again as a `proposed` `AIAnalysis` row.
6. **Metadata extraction** — AI call proposes entities (people, places, organizations mentioned), used later for SEO/related-articles features; also a `proposed` `AIAnalysis` row.
7. **Editorial review queue** — a dedicated CMS view lists `NewsItem`s with their attached `AIAnalysis` proposals, ranked by recency and dedup-cluster. An editor/author reviews the raw source item plus AI proposals side-by-side.
8. **Human approval** — the human either (a) discards the item, (b) accepts it as-is (which creates a new `Article` in `DRAFT` state pre-filled from the accepted proposals, marked with provenance `source_news_item_id`), or (c) edits before accepting. Acceptance also flips the relevant `AIAnalysis.status` to `accepted` (or `rejected` for discarded proposals) — this acceptance/rejection log is itself valuable training/quality-tracking data over time.
9. From this point on, the resulting `Article` follows the **exact same lifecycle** as a human-authored article (Section 5) — there is no separate "AI article" path to publication. This is the concrete mechanism by which "AI-generated content is never published automatically" is enforced architecturally, not just by policy: an `Article` row cannot reach `PUBLISHED` without passing through `APPROVED`, and nothing in the ingestion pipeline is permitted to write directly to `Article` — only to `NewsItem` + `AIAnalysis`, which a human must explicitly convert.

### 6.3 Duplicate / similarity detection strategy

**MVP approach — cheap and explainable:**
- Normalize title + first paragraph, compute a **shingled hash / SimHash** or simple TF-IDF cosine similarity against recent `NewsItem`s (last 48–72 hours, same/related category) computed in the ingestion worker itself, no external ML infra required.
- Items above a similarity threshold are clustered (`AIAnalysis` of type `dedup` storing `related_news_item_ids` + score) and surfaced together in the review queue rather than being hidden — **editors see all near-duplicates and choose**, the system never silently discards a source item, because two "duplicate" articles occasionally have real editorial differences (different angle, updated facts).

**Phase 2 — embeddings-based:**
- Generate vector embeddings per `NewsItem` (via the AI provider or a local embedding model) and store in a vector column (`pgvector` extension keeps this inside Postgres — no new database needed) for nearest-neighbor similarity search, which is materially better than TF-IDF for near-duplicate stories phrased differently across outlets.

**Future:**
- A dedicated vector database (e.g., Pinecone/Weaviate/Qdrant) only if `pgvector` query latency becomes a bottleneck at high ingestion volume — not before.

### 6.4 Where humans must remain in control (explicit boundary list)

- Only a human transition (`APPROVED → PUBLISHED` or `APPROVED → SCHEDULED`, per the workflow state machine) can make content public. No AI-triggered code path exists that writes `Article.current_status = PUBLISHED`.
- AI never edits an existing `ArticleRevision`. It can only produce a *new proposal* attached via `AIAnalysis`.
- Category/tag suggestions are suggestions — the classification UI presents them as pre-fills the editor must confirm or change, not auto-applied metadata.
- Deduplication clusters items for review; it never auto-discards a source item without a human decision.
- All AI outputs carry provenance (`model_used`, `created_at`, `analysis_type`) so an editor can always see "this was AI-suggested" versus human-authored, both in the CMS UI and in the audit trail.
- Source management (adding/disabling a news `Source`) is an explicit admin action — the ingestion pipeline never adds new sources on its own initiative.

---

## 7. Search and Caching Architecture

### 7.1 Search

- **MVP:** PostgreSQL full-text search (`tsvector`/`tsquery`) on `title`, `excerpt`, and `body` of published articles, with a GIN index. Exposed behind a `SearchModule` service interface (`search(query, filters): SearchResult[]`) so the implementation is swappable without touching callers.
- **Phase 2+:** Elasticsearch/OpenSearch once the team needs faceted search (by category/tag/date), typo tolerance, or relevance tuning beyond what Postgres FTS reasonably offers. The `SearchModule` interface doesn't change — only its implementation and an added indexing pipeline (articles publish → event → index writer).
- Search only ever queries **published** content for public users; the CMS has a separate, permission-scoped search over drafts/pending content.

### 7.2 Caching

- **Redis** as the shared cache layer:
  - Rendered/serialized public article pages (or their API responses) cached with a short TTL, explicitly invalidated on publish/update/archive transitions (event-driven invalidation, not just TTL expiry, to avoid stale news content).
  - Category/tag listing pages cached similarly.
  - Rate-limit counters (login attempts, API abuse protection) also live in Redis.
- **CDN** (e.g., CloudFront/Cloudflare) in front of the public Next.js site for static assets and, where using ISR, cached HTML pages — this is the primary defense against traffic spikes on breaking news, and is a Phase-2 addition once the MVP is functionally complete.
- Caching is explicitly **not** applied to CMS/authenticated views — editorial staff must always see current, uncached state.

---

## 8. Security Architecture

- **Transport:** HTTPS everywhere, HSTS enabled, no mixed content.
- **AuthN/AuthZ:** as specified in Sections 3.5–3.6 — JWT + refresh tokens, server-side permission resolution, ownership checks at the service layer.
- **Input validation:** DTO-level validation (class-validator or zod) on every API endpoint; reject unknown fields.
- **Content sanitization:** article body stored as structured content (not raw HTML) specifically to prevent stored XSS; if rich-text HTML must be supported, it is sanitized server-side with an allowlist (e.g., DOMPurify server-side or equivalent) before storage, and again before render, defense-in-depth.
- **File upload safety:** media uploads validated by MIME type + magic-byte sniffing (not just extension), size-limited, stored in object storage with randomized keys (not user-controlled filenames), served from a separate asset domain/CDN to avoid same-origin script execution risk from uploaded files.
- **Secrets management:** environment variables via the hosting platform's secret manager; never committed to the repo; `.env.example` only in source control.
- **SQL injection:** mitigated structurally by using an ORM/parameterized queries exclusively — no raw string-concatenated SQL.
- **CSRF:** since the API is token-based (Authorization header, not cookies, for the CMS), CSRF risk is naturally reduced; if cookies are used for refresh tokens, `SameSite=Strict` + CSRF tokens on state-changing requests.
- **Rate limiting & abuse protection:** Redis-backed rate limits on auth endpoints, comment submission, and public API endpoints.
- **Audit logging** (Section 4) doubles as a security control — any privilege escalation or suspicious bulk-publish activity is traceable to an actor and timestamp.
- **Dependency hygiene:** automated dependency vulnerability scanning (e.g., `npm audit` / Dependabot) wired into CI.
- **Least privilege for AI:** the AI provider integration only ever receives content it needs for the specific analysis call (e.g., article text for summarization) — no blanket database access, no ability to call back into the system's mutating endpoints. The `AIModule` is a one-way consumer of content and producer of proposals.

---

## 9. Testing Architecture

| Layer | Approach | Tooling (indicative) |
|---|---|---|
| Unit tests | Service-layer business logic (workflow transitions, RBAC resolution, dedup scoring) tested in isolation with mocked repositories | Jest |
| Integration tests | API endpoints tested against a real (test) database, verifying the full request → service → DB round trip, including permission denial paths | Jest + Supertest + a disposable test Postgres (Docker) |
| Workflow/state-machine tests | Explicit test matrix covering every legal transition in Section 5.2 **and** every illegal transition (e.g., `author` attempting to approve their own article must fail) | Jest |
| Frontend component tests | Component-level rendering/interaction tests for CMS and public site components | React Testing Library |
| End-to-end tests | Critical user journeys: login → draft → submit → review → approve → publish → visible on public site; scheduled publish firing correctly | Playwright |
| AI pipeline tests | Deterministic tests using mocked AI provider responses (never calling the real API in CI) to verify proposals are stored correctly and never auto-published | Jest with provider mock |
| Load/perf testing | Public read-path load testing before major launches (Phase 2+) | k6 or similar |

**Non-negotiable rule for the coding agent:** any change to the `WorkflowModule` (Section 5) or `RBACModule` (Section 3.6) must include corresponding test updates in the same change — these are the highest-risk modules in the system.

---

## 10. Deployment Architecture

- **MVP:** two deployable units — (1) Next.js frontend(s) on a static/edge-hosting platform (Vercel or equivalent), (2) NestJS backend + BullMQ workers as a containerized service on a managed platform (Railway/Render/Fly.io), with managed Postgres and managed Redis add-ons. Workers can run as a separate process/container from the API from day one (even if deployed together initially) so they can be scaled independently later without a refactor.
- **Environments:** `local` (Docker Compose: Postgres, Redis, MinIO) → `staging` → `production`, with environment-specific config via env vars, never hardcoded.
- **Migrations:** run as an explicit CI/CD pipeline step before the new backend version receives traffic (never run implicitly on app boot in production).
- **Future:** containers move to Kubernetes (or stay on a managed container platform, both viable) once the team needs multi-region deployment, blue/green at scale, or more granular autoscaling than the managed platform offers. Because the backend is already stateless/12-factor from MVP, this move is an infrastructure change, not an application rewrite.

### Backup & disaster recovery
- Automated daily Postgres backups (via managed provider) with point-in-time recovery enabled once available on the plan tier; backup restoration tested periodically (a backup that's never been restored is not a verified backup).
- Object storage (S3) versioning enabled on the media bucket to protect against accidental overwrite/delete.
- `AuditLog` and `ArticleRevision` being append-only means even a partial data-corruption incident is forensically reconstructable.
- RTO/RPO targets should be defined explicitly by the team once the platform has real users — flagged here as a decision the team must make, not assumed.

### Scalability strategy
- **Read scaling:** Postgres read replica for public-site read traffic once the primary is under read pressure (Phase 2 trigger: p95 read latency degradation, not a fixed date).
- **Horizontal scaling:** backend API and workers are stateless (no in-process session state — JWTs + Redis handle that), so horizontal scaling is a matter of running more container instances behind a load balancer, no architecture change needed.
- **Ingestion scaling:** move from BullMQ/Redis to Kafka/RabbitMQ only if ingestion volume (number of sources × frequency) exceeds what a single Redis-backed queue comfortably handles — a concrete, measurable trigger rather than a speculative one.
- **Search scaling:** Postgres FTS → Elasticsearch, per Section 7.1.
- **Caching/CDN:** as content and traffic grow, push more of the public read path to edge caching (Section 7.2), reducing origin load without backend changes.

---

## 11. Complete Folder Structure

```
dailystar/
├── apps/
│   ├── web/                          # Public Next.js site (+ CMS route group, or split later)
│   │   ├── app/
│   │   │   ├── (public)/             # Public routes: /, /article/[slug], /category/[slug]
│   │   │   ├── (cms)/                # Authenticated editorial routes: /cms/*
│   │   │   └── api/                  # (only if using Next.js route handlers for BFF needs)
│   │   ├── components/               # Shared UI components
│   │   │   ├── public/
│   │   │   └── cms/
│   │   ├── lib/                      # API client, hooks — NO business logic here
│   │   ├── styles/
│   │   └── tests/
│   │
│   └── api/                          # NestJS backend
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   │   ├── auth.controller.ts
│       │   │   │   ├── auth.service.ts
│       │   │   │   ├── strategies/           # JWT strategy, refresh strategy
│       │   │   │   └── dto/
│       │   │   ├── users/
│       │   │   ├── rbac/
│       │   │   │   ├── guards/               # PermissionGuard, OwnershipGuard
│       │   │   │   └── decorators/           # @RequirePermission(...)
│       │   │   ├── articles/
│       │   │   │   ├── articles.controller.ts
│       │   │   │   ├── articles.service.ts
│       │   │   │   ├── revisions.service.ts
│       │   │   │   └── dto/
│       │   │   ├── workflow/
│       │   │   │   ├── workflow.service.ts    # the ONLY place status transitions happen
│       │   │   │   ├── workflow.state-machine.ts
│       │   │   │   └── workflow.rules.ts
│       │   │   ├── categories-tags/
│       │   │   ├── media/
│       │   │   │   ├── media.controller.ts
│       │   │   │   ├── media.service.ts
│       │   │   │   └── storage.provider.ts    # abstracts S3/MinIO
│       │   │   ├── search/
│       │   │   │   ├── search.service.ts
│       │   │   │   └── providers/             # postgres-fts.provider.ts, elasticsearch.provider.ts (future)
│       │   │   ├── scheduling/
│       │   │   │   ├── scheduling.service.ts
│       │   │   │   └── scheduling.processor.ts # BullMQ worker
│       │   │   ├── ai/
│       │   │   │   ├── ai.service.ts           # provider-agnostic interface
│       │   │   │   ├── providers/
│       │   │   │   │   └── claude.provider.ts
│       │   │   │   ├── summarization.service.ts
│       │   │   │   ├── classification.service.ts
│       │   │   │   └── dedup.service.ts
│       │   │   ├── ingestion/
│       │   │   │   ├── sources/
│       │   │   │   │   ├── rss.adapter.ts
│       │   │   │   │   └── api.adapter.ts
│       │   │   │   ├── ingestion.service.ts
│       │   │   │   ├── normalization.service.ts
│       │   │   │   └── ingestion.processor.ts  # BullMQ worker
│       │   │   ├── notifications/
│       │   │   ├── audit/
│       │   │   │   └── audit.service.ts        # write-only, called by other modules
│       │   │   └── admin/
│       │   │       └── dashboard.controller.ts
│       │   │
│       │   ├── common/                         # cross-cutting: filters, interceptors, pipes
│       │   ├── config/                         # env schema/validation, typed config
│       │   ├── database/
│       │   │   ├── prisma/ (or typeorm/)
│       │   │   │   ├── schema.prisma
│       │   │   │   └── migrations/
│       │   │   └── seeds/
│       │   └── main.ts
│       └── test/
│           ├── unit/
│           ├── integration/
│           └── e2e/
│
├── packages/                          # shared code between apps
│   ├── ui/                            # shared design-system components
│   ├── types/                         # shared TypeScript types/DTOs (frontend ↔ backend contract)
│   └── config/                        # shared eslint/tsconfig
│
├── infrastructure/
│   ├── docker/
│   │   ├── docker-compose.local.yml   # postgres, redis, minio for local dev
│   │   └── Dockerfile.api
│   ├── ci/                            # GitHub Actions workflow definitions
│   └── terraform/ (future)            # IaC once infra grows beyond a managed-platform config UI
│
├── docs/
│   ├── architecture/                  # this document and related ADRs
│   └── runbooks/                      # ops runbooks (future)
│
├── .env.example
├── package.json                       # workspace root (pnpm/yarn workspaces or turborepo)
└── README.md
```

**Separation of concerns achieved by this layout:**
- UI (`apps/web/components`, `packages/ui`) never imports database or AI provider code.
- Business logic lives only in `apps/api/src/modules/*/**.service.ts` — controllers are thin.
- Data access is isolated behind Prisma/TypeORM in `apps/api/src/database`, referenced only through services, never from controllers directly.
- Auth/RBAC is a cross-cutting module (`auth/`, `rbac/`) applied via guards/decorators, not duplicated per-module.
- Background jobs (`*.processor.ts` files) are clearly separated from request-handling services, even when co-located in the same module for cohesion.
- AI services (`ai/`) are provider-abstracted and isolated from the ingestion/editorial logic that consumes their output.
- Infrastructure (`infrastructure/`) and tests (`test/`, `apps/web/tests`) are never mixed into feature module folders.

---

## 12. MVP vs Phase 2 vs Future — Feature Rollout Summary

| | MVP | Phase 2 | Future |
|---|---|---|---|
| Editorial | Draft/review/approve/publish (manual), revisions, categories/tags | Scheduled publishing, comments | — |
| Auth | Email/password, JWT + refresh, RBAC | MFA (TOTP) for editor/admin | SSO/OAuth for enterprise partners |
| Media | Upload to object storage, basic image handling | Image transforms/CDN optimization | Video transcoding pipeline |
| Search | Postgres full-text search | Elasticsearch/OpenSearch, faceted search | Personalized/semantic search |
| Caching | Minimal (Redis for auth/rate-limit only) | Redis page caching, CDN | Edge-computed personalization |
| AI | — (none in MVP, by design) | Full ingestion → dedup → classify → summarize → review pipeline | Multi-model routing, auto-suggested related articles, AI-assisted SEO copy |
| Ingestion | — | Source management, RSS/API ingestion | Web-scraping adapters, multi-language sources |
| Notifications | — | In-app + email notifications | Push notifications, digest emails |
| Analytics | Basic pageview logging | Editorial dashboard (top articles, author performance) | Real-time analytics, A/B testing framework |
| Observability | Structured logs + error tracking | Distributed tracing, dashboards | Full SLO/alerting program |
| Infra | Single-region managed platform | Read replica, CDN, worker autoscaling | Multi-region, Kubernetes, message broker (Kafka/RabbitMQ) |

**Rationale for AI/ingestion landing entirely in Phase 2:** it is architecturally coherent to build and validate the human editorial workflow first (Section 5) — because the AI newsroom pipeline (Section 6) is *defined in terms of* that workflow (an accepted AI proposal becomes a normal `Article` in `DRAFT`). Building AI ingestion before the editorial workflow exists would mean building it against a moving target.

---

## 13. Phased Implementation Roadmap

Each phase is scoped to be safely implementable by an AI coding agent in one pass, with explicit dependencies, database changes, and acceptance criteria. Phases are intentionally small.

### Phase 0 — Project scaffolding
- **Objective:** Working skeleton, no features yet.
- **Features:** Monorepo setup, NestJS app boots, Next.js app boots, Docker Compose local environment (Postgres, Redis, MinIO), CI pipeline running lint + build on push.
- **Dependencies:** None.
- **Modules/files:** `infrastructure/docker/*`, `infrastructure/ci/*`, root `package.json`/workspace config, empty `apps/api`, `apps/web`.
- **DB changes:** Initial empty migration baseline.
- **Testing:** CI pipeline itself is the test — verify lint/build/test commands run green on a trivial commit.
- **Acceptance criteria:** `docker compose up` brings up all local infra; `pnpm dev` runs both apps; CI passes on an empty PR.

### Phase 1 — Identity & RBAC
- **Objective:** Users can register/login; roles/permissions exist and are enforceable.
- **Features:** `User`, `Role`, `Permission`, `RolePermission`, `UserRole` tables; register/login/refresh/logout endpoints; `PermissionGuard`.
- **Dependencies:** Phase 0.
- **Modules/files:** `modules/auth/*`, `modules/users/*`, `modules/rbac/*`, seed script for default roles (`author`, `editor`, `admin`).
- **DB changes:** Migration adding the five identity tables above.
- **Testing:** Unit tests for password hashing, token issuance/validation; integration tests for register/login/refresh flows and permission-denied cases.
- **Acceptance criteria:** A seeded admin can log in; an unauthenticated request to a protected route returns 401; a request with insufficient permission returns 403.

### Phase 2 — Articles core (no workflow yet)
- **Objective:** CRUD for articles and revisions, with ownership rules, but still just `DRAFT` status.
- **Features:** `Article`, `ArticleRevision`, `AuthorProfile`, `Category`, `Tag`, `ArticleTag` tables; create/edit-draft/list/get endpoints; ownership check (authors edit only their own drafts).
- **Dependencies:** Phase 1.
- **Modules/files:** `modules/articles/*`, `modules/categories-tags/*`.
- **DB changes:** Migration adding article-related tables.
- **Testing:** Integration tests for CRUD + ownership enforcement.
- **Acceptance criteria:** An author can create/edit a draft; another author cannot edit someone else's draft; an editor/admin can view all drafts.

### Phase 3 — Editorial workflow & audit logging
- **Objective:** Full lifecycle state machine (Section 5) is enforced end-to-end.
- **Features:** `WorkflowModule` with the state machine, transition endpoints (`submit`, `start-review`, `approve`, `reject`, `request-changes`, `publish`, `archive`), `AuditLog` table + service wired into every transition.
- **Dependencies:** Phase 2.
- **Modules/files:** `modules/workflow/*`, `modules/audit/*`.
- **DB changes:** Migration adding `AuditLog`, adding `current_status`/`current_published_revision_id` to `Article` if not already present.
- **Testing:** The full legal/illegal transition matrix from Section 5.2 (this is the highest-priority test suite in the whole project).
- **Acceptance criteria:** A draft can be walked through the entire lifecycle to `PUBLISHED` by the correct roles; every transition produces exactly one `AuditLog` row; illegal transitions (wrong role, self-approval) are rejected with 403.

### Phase 4 — Media management
- **Objective:** Authors/editors can upload and attach media to articles.
- **Features:** `Media` table, signed-upload flow to object storage, `coverImage` association on articles.
- **Dependencies:** Phase 2.
- **Modules/files:** `modules/media/*`.
- **DB changes:** Migration adding `Media` table + `cover_media_id` FK on `Article`.
- **Testing:** Upload validation (type/size), signed URL generation, association tests.
- **Acceptance criteria:** An author can upload an image and set it as an article's cover image; invalid file types are rejected server-side (not just client-side).

### Phase 5 — Public site (read path) + search (Postgres FTS)
- **Objective:** Published articles are visible on the public Next.js site and searchable.
- **Features:** Public read endpoints (published-only), Next.js SSR/ISR article + category pages, `SearchModule` with Postgres FTS provider.
- **Dependencies:** Phase 3 (needs published articles to exist), Phase 4 (needs cover images to render properly).
- **Modules/files:** `modules/search/*`, `apps/web/app/(public)/*`.
- **DB changes:** Migration adding GIN full-text index on articles.
- **Testing:** E2E test: publish an article via CMS flow → confirm it appears on public site and in search results; confirm drafts never appear.
- **Acceptance criteria:** Public site correctly renders only published content; search returns relevant results; SEO meta tags present on article pages (ties into Section on SEO within system architecture).

### Phase 6 — CMS frontend
- **Objective:** Editorial staff have a working UI for everything built in Phases 1–4.
- **Features:** Login UI, draft editor, review queue UI, publish/schedule controls, revision history view.
- **Dependencies:** Phases 1–4.
- **Modules/files:** `apps/web/app/(cms)/*`, `apps/web/components/cms/*`.
- **DB changes:** None (frontend-only phase).
- **Testing:** Component tests + at least one full E2E editorial journey through the UI.
- **Acceptance criteria:** A non-technical editor can complete the entire draft-to-publish flow through the UI without direct API calls.

### Phase 7 — Scheduled publishing
- **Objective:** Articles can be scheduled and auto-publish at the correct time.
- **Features:** `PublicationSchedule` table, `SchedulingModule`, BullMQ delayed job + a periodic sweep as a safety net, `FAILED_TO_PUBLISH` handling.
- **Dependencies:** Phase 3.
- **Modules/files:** `modules/scheduling/*`.
- **DB changes:** Migration adding `PublicationSchedule`.
- **Testing:** Simulated clock tests for on-time firing; failure-path test (slug conflict at execution time).
- **Acceptance criteria:** An article scheduled for a future time publishes automatically without human action at that time; a validation failure at execution time notifies editors instead of failing silently.

### Phase 8 — Notifications
- **Objective:** Users are notified of relevant editorial events.
- **Features:** `Notification` table, in-app notification list, email dispatch (via a provider like SES/Postmark) for key events (submitted-for-review, approved, rejected, scheduled-publish-failed).
- **Dependencies:** Phase 3, Phase 7.
- **Modules/files:** `modules/notifications/*`.
- **DB changes:** Migration adding `Notification`.
- **Testing:** Verify correct notification created/sent on each triggering workflow event (using a mocked email provider in tests).
- **Acceptance criteria:** An editor receives a notification when an article is submitted for review; an author is notified on approval/rejection.

### Phase 9 — AI newsroom pipeline (ingestion + AI analysis)
- **Objective:** The full pipeline in Section 6 is implemented, ending in a human review queue.
- **Features:** `Source`, `NewsItem`, `NewsIngestion`, `AIAnalysis` tables; ingestion adapters (starting with RSS); `AIModule` with Claude-backed summarization/classification/dedup; review-queue endpoints; "accept as draft" endpoint that creates an `Article` in `DRAFT` with provenance.
- **Dependencies:** Phases 1–3 (the resulting draft must flow into the existing workflow).
- **Modules/files:** `modules/ingestion/*`, `modules/ai/*`.
- **DB changes:** Migration adding `Source`, `NewsItem`, `NewsIngestion`, `AIAnalysis`, plus `pgvector` extension if embeddings-based dedup is included in this phase (otherwise deferred to Phase 10).
- **Testing:** Mocked-AI-provider tests verifying proposals are stored, never auto-applied; ingestion adapter tests against fixture RSS feeds; acceptance-flow test confirming the created `Article` starts in `DRAFT`, never any other status.
- **Acceptance criteria:** A configured source ingests items on schedule; AI proposals appear in a review queue with provenance visible; accepting an item creates a normal draft article that must go through the full Section 5 workflow to publish — **no code path allows an ingested item to reach `PUBLISHED` without human transitions.**

### Phase 10 — AI newsroom CMS UI + embeddings-based dedup
- **Objective:** Editors have a real UI for the review queue; dedup quality improved.
- **Features:** Review-queue UI (source item + AI proposals side-by-side), accept/reject/edit-before-accept controls; `pgvector` embeddings for dedup clustering.
- **Dependencies:** Phase 9, Phase 6.
- **Modules/files:** `apps/web/app/(cms)/newsroom/*`, `modules/ai/dedup.service.ts` (upgraded).
- **DB changes:** Migration adding vector column + index (if not already added in Phase 9).
- **Testing:** UI component/E2E tests for the review queue; dedup-quality regression tests against a fixture dataset.
- **Acceptance criteria:** An editor can review, dedup-cluster-aware-ly, and act on AI proposals entirely through the UI.

### Phase 11 — Comments
- **Objective:** Readers can comment on published articles, with basic moderation.
- **Features:** `Comment` table, submission endpoint (rate-limited), moderation endpoint (hide/delete) for editors/admins.
- **Dependencies:** Phase 5.
- **Modules/files:** New `modules/comments/*`.
- **DB changes:** Migration adding `Comment`.
- **Testing:** Submission/rate-limit tests, moderation permission tests.
- **Acceptance criteria:** A reader can comment on a published article; an editor can moderate; spam/abuse rate limits function.

### Phase 12 — Analytics & admin dashboard
- **Objective:** Basic operational visibility for admins/editors.
- **Features:** Pageview logging (privacy-conscious, no PII beyond what's needed), `AdminModule` dashboard endpoints (top articles, pending-review count, ingestion health), dashboard UI.
- **Dependencies:** Phase 5 (needs traffic to measure), Phase 9 (ingestion health).
- **Modules/files:** `modules/admin/*`, `apps/web/app/(cms)/dashboard/*`.
- **DB changes:** Migration for a lightweight pageview/event table (or integration with an external analytics provider instead of a custom table — a decision the team should make explicitly at this phase).
- **Testing:** Dashboard aggregation query tests.
- **Acceptance criteria:** An admin can see key operational metrics without querying the database directly.

### Phase 13+ (Future, not scheduled)
- Elasticsearch migration, CDN/edge caching rollout, read replica, MFA, multi-source scraper adapters, Kafka/RabbitMQ migration for ingestion, Kubernetes migration, multi-language support. Each of these should be scoped as its own phase *when its trigger condition (Section 10/12) is actually met*, not implemented speculatively.

---

## 14. Risks and Architectural Trade-offs

| Risk / Trade-off | Discussion | Mitigation |
|---|---|---|
| Modular monolith could become a "big ball of mud" if module boundaries aren't respected | NestJS modules provide structure, but nothing stops a developer (or coding agent) from importing across module internals | Enforce module boundaries via lint rules (e.g., dependency-cruiser or NestJS module encapsulation) and code review discipline; document the rule explicitly in Section 15 |
| Postgres FTS may not scale/satisfy search UX expectations | Acceptable for MVP; will need replacement | Search abstracted behind `SearchModule` interface from day one specifically so this swap doesn't require touching calling code |
| JWT permission staleness | Embedding roles (not raw permissions) in the token and resolving permissions per-request balances token size vs. freshness, but role changes still require the resolution step, not just token decode, or they'd also be stale | Explicitly resolve permissions server-side per request rather than trusting embedded permission claims |
| AI provider dependency / cost / availability | The newsroom pipeline depends on an external API; outages or cost spikes are a real operational risk | Provider abstraction (`AIModule`) allows swapping/adding providers; ingestion pipeline degrades gracefully (items simply wait in an un-analyzed state, still reviewable manually) if AI calls fail — the pipeline is not a hard dependency for humans to still do their jobs |
| Over-trusting AI dedup could suppress legitimate distinct stories | Dedup errors have real editorial cost (a missed distinct story) | Deliberately designed as "cluster and surface" rather than "auto-discard" (Section 6.3) — human always sees clustered items |
| Scheduled publishing race conditions (two workers picking up the same job) | Could cause duplicate-publish attempts | Use BullMQ's built-in job locking/idempotency; re-validate state at execution time (Section 5.2) so a duplicate attempt is a no-op, not a duplicate publish |
| Revision-table growth over time | Append-only revisions is correct for audit but grows unbounded | Flagged explicitly as a Future partitioning/archival candidate (Section 4.4) rather than solved prematurely |
| Team size vs. scope | The full vision (30 architecture concerns) is large for a student/developer team | Addressed directly by the phased roadmap (Section 13) — MVP is a genuinely small, shippable slice (Phases 0–6), with everything else sequenced and gated |
| REST vs GraphQL choice may be revisited | REST was chosen for MVP simplicity; a complex future admin dashboard might benefit from GraphQL's flexible querying | Documented as an explicit trade-off (Section 3.3), not a permanent decision — revisit if/when a concrete pain point (e.g., dashboard over/under-fetching) appears |
| Single-region deployment is a single point of failure | Acceptable at MVP scale; not acceptable indefinitely | Multi-region is explicitly Future (Section 10), gated on real uptime requirements, not built speculatively |

---

## 15. ANTIGRAVITY IMPLEMENTATION GUIDELINES

These rules govern how an AI coding agent (or any automated contributor) should operate on this repository. They apply to every phase in Section 13 and every future change beyond it.

1. **Inspect before modifying.** Before writing any code, read the relevant existing module(s), their tests, and the current database schema/migrations. Never assume the shape of existing code from this specification alone — the spec describes intent; the repository is ground truth once code exists.
2. **Never blindly overwrite existing functionality.** If a change would replace or remove existing behavior, confirm that behavior is actually being deprecated intentionally (check this document's phase list and any linked issue/ticket) rather than assuming it's dead code.
3. **Ask for clarification when requirements conflict.** If this specification, an issue description, and the current codebase disagree, stop and surface the conflict rather than guessing which one wins. This is especially critical for workflow (Section 5) and RBAC (Section 3.6) logic, where a wrong guess has security or editorial-integrity consequences.
4. **Make small, incremental changes.** Prefer the smallest change that satisfies one phase's acceptance criteria over a large multi-phase change, even if it takes more turns. This mirrors the phase sizing already done in Section 13 — don't re-batch phases together.
5. **Do not modify unrelated files.** A change scoped to `modules/articles` should not touch `modules/ai` or frontend files unless the task explicitly spans both (e.g., Phase 9's ingestion→workflow integration).
6. **Use migrations for every database change.** Never modify the schema by editing generated migration history or by hand-editing the database directly. Every schema change is a new, named, forward-only migration file, generated via the ORM's migration tooling.
7. **Respect module boundaries.** Business logic changes belong in a module's `*.service.ts`; controllers stay thin; data access stays behind the repository/ORM layer. Do not add database queries to controllers or business logic to DTOs.
8. **The `WorkflowModule` is the single source of truth for article status.** No other module may write to `Article.current_status` directly, ever — including the ingestion/AI pipeline (Section 6.4) and any future feature. If a new feature seems to need to change article status directly, route it through `WorkflowModule`'s transition API instead.
9. **Run tests and type checks after every change**, not just at the end of a phase. For changes touching `WorkflowModule` or `RBACModule` specifically, run the full transition-matrix test suite (Section 9), not just the tests for the file changed.
10. **Every state-changing action must produce an `AuditLog` entry.** If a new mutating endpoint is added and it doesn't already flow through a module that writes audit entries, add explicit audit logging as part of that same change — this is not optional cleanup for later.
11. **AI-generated or ingested content must never bypass human review.** Any new code path that could result in content becoming publicly visible must be checked against Section 6.4's boundary list before being written. If in doubt, route through the existing `Article` lifecycle rather than inventing a new publication path.
12. **Report changed files at the end of every task.** Provide an explicit list of files created/modified/deleted, not just a prose summary.
13. **Report unresolved issues or deferred decisions explicitly**, rather than silently working around them (e.g., "the ownership rule for co-authored articles isn't specified — I assumed single-author ownership; flag for team review").
14. **Never expose secrets.** No API keys, database credentials, or tokens in code, logs, commit messages, or test fixtures. Use environment variables and the `.env.example` pattern already established in Section 11's folder structure.
15. **Never make destructive changes without explicit approval.** This includes: dropping or truncating database tables/columns, force-pushing over history, deleting user-generated content (articles, media, comments) outside the documented soft-delete/archive paths, and rewriting migration history. Soft-delete and archival patterns (Sections 4.2–4.3, 5.2) exist specifically so destructive operations are rarely, if ever, necessary.
16. **When a phase's acceptance criteria (Section 13) can be objectively checked (tests, a specific user flow), verify it before declaring the phase complete** — don't rely on "the code looks right."
17. **Keep this document in sync.** If an implementation decision meaningfully diverges from this specification (a justified trade-off discovered during implementation), update the relevant section of this document as part of the same change, with a brief rationale, rather than letting the spec silently go stale.

---

*End of specification. No implementation code has been included, per project constraints. This document is intended to be the reference the implementation phases (Section 13) are executed against.*
