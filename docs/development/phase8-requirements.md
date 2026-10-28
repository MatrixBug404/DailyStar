# Phase 8 Requirements

**Status:** APPROVED FOR IMPLEMENTATION
**Date:** 2026-10-24
**Source:** `dailystar_architecture.md` §13 (Phase 8 definition), `phase8-technical-spec-v1.0.md`
**Baseline commit:** `bfeeb0f251255b8eafee2ea94d7c8cb1b867d5dd` (Phase 7 complete)

This document defines the functional, security, compatibility, and acceptance requirements for Phase 8 (Notifications). It is derived directly from the Phase 8 technical specification. Phase 8 has been approved for implementation using the recommended defaults, accepted concurrency limitations, and authorized M1.

---

## Officially Defined Scope (from `dailystar_architecture.md` §13)

> **Phase 8 — Notifications**
> - **Objective:** Users are notified of relevant editorial events.
> - **Features:** `Notification` table, in-app notification list, email dispatch (via a provider like SES/Postmark) for key events (submitted-for-review, approved, rejected, scheduled-publish-failed).
> - **Dependencies:** Phase 3, Phase 7.
> - **Modules/files:** `modules/notifications/*`.
> - **DB changes:** Migration adding `Notification`.
> - **Testing:** Verify correct notification created/sent on each triggering workflow event (using a mocked email provider in tests).
> - **Acceptance criteria:** An editor receives a notification when an article is submitted for review; an author is notified on approval/rejection.

The four named email events are contractually in scope: **submitted-for-review, approved, rejected, scheduled-publish-failed**. Any additional event (e.g., changes-requested, publication-succeeded) is explicitly a proposed scope amendment in §"Decisions" and requires approval.

---

## Deliverables (D1–D8)

### D1 — Notification data model (Class B)
A `Notification` table plus `NotificationType` and `NotificationEmailStatus` enums, added by one forward-only, additive Prisma migration. Required fields: recipient, type, persisted display title/body, optional article reference, dedupe key, read timestamp, email delivery state/attempts/last error/sent timestamp, timestamps. No existing table is altered except additive relation fields on `User` and `Article` (relations only, no columns).

### D2 — Notifications API (Class B)
Authenticated, user-scoped endpoints under `v1/notifications`:
- list own notifications with pagination and `unreadOnly` filter;
- unread count;
- mark one notification read (idempotent);
- mark all read.

Responses use the existing `PaginatedResponse<T>` envelope. Non-owned notification IDs return 404, consistent with the repository's IDOR-protection convention.

### D3 — Email delivery pipeline (Class B)
A provider-abstracted email subsystem with:
- `LogEmailProvider` as the default local/test/CI transport;
- one production adapter (proposed: Postmark over HTTPS via the Node 22 built-in `fetch`; SES is the documented alternative);
- a BullMQ queue `notification-email` with bounded retries, exponential backoff, deterministic job identity, and bounded retention;
- a bounded reconciliation sweep implementing spec §8.2: crash-before-dispatch recovery, strict precedence for completed/live/exhausted-failed/missing jobs, worker pre-send re-check, compare-and-set transitions from `PENDING`, terminal-state immutability, live-job deferral, and Redis-inconclusive `PENDING` behavior. The sweep is the sole authority for `FAILED` after an eligible delivery exhausts its retry/recovery policy.

### D4 — WorkflowService event integration (Class C — controlled modification)
Instrumentation of the existing `WorkflowService` transactions at exactly these event points:
- `submitReview` — `DRAFT → SUBMITTED_FOR_REVIEW` (`workflow.service.ts:49`, audit action `SUBMIT_FOR_REVIEW`);
- `approve` — `UNDER_REVIEW → APPROVED` (`:176`, `APPROVE`);
- `reject` — `UNDER_REVIEW → DRAFT` (`:144`, `REJECT`);
- `requestChanges` — `UNDER_REVIEW → DRAFT` (`:112`, `REQUEST_CHANGES`) — **CONDITIONAL on OD-2 approval**; if OD-2 is not approved, this transition creates no notification and `ARTICLE_CHANGES_REQUESTED` is omitted from the schema and migration;
- scheduled-publish failure — `recordTerminalFailure` (`:560`) and the three inline terminal branches in `executeScheduledPublish` (`:752`, `:786`, `:823`), all writing `PUBLISH_FAILED` and setting `FAILED_TO_PUBLISH`.

