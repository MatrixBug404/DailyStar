# Phase 7 — Scheduled Publishing Technical Specification (v1.0)

## 1. Objective
To enable scheduled publishing of approved articles without human intervention. The system must allow authorized users to set a future publication time for an approved article, securely process the state transition in the background at the specified time, and robustly handle failures and race conditions.

## 2. Source of Truth
The central architectural invariant is that **`WorkflowModule` remains the single source of truth for `Article.status`**.
- `Article.status` and `Article.scheduledFor` are the authoritative lifecycle fields.
- `PublicationSchedule` is strictly an execution-intent / scheduler record. It is not a second lifecycle authority.
- No cross-table foreign key or PostgreSQL trigger is used to enforce state parity. Consistency is an application/domain invariant enforced strictly by `WorkflowService` database transactions.
- Every state transition into or out of `SCHEDULED` must mutate both `Article` and `PublicationSchedule` simultaneously within a single PostgreSQL transaction to guarantee consistency.
- A `PENDING` schedule that can no longer execute its intent is **stale**, not a publishing failure. It is reconciled to `CANCELLED` with a conditional update, without changing the Article's lifecycle state and without writing `PUBLISH_FAILED`.
- If the Article is already `PUBLISHED` with the schedule's intended `approvedRevisionId`, the schedule is reconciled to `EXECUTED` without publishing or writing another `PUBLISH` event.
- If the Article is already `PUBLISHED` with a different revision, the schedule is reconciled to `CANCELLED` as superseded.
- Soft deletion of a `SCHEDULED` article is rejected. The editor must cancel through `WorkflowService` first.

## 3. Schedule Creation Atomicity
The exact sequence for creating a schedule is:
1. Begin PostgreSQL transaction and acquire locks in the shared order: pending `PublicationSchedule` rows first (if any), then the Article row (`SELECT ... FOR UPDATE`). This serializes scheduling with soft deletion, cancellation, and publication without deadlocks.
2. Validate the article state (`APPROVED`) and `scheduledFor` time (must be valid and $\ge$ `Date.now() + 5 minutes` in UTC).
3. Update `Article` state: `APPROVED` $\rightarrow$ `SCHEDULED`. Set `Article.scheduledFor`.
4. Increment `Article.version`.
5. Create the `PublicationSchedule` row.
6. Persist immutable scheduling intent on the `PublicationSchedule`: `articleId`, `scheduledFor`, `approvedRevisionId`, and `expectedArticleVersion` (which is the new `Article.version` after the transition).
7. Write the `SCHEDULE` audit event inside the transaction.
8. Commit PostgreSQL transaction.
9. **ONLY AFTER COMMIT**, enqueue the BullMQ job.

*Important:* Redis/BullMQ is not the source of truth. A distributed atomic DB+Redis transaction will not be attempted. If a DB commit succeeds but the queue enqueue fails, the safety sweep will detect and repair the missing job.

## 4. Expected Version / Revision
To ensure the correct content is published:
- `expectedArticleVersion`: Captured as the `Article.version` **after** the `APPROVED` $\rightarrow$ `SCHEDULED` transition.
- `approvedRevisionId`: Captures the exact approved revision intended for publication.
- At execution time, the worker **must compare** the current `Article.version` and `Article.approvedRevisionId` against the schedule's stored intent.
- While the Article is still `SCHEDULED` and not soft-deleted, a version or revision mismatch is a **genuine terminal publication failure**: the schedule becomes `FAILED`, the Article becomes `FAILED_TO_PUBLISH`, and a `PUBLISH_FAILED` audit event is written.
- If the Article has already left `SCHEDULED`, is soft-deleted, or no longer exists, the mismatch is irrelevant: the schedule is stale and is reconciled to `CANCELLED` without touching the Article or writing `PUBLISH_FAILED`.
- The worker must never publish the wrong revision.

## 5. Cancellation
The invariant is: **"When `Article.status != SCHEDULED`, no active `PublicationSchedule` for that article may remain `PENDING`."**

The cancellation flow must:
1. Begin DB transaction.
2. Lock pending `PublicationSchedule` rows, then lock and re-read the Article (`SELECT ... FOR UPDATE`). If the Article is no longer `SCHEDULED`, abort without overwriting a concurrent publication or cancellation.
3. Update `Article` (`status` $\rightarrow$ `APPROVED`, `scheduledFor` $\rightarrow$ `null`) and `PublicationSchedule` (`status` $\rightarrow$ `CANCELLED`).
4. Increment the relevant `Article.version`.
5. Write the `CANCEL_SCHEDULE` audit record.
6. Commit DB transaction.
7. Attempt BullMQ job removal post-commit.