This is a **Class C** change because it touches a Phase 3/Phase 7-locked service. It is behavior-preserving for the Article lifecycle: no status transition logic, version semantics, locking order, or audit contract may change. `WorkflowService` remains the sole authority for `Article.status`.

### D5 — Recipient resolution (Class B)
- **Editors:** active users holding the existing `article.start-review` permission (seeded for `editor` and `admin`). Permission-based, not role-name-based.
- **Authors:** the article's `primaryAuthorId`, subject to the active-user policy below.
- **Active-user policy:** no in-app notification is created for a recipient who is inactive at trigger time, and no email is attempted. If a row's recipient becomes inactive or has no email address at dispatch, the in-app row is retained and email delivery is marked `SKIPPED`.
- **Actor exclusion:** a user never receives a notification for an action they themselves performed.
- **Scheduler failures:** the same editor recipient set (the system actor is not a user).

### D6 — In-app notification list (Class B)
A CMS page under the protected segment (`/cms/notifications`) plus a nav entry with unread count, listing notifications newest-first with type, article title, timestamp, unread state, per-item mark-read, mark-all-read, and a deep link to the related article where one exists.

### D7 — Tests and acceptance evidence (Class B)
Unit, integration, and E2E tests covering every trigger, recipient class, dedupe rule, read-state authorization, and the mocked-provider requirement. Full non-regression of Phases 1–7 suites.

### D8 — Configuration and secret handling (Class B)
Typed configuration additions, `.env.example` entries, provider validation at boot, and redaction guarantees. No credentials in code, logs, fixtures, or commit messages.

---

## Preserved Invariants (INV8-01 – INV8-12)

- **INV8-01:** `WorkflowModule` remains the sole mutator of `Article.status`. Notifications never write `Article` rows.
- **INV8-02:** Notification row creation occurs **inside** the same PostgreSQL transaction as the triggering workflow transition (atomic with it). No notification exists for a transition that rolls back.
- **INV8-03:** A notification-persistence failure must never roll back a workflow transition. Notification inserts are contained in a savepoint; failure is logged and the transition commits.
- **INV8-04:** Email dispatch occurs **strictly after** transaction commit (outbox-style). No network I/O inside a database transaction.
- **INV8-05:** Email-provider failure, retry exhaustion, or queue unavailability never changes the workflow outcome, the HTTP response of the transition endpoint, or the in-app notification record.
- **INV8-06:** Exactly one `AuditLog` row per transition remains unchanged; notifications are an additional side effect, never a replacement.
- **INV8-07:** No new workflow transition, no bypass of four-eyes, `expectedVersion`, revision integrity, or scheduling lock ordering.
- **INV8-08:** Notifications are strictly user-scoped. A user can list/read only their own; foreign IDs return 404.
- **INV8-09:** Email delivery is at-least-once by design; duplicate suppression is enforced at the notification level by `(recipientId, dedupeKey)`.
- **INV8-10:** Secrets (`POSTMARK_SERVER_TOKEN`) are never logged, returned by APIs, or embedded in tests/fixtures.
- **INV8-11:** All Phase 1–7 unit, integration, and E2E suites pass unchanged (itemized additive assertions only).
- **INV8-12:** No new runtime dependency is required for the recommended email adapter (Node 22 `fetch`). Any dependency addition requires explicit approval.

---

## Acceptance Criteria (AC-1 – AC-17; AC-16 is conditional on OD-2)

- **AC-1:** Submitting an article for review creates exactly one in-app notification for each active user holding `article.start-review`, excluding the submitting actor, and enqueues one email per recipient who remains active and has an email address once the transaction commits; a recipient deactivated before dispatch has email marked `SKIPPED`; an active recipient without an email address receives the in-app notification with email status `SKIPPED`.
- **AC-2:** Approving an article creates exactly one in-app notification for the article's `primaryAuthorId` when that user is active (no notification is created for an inactive author) and dispatches the approval email; a recipient deactivated after creation but before send has email marked `SKIPPED`.
- **AC-3:** Rejecting an article creates exactly one in-app notification for the article's `primaryAuthorId` when that user is active (no notification is created for an inactive author) and dispatches the rejection email; a recipient deactivated after creation but before send has email marked `SKIPPED`.
- **AC-4:** A genuine terminal scheduled-publish failure (`FAILED_TO_PUBLISH`) creates exactly one in-app notification per active editor recipient per `PublicationSchedule`, and dispatches the failure email; stale/cancelled schedules produce none.
- **AC-5:** If notification persistence is forced to fail, the workflow transition still commits and returns success; the failure is logged; no partial notification rows exist.
- **AC-6:** If the email provider throws or the queue is unavailable, the transition response is unchanged, the notification's email delivery state remains `PENDING`, and the reconciliation sweep repairs or terminally marks it later.
- **AC-7:** Replaying the same triggering event (duplicate worker/sweep path, retry) cannot create a second notification for the same `(recipientId, dedupeKey)`; the unique constraint is the enforcement mechanism.
- **AC-8:** `GET /v1/notifications` returns only the caller's notifications, supports `page`/`limit`/`unreadOnly`, and returns 400 for `page < 1`, `limit < 1`, `limit > 100`, or non-numeric values (no silent clamping).
- **AC-9:** `PATCH /v1/notifications/:id/read` is idempotent and returns 404 for another user's notification; `POST /v1/notifications/read-all` marks all of the caller's unread notifications read.
- **AC-10:** The CMS `/cms/notifications` page renders the caller's notifications with unread state and performs mark-read against the API; the nav shows the unread count.
- **AC-11:** All notification tests use a mocked/log email provider; CI performs no outbound network calls and no real email is sent.
- **AC-12:** `EMAIL_PROVIDER=postmark` without a token fails startup with a clear configuration error; `EMAIL_PROVIDER=log` works with no external configuration.
- **AC-13:** The migration is additive and applies cleanly to a populated Phase 7 database; no backfill or destructive statement is required.
- **AC-14:** Only `modules/notifications/*`, the documented `WorkflowService` integration points (the four official events, plus `requestChanges` only if OD-2 is approved), additive schema relations, `app.module.ts`, `configuration.ts`, `.env.example`, `packages/types`, and CMS notification surfaces change. No other behavior changes.
- **AC-15:** Full Phase 1–7 non-regression passes: API unit suite, API E2E suites, web Jest suite, typechecks, and builds all green.
- **AC-16 (CONDITIONAL — only if OD-2 is approved):** `requestChanges` creates exactly one in-app notification for the article's active `primaryAuthorId` (no notification for an inactive author) and dispatches the changes-requested email; a recipient deactivated after creation but before send has email marked `SKIPPED`. If OD-2 is not approved, this criterion is void, `ARTICLE_CHANGES_REQUESTED` is omitted from M1's enum and migration, and `requestChanges` produces no notification.
- **AC-17:** A notification that commits but is never enqueued (process death before dispatch) is not left `PENDING` indefinitely while Redis and the worker are healthy, and concurrent reconciliation cannot overwrite a terminal delivery state. The sweep applies strict precedence: completed job → `SENT` (conditional from `PENDING`, no resend, even if the recipient is now ineligible); observed live job (waiting/delayed/active or failed with retries remaining) → leave `PENDING` and untouched (never reset, removed, or interrupted), because a live job is not delivery evidence; exhausted-failed job → `SKIPPED` if the recipient is now inactive or has no email address, otherwise `FAILED`; missing job → enqueue when the recipient is active with an email address and attempts remain, `SKIPPED` when inactive or without an email address, `FAILED` when active with email but attempts are exhausted; Redis unavailable or inconclusive → remain `PENDING` with no attempt increment. An inactive recipient whose job is observed live remains `PENDING`; the worker re-checks the current status and recipient eligibility immediately before sending and performs the `SKIPPED` transition there. All delivery-state writes are conditional from `PENDING`; a stale reconciliation result cannot overwrite terminal `SENT`, `SKIPPED`, or `FAILED`. `SKIPPED` means an undelivered email's recipient is ineligible (users inactive at creation never have a row); `FAILED` means an eligible delivery exhausted its retry/recovery policy. Once a provider call is in flight it cannot be cancelled; if eligibility changes mid-call, a successful send is recorded as `SENT` when the conditional update wins.

---

## Security, Compatibility, and Error Contracts