*Important:* Job removal from Redis is **NOT** required for correctness. If Redis is down or job removal fails, the worker will eventually execute, but it must still reject the cancelled schedule by validating the database state.

### 5.1 Soft Deletion

Soft deletion must not create an executable dangling schedule:
- `ArticlesService.remove()` locks the Article row and rejects deletion of a `SCHEDULED` article with `409 Conflict`. The message directs the editor to cancel the schedule first.
- Scheduling also locks the same Article row, so a concurrent schedule/delete interleaving cannot leave a deleted `SCHEDULED` article with a `PENDING` schedule.
- Editing a scheduled article (`revertToDraft`) and reopening (`reopenDraft`) use the same schedule $\rightarrow$ Article lock order and re-check the Article status under lock. They cannot revert a concurrently published Article.
- Deletion of a non-`SCHEDULED` article remains allowed and does not mutate `PublicationSchedule`.
- Defensive reconciliation still exists for pre-existing orphan data: if a worker or sweep encounters a `PENDING` schedule whose Article is soft-deleted, it conditionally cancels the schedule and leaves the Article unchanged.

## 6. Rescheduling
- **No in-place rescheduling** is permitted in Phase 7.
- Rescheduling an article requires invoking the cancel-schedule workflow followed by the creation of a brand new schedule.
- The system must never create a second `PENDING` schedule for an already scheduled article.

## 7. Worker / Workflow Boundary
The scheduler worker must **NEVER** directly mutate `Article` lifecycle fields. It must delegate business logic to the `WorkflowModule`.

**Required Flow:**
1. BullMQ Worker triggers.
2. Calls `WorkflowService.executeScheduledPublish(scheduleId)`.
3. `WorkflowService` begins DB transaction.
4. Load `PublicationSchedule` with row locking (`FOR UPDATE`). If it is missing, return a terminal no-op with no database writes. If it is not `PENDING`, do nothing to the Article or schedule.
5. Load the `Article` with row locking (`FOR UPDATE`).
6. If the Article is missing, soft-deleted, or not `SCHEDULED`, conditionally reconcile the still-`PENDING` schedule to `CANCELLED` and make no Article mutation.
7. If the Article is `PUBLISHED` with `currentPublishedRevisionId == schedule.approvedRevisionId`, conditionally reconcile the schedule to `EXECUTED`; do not publish again or write another `PUBLISH` event.
8. If the Article is `PUBLISHED` with a different revision, conditionally reconcile the schedule to `CANCELLED` as superseded.
9. Only while the Article is still validly `SCHEDULED` and not deleted: validate `expectedArticleVersion` and `approvedRevisionId`. Genuine mismatches conditionally mark the schedule `FAILED`, transition the Article to `FAILED_TO_PUBLISH`, increment its version, and write a `PUBLISH_FAILED` audit event.
10. Otherwise perform the authoritative `SCHEDULED` $\rightarrow$ `PUBLISHED` transition, conditionally mark the schedule `EXECUTED`, and write the scheduler `PUBLISH` (and, if late, `SCHEDULE_MISSED`) audit events.
11. Commit DB transaction.

All schedule transitions use conditional updates guarded by `status = PENDING`. A zero-row conditional update is a concurrency outcome to reconcile, not proof of publication failure.

Do not duplicate publish business rules inside the scheduler worker.

## 8. Duplicate Worker / Idempotency
- BullMQ `jobId` must be strictly set to `PublicationSchedule.id` to prevent duplicate enqueuing.
- However, worker correctness must **NOT** depend on BullMQ deduplication.
- Database conditional state validation (checking `PublicationSchedule.status == PENDING` and matching versions within a lock) must guarantee exactly one successful publication.
- Two concurrent workers racing for the same schedule must result in exactly one successful state transition.

## 9. Sweep Design
The periodic sweep acts as a fallback for missed or failed enqueue operations. It must not hold open PostgreSQL row locks while communicating with Redis.

- **Cadence:** Configurable, recommended every 5 minutes.
- **Batch Size:** Bounded (e.g., 500 rows).
- **Algorithm:**
  1. Query a bounded batch of `PENDING` schedules (including future schedules) with the Article fields needed to validate `status`, `deletedAt`, `approvedRevisionId`, and `currentPublishedRevisionId`.
  2. Reconcile stale/published database state before communicating with Redis.
  3. Inspect BullMQ job state for each remaining schedule.
  4. Repair only when the persisted intent is still executable.
- Database-state reconciliation:
  - Article missing, soft-deleted, or not `SCHEDULED` → conditionally set the schedule to `CANCELLED`; never touch the Article or write `PUBLISH_FAILED`.
  - Article `PUBLISHED` and `currentPublishedRevisionId == schedule.approvedRevisionId` → conditionally set the schedule to `EXECUTED`; do not enqueue.
  - Article `PUBLISHED` with a different revision → conditionally set the schedule to `CANCELLED` as superseded; do not enqueue.
- Job-state handling:
  - *waiting/delayed/active*: usable job exists, do nothing.
  - *missing, future schedule*: enqueue preserving the remaining delay. This ordinary recovery does not consume a recovery attempt.
  - *missing, overdue schedule*: atomically increment `PublicationSchedule.attempts` and enqueue only while the bound is not exceeded. When exceeded, invoke the state-aware `WorkflowService.recordTerminalFailure()` path.
  - *completed*: re-read schedule and Article state. Reconcile a matching published revision to `EXECUTED`, reconcile a different revision or stale Article to `CANCELLED`, or — only when the Article is still `SCHEDULED` and the schedule is still `PENDING` — remove the completed job, verify removal succeeded, and only then enqueue with the same deterministic job ID. If removal or verification fails, defer to the next sweep without adding a replacement. Overdue completions use the same bounded recovery counter.
  - *failed*: retry while `attemptsMade < opts.attempts`; otherwise invoke the state-aware `WorkflowService.recordTerminalFailure()` path.
- The sweep **must never** call `executeScheduledPublish()` or publish directly. It is not a second publishing path.
- The sweep is not required to "enumerate and clean every orphan Redis job" as part of the MVP.

### 9.1 Queue Retention

BullMQ retention is explicit and bounded:
- Completed jobs: `removeOnComplete: { age: 86400, count: 1000 }` (24 hours, 1000 jobs). This keeps completed jobs observable long enough for reconciliation.
- Failed jobs: `removeOnFail: { age: 604800, count: 5000 }` (7 days, 5000 jobs) for diagnosis without unbounded growth.

If a retained completed job is removed by age/count before reconciliation, the missing-job repair path handles the schedule.

### 9.2 Recovery Counter Semantics

`PublicationSchedule.attempts` is the **scheduler-recovery counter**, not BullMQ's execution-attempt counter:
- It counts overdue missing-job and overdue completed-without-publication repairs performed by the safety sweep.
- Ordinary future missing-job recovery does not increment it.
- It is incremented atomically with a conditional `status = PENDING` update.
- The bound is configurable via `SCHEDULING_RECOVERY_MAX_ATTEMPTS` (default `3`). Once the bound is exceeded, the sweep invokes the state-aware terminal-failure path.
- The terminal path cancels stale/soft-deleted/published schedules and only moves a still-valid `SCHEDULED` Article to `FAILED_TO_PUBLISH`.
- A Redis outage does not increment the counter; the sweep skips the schedule and retries on the next cadence.

## 10. Missed Schedule Policy
If `scheduledFor <= now` (e.g., after a system downtime) and the system is recovering:
- Publish the article as soon as safely possible via the normal worker/sweep flow.
- Record an audit event `SCHEDULE_MISSED` during publication to indicate it was late.
- Do not silently skip the publication.
- A missed schedule is not automatically a permanent publishing failure.

## 11. Failure Taxonomy
**Retryable Failures:**
- Temporary DB connection failure or transaction deadlock.
- Transient infrastructure/Redis failure.
- Worker interruption / SIGTERM.
- Queue delivery issues.
*Result:* Worker throws, BullMQ retries based on backoff. Article remains `SCHEDULED`. `PublicationSchedule` remains `PENDING`.