- **Authentication:** all notification routes require `AuthGuard`; no `@RequirePermission` gate is added because every authenticated user may receive notifications. Authorization is ownership-based.
- **IDOR:** foreign notification IDs return `404` (never `403`), matching the existing article-visibility convention.
- **Input validation:** pagination and query parameters use a typed DTO with `class-validator`; invalid input returns HTTP 400.
- **Stored content:** `title`/`body` are server-rendered strings derived from article revision titles and actor display names. They are persisted snapshots and rendered as text by the CMS (no HTML execution).
- **Email content:** plain text only in Phase 8; no user-supplied HTML is interpolated into email bodies.
- **Compatibility:** additive schema, additive routes, additive config. No existing API response shape changes. `WorkflowService` response types remain unchanged.
- **Error contracts:** notification failures are invisible to workflow clients. Transition endpoints must not surface new error codes.

---

## Decisions (Approved / Rejected / Deferred)

| ID | Decision | Status | Resolution |
|---|---|---|---|
| OD-1 | Editor recipients: permission (`article.start-review`) vs role name | **APPROVED** | Resolve editor recipients using the existing `article.start-review` permission. Exclude inactive users and the acting user. |
| OD-2 | Does `REQUEST_CHANGES` become a separate notification event? | **REJECTED / DEFERRED** | Do not add a changes-requested notification event in Phase 8. Use exactly the four official event types (`ARTICLE_SUBMITTED_FOR_REVIEW`, `ARTICLE_APPROVED`, `ARTICLE_REJECTED`, `ARTICLE_FAILED_TO_PUBLISH`). Omit `ARTICLE_CHANGES_REQUESTED` from the Prisma enum, PostgreSQL enum, and shared types. `requestChanges` gets no notification integration. AC-16 is void. |
| OD-3 | Does publication itself notify anyone? | **APPROVED** | No successful-publication notification in this phase; approval notification suffices. |
| OD-4 | Email provider and local transport | **APPROVED** | Use the email-provider abstraction, `log` as the local/test/CI default, and the Postmark adapter using Node 22's built-in `fetch`. Production email configuration belongs to M3, not M1. |
| OD-5 | Duplicate suppression for scheduled-publish failures | **LOCKED (design)** | Unique `(recipientId, dedupeKey)` with `article-publish-failed:{scheduleId}`; terminal transition is created at most once per schedule. |
| OD-6 | In-app refresh model | **APPROVED** | Refresh the in-app list on navigation/page entry; no polling or WebSocket in Phase 8. |
| OD-7 | Retention of notification rows | **APPROVED** | Retain notification records indefinitely for the MVP; archival is a future phase concern. |
| OD-8 | Notifying inactive users | **APPROVED** | Inactive users at event time receive no notification row. If an existing recipient later becomes inactive or lacks an email address, retain the in-app row and apply the documented `SKIPPED` email behavior. |
| OD-9 | Notification for successful scheduled publication | **APPROVED** | No notification for successful scheduled publication; scheduled-publish failures remain in scope. |
| OD-10 | Notification deletion / preferences / digests | **DEFERRED** | Notification deletion, preferences, and digests remain out of scope for Phase 8. |

**Concurrency limitations — Accepted:** Best-effort/at-least-once delivery guarantees, worker/reconciler safeguards, and residual race limitations are accepted as documented. No claim/lease subsystem is introduced in Phase 8.

---

## Explicitly Out of Scope

- Notification preferences, per-user email opt-out, digests, quiet hours.
- Push notifications, SMS, Slack/webhook integrations, real-time websockets/SSE.
- Notification deletion, archiving, or retention jobs.
- Admin broadcast/announcement tooling or cross-user notification viewing.
- Rich HTML email templates, localization/i18n, or a templating engine.
- Any change to workflow transitions, permissions, or `Article` lifecycle rules.
- Any change to the four-eyes rule, `expectedVersion` enforcement, or scheduling semantics.
- Ingestion/AI notifications (Phase 9+), comments (Phase 11), analytics (Phase 12).

---

## Traceability

- **Source:** `dailystar_architecture.md` §13 lines 633–640; Phase 7 boundary statements in `phase7-technical-spec-v1.0.md` §15 and §18.
- **Technical contract:** `phase8-technical-spec-v1.0.md`.
- **Tasks:** `phase8-tasks.md`.
- **Deliverables** map to spec §4; **invariants** to spec §2.2, §5, §7, §8, §12; **acceptance criteria** to spec §6–§13 and §14; **decisions** to spec §16.