**Stale / Cancelled Outcomes (terminal, but not publishing failures):**
- `Article` is no longer `SCHEDULED` (DRAFT, APPROVED, ARCHIVED, or another non-`SCHEDULED` state).
- `Article` is soft-deleted.
- `Article` row no longer exists.
- `PublicationSchedule` is already `CANCELLED`, `EXECUTED`, or `FAILED`.
- `Article` is already `PUBLISHED` with a different revision.
*Result:* Conditional `PublicationSchedule.status = CANCELLED` (or `EXECUTED` for a matching published revision). The Article is never mutated, and no `PUBLISH_FAILED` audit event is written. A worker encountering a non-`PENDING` schedule performs no writes.

**Genuine Terminal Failures (only while the Article is validly `SCHEDULED` and not deleted):**
- Missing approved revision.
- Revision or version mismatch (`expectedArticleVersion` mismatch).
- Invalid article state / irrecoverable data validation error.
- BullMQ retry exhaustion for a still-`SCHEDULED` Article.
*Result:* `PublicationSchedule.status = FAILED`, `Article.status = FAILED_TO_PUBLISH`, Article version increment, and a `PUBLISH_FAILED` audit event with scheduler metadata. These updates are conditional and transactional: a zero-row conditional schedule update is a concurrency outcome and must not move the Article.

**Error Classification:**
- `WorkflowService` converts every terminal business outcome into `TerminalPublicationError`.
- `SchedulingProcessor` treats only `TerminalPublicationError` as terminal.
- All other errors, including messages containing words such as `Invalid`, `not found`, `CANCELLED`, `VERSION_MISMATCH`, or `no longer PENDING`, are treated as transient and re-thrown so BullMQ retry/backoff applies.
- No generic `Error` may become terminal because its text resembles a business rejection.

## 12. FAILED_TO_PUBLISH
`FAILED_TO_PUBLISH` is a business-level terminal failure state.
- Retryable infrastructure failures should **not** immediately move the Article to `FAILED_TO_PUBLISH`.
- Only once the retry policy is fully exhausted (e.g., max attempts reached), or a genuine terminal business validation fails while the Article is still `SCHEDULED`, should the system transition the article to `FAILED_TO_PUBLISH` via a controlled, audited workflow.
- A stale, cancelled, soft-deleted, or already-published schedule must never produce `FAILED_TO_PUBLISH` or `PUBLISH_FAILED`.

## 13. Audit Actor
Based on an inspection of the `AuditLog` Prisma schema, `actorId` is nullable (`actorId String?`) and backed by an optional foreign key (`actor User?`).
- Since `actorId` is not mandatory, the system will use a **system actor representation** by setting `actorId = null` and identifying the actor via the `metadata` field (e.g., `metadata: { system: 'scheduler' }`).
- This avoids the overhead of managing a fake system user row in the database while preserving auditability.

## 14. Time / Timezone
- All stored timestamps use PostgreSQL `timestamptz` / UTC semantics.
- The API strictly accepts ISO-8601 timestamps (UTC).
- The backend performs all scheduling comparisons (`Date.now()`, `scheduledFor`) in UTC.
- The minimum scheduling lead time remains 5 minutes.
- Past-due schedules are immediately eligible for safe execution.
- The frontend is responsible for converting timestamps for local timezone display.

## 15. Notifications
Phase 7 will **NOT** introduce a new notification subsystem, preserving the Phase 8 roadmap.
- The system will persist the failure state, write audit events, and expose the state through the existing CMS/article data model.
- The acceptance criterion is an **editor-visible persisted failure signal** (e.g., the article displaying `FAILED_TO_PUBLISH` status).
- Phase 8 will own the actual notification delivery mechanisms.

## 16. Frontend Scope
The Phase 7 frontend scope incorporates a minimal schedule-creation UI as a controlled scope amendment:
- **Minimal Schedule Creation UI:** Authorized editors can trigger a "Schedule..." action from the WorkflowPanel on `APPROVED` articles, opening a datetime modal to specify a future publication timestamp.
- **Backend-Enforced Validation:** Datetime parsing and minimum lead-time validation ($\ge 5$ minutes in UTC) are strictly enforced by the backend API, regardless of frontend input validation.
- **Schedule Display and Cancellation:** Display the scheduled state and timestamp on the article in the CMS editor, and permit authorized editors to cancel pending schedules.
- **Failure Visibility:** Editor-visible persisted signals for failure (`FAILED_TO_PUBLISH`) with action to reopen to draft, and audit visibility for missed schedules where supported by the existing CMS.
- **No In-Place Rescheduling:** Rescheduling requires explicit cancellation followed by creating a new schedule.
- **No Redesign:** No full CMS redesign, complex multi-calendar views, or new notification delivery subsystems are introduced.

### Scope Amendment Note (Phase 7 Corrections Gate)
- **Status:** ACCEPTED (Controlled Scope Change).
- **Amendment Details:** While earlier drafts deferred the schedule-creation modal, minimal scheduling controls (Schedule button, datetime modal, and status/cancellation actions) in `WorkflowPanel` are formally accepted into Phase 7 scope. Datetime validation and minimum lead-time validation remain authoritatively enforced by the backend.

## 17. Test Plan (Definition of Done)
**Unit Tests:**
- Minimum lead time validation (must be $\ge$ 5 minutes).
- Invalid workflow states (cannot schedule a draft).
- Schedule creation logic (returns correct DB payload).
- Schedule cancellation logic.
- Stale version rejection (worker aborts).
- Stale revision rejection (worker aborts).
- Worker idempotency (concurrent executions yield 1 success).
- Missed schedule logic (flags `SCHEDULE_MISSED`).
- Retryable vs Terminal failure categorization.
- Persistence of Article `FAILED_TO_PUBLISH`, schedule failure state, and the corresponding audit event.
- `FAILED_TO_PUBLISH` to `DRAFT` reopening through WorkflowService.
- Stale/orphan `PENDING` schedules for DRAFT/APPROVED/ARCHIVED/soft-deleted/missing Articles reconcile to `CANCELLED` with no Article mutation and no `PUBLISH_FAILED`.
- Already-published intended revision reconciles to `EXECUTED`; a different revision reconciles to `CANCELLED`.
- `recordTerminalFailure()` never overwrites `CANCELLED`, `EXECUTED`, or `FAILED` schedules.
- `recordTerminalFailure()` with an Article that has left `SCHEDULED` cancels instead of failing the Article.
- Conditional schedule updates losing a race do not mutate the Article.
- Cancellation, edit, and reopen re-check Article state under lock and never overwrite a concurrent publication.
- Soft deletion of a `SCHEDULED` article is rejected; non-scheduled deletion remains allowed.
- Completed-job reconciliation and remove-before-readd behavior.
- Bounded overdue recovery invokes state-aware terminal handling.
- Processor re-throws transient errors with terminal-looking text.

**Integration Tests:**
- DB commit followed by enqueue.
- Enqueue failure repaired by safety sweep.
- Recovery of missing BullMQ jobs before scheduled time, preserving remaining delay.
- Duplicate enqueue with the exact same job ID is safely handled.
- Worker/Cancel race condition (cancel wins or worker wins, system remains consistent).
- Worker/Sweep race condition.
- Cancellation with Redis unavailable (DB state still rejects worker).
- Successful scheduled publication and public visibility.
- Terminal failure persistence without accidental transaction rollback.
- Stale schedule reconciliation for soft-deleted and already-published Articles.
- Completed-job reconciliation keyed by intended revision.
- Soft-delete policy prevents an executable dangling schedule.

**E2E Tests:**
*(All tests must use mocked/fake time rather than waiting real minutes)*
- `APPROVED` article $\rightarrow$ scheduled $\rightarrow$ automatic publication $\rightarrow$ public article visible.
- Cancellation prevents publication.
- Missed schedule publishes after simulated time recovery.
- Stale schedule cannot publish the wrong revision (simulate edit after scheduling).
- Editing a scheduled article reverts it to `DRAFT` and a worker does not publish.
- An orphan `PENDING` schedule for a DRAFT or soft-deleted Article is cancelled without `PUBLISH_FAILED`.
- Already-published intended revision reconciles to `EXECUTED` without a duplicate `PUBLISH` event.
- Deleting a `SCHEDULED` article returns `409 Conflict`.

## 18. Explicit Out of Scope
- Direct BullMQ mutations of the Article table (WorkflowModule remains sole authority).
- Notifications or Emails delivery subsystem (Phase 8).
- Rescheduling an article in-place (cancellation followed by new schedule required).
- Comprehensive calendar/planner views or third-party scheduling widgets.
- Automatic un-publishing / content expiration.
- Overhauling CMS layout or styling outside minimal workflow controls.

## 19. Implementation Readiness Verdict
**APPROVED FOR IMPLEMENTATION (AMENDED)**
Controlled scope changes for minimal CMS scheduling UI and terminal failure audit requirements are formally integrated.
