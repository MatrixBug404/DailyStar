# Phase 8 — Notifications Technical Specification (v1.0)

**Status:** APPROVED FOR IMPLEMENTATION
**Date:** 2026-10-24
**Baseline commit:** `bfeeb0f251255b8eafee2ea94d7c8cb1b867d5dd` (`feat: complete phase 7 scheduled publishing`)
**Primary source of scope:** `dailystar_architecture.md` §13 (Phase 8 definition, lines 633–640)
**Companion documents:** `phase8-requirements.md`, `phase8-tasks.md`

> This specification is an approved technical contract. Phase 8 has been approved for implementation using the recommended defaults, accepted concurrency limitations, and authorized M1.

---

## 1. Objective

Deliver the officially defined Phase 8 capability: users are notified of relevant editorial events through durable notification records, an in-app notification list, and email dispatch for four events — article submitted for review, approved, rejected, and scheduled-publish failure.

Phase 8 must integrate with the existing editorial workflow without altering it: `WorkflowModule` remains the single authority for `Article.status`, and notification/email failures never affect a committed transition.

---

## 2. Source of Truth and Boundaries

### 2.1 Verified repository baseline (inspected at `bfeeb0f`)

| Fact | Evidence |
|---|---|
| Phase 8 is Notifications | `dailystar_architecture.md:633–640`; `docs/architecture/README.md:30` |
| Phase 7 explicitly deferred notification delivery to Phase 8 | `phase7-technical-spec-v1.0.md:190–194`, `:260` |
| No notification implementation exists | No `Notification` model in `schema.prisma` (models end at `PublicationSchedule`, `:322`); zero `notif` matches in `apps/api/src`; no email dependency in `apps/api/package.json` |
| `WorkflowService` is the sole status authority | `workflow.service.ts` all transitions; architecture guideline #8 (`dailystar_architecture.md:711`) |
| Editorial transitions and audit actions | `submitReview` (`:49`, `SUBMIT_FOR_REVIEW`), `startReview` (`:80`), `requestChanges` (`:112`, `REQUEST_CHANGES`), `reject` (`:144`, `REJECT`), `approve` (`:176`, `APPROVE`), `publish` (`:223`, `PUBLISH`) |
| Terminal publish failures | `recordTerminalFailure` (`:560`, audit at `:650`) and three inline branches in `executeScheduledPublish`: version mismatch (`:752`, audit `:769`), revision mismatch (`:786`, audit `:806`), approved revision missing (`:823`, audit `:844`) |
| Scheduling failure callers | `scheduling.service.ts:178`, `:273`, `:406` all call `workflowService.recordTerminalFailure` |
| Editor permissions | `article.start-review` seeded to `editor` and `admin`; `article.submit-review` to all three roles (`seed.ts:73–161`) |
| Article ownership | `Article.primaryAuthorId` (`schema.prisma:146`, relation `:161`) |
| Audit actor convention for system events | `actorId: null`, `metadata.system = 'scheduler'` (`phase7-technical-spec-v1.0.md:177–180`; `workflow.service.ts:650–652`) |
| RBAC resolution pattern | `PermissionResolverService` filters inactive users (`permission-resolver.service.ts:26`) |
| BullMQ pattern | `BullModule.registerQueue` in `scheduling.module.ts:10–24`; shared connection factory `config/bull-connection.ts`; queue `article-publishing` |
| Cron pattern | `@Cron(CronExpression.EVERY_5_MINUTES)` in `scheduling.service.ts:325` |
| Pagination envelope | `PaginatedResponse<T>` in `packages/types/src/index.ts:29–34` |
| CMS API client | `useCmsApi()`/`cmsFetch` in `apps/web/lib/cms-api.ts` |
| CMS protected shell | `apps/web/app/cms/(protected)/layout.tsx` |
| Runtime | Node 22 in CI (`.github/workflows/ci.yml`), so global `fetch` is available |
| No commit hooks / no mail service | verified: no `.husky`, no SMTP container in `infrastructure/docker/docker-compose.local.yml` |

### 2.2 Contract boundaries

- `Article.status` is mutated only by `WorkflowService` (`dailystar_architecture.md:711`). Notifications are **never** a transition authority and never write `Article`.
- `PublicationSchedule` remains an execution-intent record only; notification logic must not reinterpret or alter scheduling state.
- Email dispatch is a side effect of committed transitions. It is not a workflow step, not retried by the scheduler, and not part of the transition response.
- No second publication path, no bypass of four-eyes, revision integrity, locking order, or `expectedVersion`.

### 2.3 Classification legend

- **A — Reuse:** existing behavior consumed unchanged (RBAC, audit, workflow service contract, pagination envelope).
- **B — New capability:** additive code/data with no prior equivalent (`Notification`, notifications API, email pipeline, CMS list).
- **C — Controlled modification of an earlier-phase contract:** the `WorkflowService` instrumentation in M4 (Phase 3/7-locked service). Behavior-preserving for the lifecycle; every C item states compatibility impact and required tests.

---

## 3. Scope

### 3.1 In scope

Everything in `phase8-requirements.md` D1–D8: schema/migration, notifications API, email pipeline, four workflow trigger integrations, CMS in-app list, tests, configuration.

### 3.2 Out of scope

See `phase8-requirements.md` "Explicitly Out of Scope". Repeated here in summary: preferences/opt-out, push/SMS/webhooks, realtime delivery, deletion/archival, admin broadcast, HTML templates/i18n, workflow changes, AI/comments/analytics integrations.

---

## 4. Deliverables

| ID | Deliverable | Class | Milestone |
|---|---|---|---|
| D1 | `Notification` + `NotificationType` + `NotificationEmailStatus`; additive migration | B | M1 |
| D2 | `v1/notifications` API: list, unread count, mark read, read-all | B | M2 |
| D3 | Provider abstraction, log + Postmark adapters, `notification-email` queue, reconciliation sweep | B | M3 |
| D4 | Four `WorkflowService` trigger integrations, savepoint containment, post-commit dispatch | C | M4 |
| D5 | Recipient resolution (editors by `article.start-review`; authors by `primaryAuthorId`) | B | M2 (shared by M4) |
| D6 | CMS `/cms/notifications` page + nav unread badge | B | M5 |
| D7 | Unit/integration/E2E suites incl. mocked provider | B | M1–M6 |
| D8 | Configuration, `.env.example`, startup validation, secret redaction | B | M3 |

---

## 5. Domain Model

### 5.1 Proposed Prisma schema (additive only)

```prisma
// ─── Phase 8: Notifications ─────────────────────────────────────────────────

enum NotificationType {
  ARTICLE_SUBMITTED_FOR_REVIEW
  ARTICLE_APPROVED
  ARTICLE_REJECTED
  ARTICLE_FAILED_TO_PUBLISH
  // ARTICLE_CHANGES_REQUESTED is PROPOSED (OD-2), not approved scope.
  // Include it only if OD-2 is explicitly approved; otherwise omit it from
  // the schema, the migration's PostgreSQL enum, and shared types.
}

enum NotificationEmailStatus {
  PENDING
  SENT
  FAILED
  SKIPPED
}

model Notification {
  id             String                  @id @default(uuid())
  recipientId    String
  type           NotificationType
  /// Persisted display snapshot so the list does not depend on mutable article state.
  title          String                  @db.VarChar(200)
  body           String                  @db.Text
  articleId      String?
  /// Unique per recipient; enforces duplicate suppression. Format in §6.3.
  dedupeKey      String                  @db.VarChar(200)
  /// Event-specific structured metadata (e.g., scheduleId, failure reason).
  data           Json?
  readAt         DateTime?
  emailStatus    NotificationEmailStatus @default(PENDING)
  emailAttempts  Int                     @default(0)
  emailLastError String?                 @db.Text
  emailSentAt    DateTime?
  createdAt      DateTime                @default(now())
  updatedAt      DateTime                @updatedAt

  recipient User     @relation("NotificationRecipient", fields: [recipientId], references: [id], onDelete: Cascade)
  article   Article? @relation("ArticleNotifications", fields: [articleId], references: [id], onDelete: SetNull)

  @@unique([recipientId, dedupeKey])
  @@index([recipientId, readAt])
  @@index([recipientId, createdAt])
  @@index([emailStatus, createdAt])
  @@index([articleId])
  @@map("notifications")
}
```

Additive relations on existing models (no columns):
- `User`: `notifications Notification[] @relation("NotificationRecipient")`
- `Article`: `notifications Notification[] @relation("ArticleNotifications")`

**OD-2 conditionality (schema):** `ARTICLE_CHANGES_REQUESTED` is a proposed scope amendment, not approved scope. If OD-2 is not approved before M1, `NotificationType` contains exactly the four official values above and the member, its PostgreSQL enum value, and any shared-type entry are omitted entirely.

### 5.2 Design rationale

- **Persisted title/body:** notification list stays meaningful after article edits; avoids joining revisions and avoids rendering client-supplied content.
- **`articleId` optional with `SetNull`:** notifications survive article soft deletion (articles are soft-deleted today; `SetNull` is defensive). `data` carries the deep-linkable `articleId` snapshot if the FK is ever nulled.
- **`dedupeKey` unique per recipient:** durable, database-enforced duplicate suppression (INV8-09, AC-7).
- **Email fields on the same row:** notification record doubles as the outbox. There is no separate outbox table; the in-app row is the source of truth and email is a delivery attribute of it.
- **No `status` for in-app read:** `readAt` nullable timestamp is sufficient; read is idempotent.
- **No hard-delete or expiry:** retention for MVP (OD-7).

### 5.3 Migration and data safety

- One forward-only migration named `phase8_notifications` following the repository convention (`<timestamp>_phase8_notifications/migration.sql`).
- Contains only: two enums, one table, indexes, and FKs. No `ALTER TABLE ... DROP`, no backfill, no destructive statements.
- Existing rows are unaffected: no new non-null columns are added to existing tables.
- Generated via `pnpm --filter @dailystar/api prisma:migrate:dev`; applied in environments via `prisma:migrate:deploy`.
- Rollback strategy: application rollback is safe (the table is unused by prior versions). Reverting the schema requires a new forward migration; destructive rollback requires explicit approval (architecture guideline #15).
- Deployment order: migration → API deploy → web deploy. The API tolerates an empty table and unwired triggers.

---

## 6. Notification Events, Recipients, and Duplicate Suppression

### 6.1 Event mapping

| Event | Type | Trigger (verified location) | Recipients | Dedupe key |
|---|---|---|---|---|
| Article submitted for review | `ARTICLE_SUBMITTED_FOR_REVIEW` | `WorkflowService.submitReview` (`workflow.service.ts:49`), after the audit write in the same transaction | Active users with `article.start-review`, excluding the actor | `article-submitted:{articleId}:{newVersion}` |
| Article approved | `ARTICLE_APPROVED` | `WorkflowService.approve` (`:176`) | `Article.primaryAuthorId`, excluding the actor (four-eyes makes this impossible in practice) | `article-approved:{articleId}:{newVersion}` |
| Article rejected | `ARTICLE_REJECTED` | `WorkflowService.reject` (`:144`) | `Article.primaryAuthorId`, excluding the actor | `article-rejected:{articleId}:{newVersion}` |
| Changes requested — **CONDITIONAL, only if OD-2 is approved; otherwise omit the type entirely** | `ARTICLE_CHANGES_REQUESTED` | `WorkflowService.requestChanges` (`:112`) | `Article.primaryAuthorId`, excluding the actor | `article-changes-requested:{articleId}:{newVersion}` |
| Scheduled publish failed | `ARTICLE_FAILED_TO_PUBLISH` | `recordTerminalFailure` (`:560`) **and** the three `executeScheduledPublish` terminal branches (version mismatch `:752`, revision mismatch `:786`, approved revision missing `:823`) | Active users with `article.start-review` (system actor excluded) | `article-publish-failed:{scheduleId}` |

**Important verified nuance:** there are **four** code paths that produce `FAILED_TO_PUBLISH`/`PUBLISH_FAILED`, not one. The notification helper must be invoked in all four, inside the existing transaction. `recordTerminalFailure` is used by the worker/sweep paths; `executeScheduledPublish` validates and fails inline for version/revision/revision-missing cases. Missing any path would violate AC-4.

**OD-2 conditionality (events):** `ARTICLE_CHANGES_REQUESTED` is a proposed amendment, not an approved event. Unless OD-2 is explicitly approved before M1, the enum member is omitted from the schema and migration and `requestChanges` performs no notification side effect; M4 wires only the four official events.

### 6.2 Recipient resolution (OD-1 recommendation)

Editors are resolved by **permission**, not role name:

```sql
-- conceptual Prisma query, executed inside the workflow transaction
SELECT u.id, u.email
FROM users u
WHERE u."isActive" = true
  AND EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON rp."roleId" = ur."roleId"
    JOIN permissions p ON p.id = rp."permissionId"
    WHERE ur."userId" = u.id AND p.name = 'article.start-review'
  );
```

Rules:
- Exclude the acting user (`user.sub`).
- Exclude users who are inactive (`isActive = false`) at trigger time from both in-app and email delivery; a row whose recipient becomes inactive later is retained and its email is `SKIPPED` (§7.4).
- Author notifications target `article.primaryAuthorId`; the author is included even if their role also holds `article.start-review` (single row per recipient/event due to the unique key).
- For scheduler failures there is no human actor; the recipient set is the editor set. If a notification's recipient has no email, the in-app row is still created and email is `SKIPPED`.
- Resolution is read-only inside the transaction; no locks are taken on RBAC tables.

**PROPOSED rationale:** permissions are the contract used by every guard; role names are mutable data. This automatically includes `admin` (which holds `article.start-review`) and any future reviewer role without code change. Alternative (rejected for v1): hardcode `role.name in ('editor','admin')`.

### 6.3 Duplicate suppression

- Unique constraint `(recipientId, dedupeKey)` is the sole enforcement; application-level "check then insert" is not trusted.
- Inserts use `createManyAndReturn({ skipDuplicates: true })` (Prisma 6.2, PostgreSQL) or `upsert` fallback if the runtime combination proves unsupported — decision recorded during M1 implementation, not a behavior change.
- Dedupe keys include the resulting `Article.version` for workflow events, so a legitimate later cycle (edit → resubmit → re-approve) produces a new notification while retries/replays of the same transition do not.
- Scheduled failure keys use `scheduleId`: a schedule can reach the terminal failure state at most once (conditional `status = PENDING` updates in every path). A subsequent schedule for the same article is a different ID and correctly notifies again.
- Email duplicate suppression uses `jobId = notification.id` on the queue; provider-level exactly-once is impossible, so delivery is documented as **at-least-once** with notification-level dedupe (INV8-09).

---

## 7. Atomicity, Transaction Integration, and Failure Containment

### 7.1 Requirement

Notification creation is atomic with the workflow transition (same transaction), yet notification failure must not roll back the transition (INV8-02/03). These two constraints require **savepoint containment**, not a separate transaction and not a raw try/catch (a Postgres error aborts the enclosing transaction unless a savepoint is used).

### 7.2 Integration pattern inside `WorkflowService`

```ts
// existing transaction begins …
const updated = await tx.article.update({ ... });          // unchanged
await this.auditService.log({ ... }, tx);                  // unchanged

const created = await this.notifications.createForEventSafely(tx, {
  type: 'ARTICLE_SUBMITTED_FOR_REVIEW',
  articleId: article.id,
  actorId: user.sub,
  dedupeKey: `article-submitted:${article.id}:${updated.version}`,
  title: 'Article submitted for review',
  body: `“${revisionTitle}” was submitted for review by ${actorLabel}.`,
  data: { articleVersion: updated.version },
});
return { article: updated, notificationIds: created.map(n => n.id) };
// transaction commits

// after commit, outside the transaction:
await this.notifications.dispatchEmailsSafely(notificationIds);
return article; // unchanged public shape
```

`createForEventSafely` implementation contract:

1. Resolve recipients inside the transaction (read-only).
2. If none, return `[]` without touching the savepoint.
3. `SAVEPOINT notification_create`.
4. Insert rows with duplicate suppression.
5. `RELEASE SAVEPOINT notification_create`.
6. On any error: `ROLLBACK TO SAVEPOINT notification_create`, log a structured warning with the article/event IDs (no PII, no secrets), release the savepoint, return `[]`.
7. `WorkflowService` additionally wraps the call in a defensive `try/catch` for implementation-level failures that occur before SQL. This is defense in depth; correctness of the transition life depends on the savepoint, not the catch.

### 7.3 Per-transition changes (all Class C, behavior-preserving)

- `submitReview`: capture the new article version, resolve a title snapshot from `currentRevisionId` (inside tx), call the helper before returning.
- `approve`: same pattern; recipients = author.
- `reject`: same pattern; recipients = author.
- `requestChanges`: only if OD-2 is approved; same pattern; recipients = author.
- `recordTerminalFailure`: after the existing `PUBLISH_FAILED` audit write, call the helper for editors with `dedupeKey: article-publish-failed:{scheduleId}` and `data.reason`. Return the article as today; post-commit dispatch is best-effort.
- `executeScheduledPublish`: each of the three inline failure branches calls the same helper after its audit write. Because the method throws `TerminalPublicationError` after commit, the implementation must dispatch emails **before** throwing:

```ts
const result = await prisma.$transaction(...);
await this.notifications.dispatchEmailsSafely(result.notificationIds ?? []);
if (!result.success) throw new TerminalPublicationError(result.error);
return result.article;
```

### 7.4 Post-commit dispatch

- Dispatch is never inside `prisma.$transaction`.
- `dispatchEmailsSafely(ids)`:
  1. Returns immediately for empty lists.
  2. Loads notifications whose `emailStatus = PENDING` and re-reads each recipient's current `isActive` and `email`. Users who were inactive at notification creation never have a row (§6.2), so every loaded row belongs to a recipient who was eligible when it was created.
  3. Applies the dispatch-time eligibility outcomes explicitly. All `SKIPPED` writes are conditional from `PENDING`; a zero-row result means another actor resolved the row, so no enqueue is attempted:
     - **Deactivated after creation:** the row is retained and `emailStatus` is set to `SKIPPED` via conditional `updateMany`; no email is sent.
     - **Active but without an email address:** the in-app row is retained and `emailStatus` is set to `SKIPPED` via the same conditional update; no email is sent.
     - **Active with an email address:** enqueue one job per notification with `jobId = notification.id`.
  4. Catches enqueue errors, logs, and leaves rows `PENDING` for the reconciliation sweep — the transition is already committed (AC-6).
- The workflow transition HTTP response never awaits provider I/O; it awaits only queue enqueue attempts (bounded by Redis availability and caught).

---

## 8. Email Delivery Pipeline

### 8.1 Queue and worker

`NotificationsModule` registers:

```ts
BullModule.registerQueue({
  name: 'notification-email',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
  },
})
```

- Connection options come from the existing `createBullConnectionOptions` root config; no new Redis configuration.
- `NotificationEmailProcessor extends WorkerHost` processes `job.data.notificationId`.
- Worker algorithm:
  1. Load notification. Missing → log and complete (nothing to send).
  2. **Pre-send re-check (immediately before sending):** fresh reload of the notification and recipient; never trust job-payload state.
     - Notification missing or status terminal (`SENT`, `SKIPPED`, or `FAILED`) → complete without a provider call.
     - Recipient inactive or without an email address → conditional `PENDING → SKIPPED` (§8.2); complete without sending. A zero-row result also completes without sending.
     - Recipient active with an email address → continue.
  3. Send via `EmailProvider` outside any database transaction. On success, conditional `PENDING → SENT` with `emailSentAt = now` and `emailAttempts++`. A zero-row result does not overwrite the terminal state; log a discrepancy.
  4. On failure, conditional `PENDING` update of `emailAttempts++` and `emailLastError = message` (provider status/message only, never token/body). A zero-row result completes without retry; otherwise rethrow so BullMQ applies backoff/retry.
  5. BullMQ retry exhaustion leaves `PENDING`; reconciliation (§8.2) resolves it.
- An active job is **not** evidence of delivery. Only provider success or a completed BullMQ job supports `SENT`.
- Email subject/body use the persisted `title`/`body` plus a stable prefix (`[DailyStar]`); plain text only.

### 8.2 Delivery-state rules and reconciliation

**State model.** `PENDING` is the only non-terminal state. The only permitted transitions are:
- `PENDING → SENT` on delivery evidence: provider success or a completed BullMQ job.
- `PENDING → SKIPPED` when an undelivered email's recipient is ineligible (inactive or no email address).
- `PENDING → FAILED` when an eligible delivery exhausts its retry/recovery policy; only the sweep writes `FAILED`.

`SENT`, `SKIPPED`, and `FAILED` are terminal for Phase 8 and immutable (no automatic resurrection; manual replay is out of scope). `SKIPPED` is ineligibility, not failure; `FAILED` is exhausted eligible delivery, not ineligibility.

**Conditional writes.** All delivery-state writes, including the dispatcher (§7.4), worker (§8.1), and reconciler, use compare-and-set updates: `WHERE id = :id AND emailStatus = 'PENDING'` (Prisma `updateMany`). A zero-row result means another actor already resolved the row; reload and stop. A stale write never overwrites a terminal state. No database transaction or row lock is held across provider I/O.

**Reconciliation sweep.** `@Cron(CronExpression.EVERY_5_MINUTES)` in a dedicated `NotificationEmailReconciler` (config-gated), mirroring the Phase 7 sweep philosophy: **read database state first, communicate with Redis second, never hold DB locks while talking to Redis**. It selects a bounded batch (default 200) of notifications with `emailStatus = PENDING` and `createdAt < now - staleMinutes` (default 10). Selection is based only on delivery state and age, **not** current recipient eligibility, so a row stranded by a crash between commit and first dispatch is included.

**Strict precedence.** For each row, evaluate in this order and stop at the first applicable outcome:

| Observed job state | Reconciler action | DB transition |
|---|---|---|
| Redis unavailable or inspection inconclusive | Leave `PENDING`; do not increment `emailAttempts`; retry next sweep | None |
| Completed | `SENT` with `emailSentAt`; never resend. For a `PENDING` row, completed delivery evidence wins over current recipient eligibility | `PENDING → SENT` |
| Active, waiting, delayed, or failed with retries remaining | Leave `PENDING` and the job untouched; the worker owns the pre-send decision (including for an inactive recipient). A live job is not delivery evidence; never reset, remove, or interrupt it | None |
| Exhausted-failed (`attemptsMade >= attempts`) | No worker remains. If the recipient is now inactive or has no email, `SKIPPED`; otherwise `FAILED` with `emailLastError` | `PENDING → SKIPPED` or `PENDING → FAILED` |
| Missing | If the recipient is inactive or has no email, `SKIPPED` and no enqueue; if active with email and `emailAttempts >= EMAIL_MAX_ATTEMPTS` (default 5), `FAILED`; otherwise enqueue with the same deterministic `jobId`. If a retained failed job blocks re-enqueue, remove it only after verifying removal (Phase 7 pattern), then re-add; on failure defer to the next sweep | `PENDING → SKIPPED` or `PENDING → FAILED`, or none |

The sweep is also the crash-recovery path: because it selects `PENDING` rows by age, a notification stranded before dispatch is resolved by the table above and is not left `PENDING` indefinitely while Redis and the worker are healthy. An inactive recipient whose job is observed live remains `PENDING` until the worker's pre-send check records `SKIPPED`.

### 8.3 Documented limitations

- **In-flight provider call:** it cannot be cancelled. If the recipient becomes inactive or loses their email address after the worker's pre-send check but during the provider call, the email may still be delivered; provider success is recorded as `SENT` (conditional from `PENDING`), not `SKIPPED`. If a terminal-state race prevents that update, the row remains in its existing terminal state and the discrepancy is logged for manual review.
- **Job-state observation:** BullMQ inspection and the database write are not atomic. A job observed missing or exhausted can become live before the conditional write. The "never mutate an observed live job" rule and the worker's pre-send re-check narrow this window, but the conditional guard can only prevent overwriting an existing terminal state, not a terminal write that wins before the worker's success update. Eliminating that last window would require a claim/lease state or a database lock across provider I/O, neither of which is part of Phase 8.
- **Completed evidence vs terminal state:** a completed job upgrades only a `PENDING` row to `SENT`. If the row is already terminal `SKIPPED` or `FAILED`, the terminal state wins and is not overwritten; the rare discrepancy is logged for manual review. Terminal-state integrity takes precedence over reconstructing delivery history.
- **At-least-once delivery:** as stated in §6.3, a stalled/redelivered BullMQ job may produce a duplicate send. Notification-level dedupe and terminal guards prevent duplicate rows and terminal overwrites, not duplicate provider calls; exactly-once delivery across an external provider is not guaranteed.
- **Live jobs remain `PENDING`:** there is no timeout-based forced `SKIPPED` for an active job. The worker/BullMQ must resolve it.

---

## 9. Email Provider Abstraction and Configuration

### 9.1 Interface

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
```

### 9.2 Providers

- **`LogEmailProvider` (default):** logs a structured line at `log` level: recipient, subject, notification/event correlation ID. Never logs the provider token. Resolves successfully. Used for local development, CI, and tests.
- **`PostmarkEmailProvider` (recommended production adapter):**
  - `POST https://api.postmarkapp.com/email` using Node 22 global `fetch`.
  - Headers: `X-Postmark-Server-Token`, `Content-Type: application/json`, `Accept: application/json`.
  - Body: `{ From, To, Subject, TextBody, Tag: 'dailystar-notification' }`.
  - 10-second timeout via `AbortSignal.timeout`.
  - Non-2xx responses throw an error containing status code and Postmark error code only (never the token or full request body). 5xx/429 are retried by BullMQ; 4xx other than 429 will exhaust retries and become `FAILED` via the reconciliation sweep.
- **SES (documented alternative):** requires adding `@aws-sdk/client-sesv2`; deferred unless the team prefers AWS-native delivery. The interface makes this a drop-in adapter change.

No new runtime dependency is required for the recommended path (INV8-12).

### 9.3 Configuration (additive to `configuration.ts` and `.env.example`)

| Key | Default | Validation |
|---|---|---|
| `EMAIL_PROVIDER` | `log` | one of `log`, `postmark` |
| `EMAIL_FROM` | `DailyStar <notifications@dailystar.local>` | non-empty |
| `POSTMARK_SERVER_TOKEN` | empty | required iff `EMAIL_PROVIDER=postmark`; otherwise ignored |
| `EMAIL_MAX_ATTEMPTS` | `5` | integer ≥ 1 |
| `EMAIL_RECONCILE_ENABLED` | `true` | boolean |
| `EMAIL_RECONCILE_BATCH_SIZE` | `200` | integer ≥ 1, bounded (e.g., ≤ 1000) |
| `EMAIL_RECONCILE_STALE_MINUTES` | `10` | integer ≥ 1 |

Behavior:
- Provider selection happens at module initialization via a factory; invalid configuration fails application startup with an explicit message (AC-12).
- In `NODE_ENV=production` with `EMAIL_PROVIDER=log`, the API logs a prominent startup warning that email delivery is disabled.
- `.env.example` contains placeholders only. No real token enters the repository, fixtures, tests, or CI logs.
- Tests force `EMAIL_PROVIDER=log` (or inject a capture provider); CI performs no network I/O.

### 9.4 Local development

- Default `log` provider prints notifications to the API console; no SMTP container, no external account required (verified: the local compose stack has Postgres/Redis/MinIO only).
- A Mailpit/MailHog container is **PROPOSED deferred**; it adds infra without changing the contract.

---

## 10. Notifications API Design

### 10.1 Routes (all require `AuthGuard`; all scoped to `req.user.sub`)

| Method | Path | Purpose | Response |
|---|---|---|---|
| GET | `v1/notifications` | List own notifications | `PaginatedResponse<NotificationSummary>` |
| GET | `v1/notifications/unread-count` | Unread badge | `{ unread: number }` |
| PATCH | `v1/notifications/:id/read` | Mark one read (idempotent) | `NotificationSummary` (200) |
| POST | `v1/notifications/read-all` | Mark all own unread read | `{ updated: number }` (200) |

No `@RequirePermission` decorator: every authenticated user may receive notifications. Ownership replaces permission gating. Foreign IDs return 404 (IDOR convention).

### 10.2 Query DTO

`NotificationListQueryDto`:
- `page?: number` — integer ≥ 1, default 1.
- `limit?: number` — integer 1–100, default 20; out-of-range or non-numeric → HTTP 400, never clamped (consistent with Phase 6 D3).
- `unreadOnly?: boolean` — optional; only `true` filters to `readAt IS NULL`.

Ordering: `createdAt DESC, id ASC` for deterministic pagination.

### 10.3 Response shape

```ts
export interface NotificationSummary {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  articleId: string | null;
  readAt: string | null;
  createdAt: string;
}
```

`emailStatus`, `dedupeKey`, and internal error fields are not exposed. `data` is not exposed in v1 (article deep-link uses `articleId`).

### 10.4 Read-state semantics

- `readAt` is set once; repeated calls are no-ops returning the current object.
- `read-all` sets `readAt = now` for all unread rows of the caller and returns the count.
- Unread count is computed from the database; no cache in Phase 8.
- Mark-read is not audited (it is not an editorial state change; audit remains exactly one row per workflow transition).

### 10.5 Error contracts

- `401` unauthenticated (existing AuthGuard behavior).
- `400` invalid pagination/query values.
- `404` notification not found **or** owned by another user (same response — no existence leak).
- No new error codes are introduced into workflow endpoints.

---

## 11. CMS In-App Notification List

### 11.1 Routes and components

| Path | Purpose |
|---|---|
| `apps/web/app/cms/(protected)/notifications/page.tsx` | Notification list page (client component, uses session) |
| `apps/web/app/cms/components/NotificationList.tsx` | List rendering, read actions, empty/loading/error states |
| `apps/web/app/cms/(protected)/layout.tsx` (modify) | Add “Notifications” nav link with unread count |

### 11.2 Behavior

- On mount: fetch `v1/notifications?page=1&limit=20` and `v1/notifications/unread-count` via `useCmsApi()`.
- List item shows: type label, persisted title, persisted body, relative/absolute timestamp, unread dot, link to `/cms/articles/{articleId}` when present.
- Per-item “Mark read” calls `PATCH .../:id/read` and updates local state (optimistic or refetch — implementation choice within M5).
- “Mark all read” calls `POST .../read-all` and updates the badge.
- Empty state: “No notifications yet.” Error state: inline retry.
- Rendering is text-only (`{notification.title}`, `{notification.body}`); no `dangerouslySetInnerHTML`.
- No polling, websocket, or SSE in Phase 8 (OD-6). Badge refreshes on navigation/mount.

### 11.3 Accessibility and UX constraints

- Semantic list (`<ul>/<li>`), buttons with accessible names, unread state conveyed by text/`aria-label` in addition to color.
- Page is inside the existing protected layout; no new auth mechanism.
- No global CMS redesign; minimal styling consistent with existing CMS pages.

### 11.4 Protected user work

The unstaged dirty-form/beforeunload guard in `apps/web/app/cms/components/ArticleEditor.tsx` is existing uncommitted work. Phase 8 M5 must not depend on, absorb, or modify that hunk without separate review. The same applies to the other protected work listed in the Phase 8 discovery report.

---

## 12. Authorization and Security

- **User scoping:** every query includes `recipientId = req.user.sub`; no admin override endpoint exists in Phase 8.
- **IDOR:** missing vs foreign IDs indistinguishable (404).
- **Injection:** Prisma parameterized queries; no raw SQL needed for notifications except the savepoint statements (constant strings).
- **Secrets:** `POSTMARK_SERVER_TOKEN` read only in the provider factory; never logged, never in exception messages, never returned by `/users/me` or any notification endpoint.
- **Email header injection:** `to`/`from` come from validated configuration and the `User.email` column (unique). Subject/body are server-composed plain text; the article title is persisted, not recomputed from user input at send time. Newlines in titles cannot inject headers because delivery uses JSON API fields, not raw SMTP.
- **PII:** notification body may contain the actor's display name and article title; this is internal editorial data, visible only to the recipient. Logs avoid bodies.
- **Rate limiting:** no new public surface; notification reads are authenticated and cheap. Not rate-limited in Phase 8 (deferred).
- **Audit:** no audit rows for notification reads; exactly one audit row per workflow transition remains (INV8-06).

---

## 13. Deployment, Migration, and Operations

- **Migration:** `prisma migrate deploy` runs before API rollout. CI continues to generate the Prisma client before lint/typecheck/test/build (already implemented for Phase 7).
- **Zero-downtime:** additive schema only; old application versions ignore the table. New API requires the migration first.
- **Rollback:** previous API image works against the migrated database. Schema rollback requires a new forward migration; destructive drops require explicit approval.
- **Queue:** `notification-email` is created on module init if absent; no Redis provisioning change.
- **Observability:** structured logs with `notificationId`, `type`, `recipientId` (internal), and outcome. Metrics/dashboards are out of scope; logs must be sufficient to diagnose `FAILED` deliveries.
- **Data volume:** bounded by editorial event rate; no archival in Phase 8. Indexes support list/unread and sweep queries.
- **Email deliverability:** Postmark domain/sender verification is an operational prerequisite for production, not a code task. Until configured, production should run `EMAIL_PROVIDER=log` (with the startup warning) or not deploy Phase 8 email.

---

## 14. Test Plan (Definition of Done)

### 14.1 Unit tests

- `NotificationsService`: list scoping, pagination boundaries, `unreadOnly`, unread count, mark-read idempotency, read-all count, foreign-ID 404 mapping.
- `RecipientResolverService`: permission-based editor lookup, inactive exclusion, actor exclusion, author targeting, no-recipient case.
- `NotificationsService.createForEventSafely`: inserts rows, duplicate suppression, savepoint rollback on forced failure (transition not affected), no savepoint when zero recipients.
- `EmailDispatchService`: enqueue jobId = notification.id; inactive/no-email → conditional `SKIPPED`; enqueue failure caught and logged.
- `EmailProvider` factory: `log` default, `postmark` requires token, invalid provider fails.
- `PostmarkEmailProvider`: success mapping, non-2xx error mapping, token redaction, timeout behavior (mocked `fetch`).
- `NotificationEmailProcessor`: success → conditional `PENDING → SENT`; provider failure → conditional attempts++/rethrow; terminal `SENT`/`SKIPPED`/`FAILED` no-op; pre-send recipient inactive/no-email → conditional `SKIPPED` without send; zero-match conditional does not overwrite a terminal state; missing notification no-op.
- `NotificationEmailReconciler`: completed job → conditional `PENDING → SENT` without resend; live job (waiting/delayed/active/failed-retrying) → no status mutation even if the recipient is now inactive; exhausted eligible delivery → conditional `FAILED`; exhausted ineligible delivery → conditional `SKIPPED`; missing job with inactive/no-email recipient → `SKIPPED`; missing eligible job with attempts remaining → enqueue; missing eligible job with attempts exhausted → `FAILED`; Redis unavailable/inconclusive → row remains `PENDING` with no attempt increment; zero-match conditional never overwrites `SENT`/`SKIPPED`/`FAILED`.

### 14.2 Integration tests (API, real DB; mocked provider)

- Each of the four official triggers creates exactly one notification per expected recipient and none for excluded users. If OD-2 is approved, `requestChanges` follows the same pattern; if not, the transition produces no notification and no `ARTICLE_CHANGES_REQUESTED` member exists.
- All four `PUBLISH_FAILED` code paths (recordTerminalFailure + three executeScheduledPublish branches) create the failure notification; stale/cancelled schedules create none.
- Notification rows commit atomically with the transition; forced insert failure (e.g., injected constraint error) leaves the transition committed and no notification rows.
- Duplicate replay does not create duplicates (unique constraint).
- Post-commit ordering: provider send is not invoked before commit; enqueue failure leaves `PENDING`.
- Crash-recovery case: commit a notification without ever attempting enqueue (simulating process death), then deactivate the recipient or remove their email address; the sweep marks `SKIPPED`, never leaves the row `PENDING` indefinitely, and sends no email. Separately, a completed job for a now-inactive recipient reconciles to `SENT` without a duplicate send.
- Concurrent worker/reconciler race: block the fake provider mid-send, deactivate the recipient, and run the sweep while the job is observed active; assert the active row remains `PENDING` and the job is not reset or interrupted, then release the send → `SENT`. Assert that pre-send deactivation → `SKIPPED` with no provider call, and that a stale reconciler attempt after `SENT`/`SKIPPED` cannot overwrite the terminal state.
- Endpoint authorization and pagination against real data.

### 14.3 E2E tests (acceptance)

- Submit-for-review → editor sees notification via API and CMS page; email captured by the fake provider.
- Approve → author notified; reject → author notified.
- Scheduled-publish failure → editor notified once per schedule (drive via the existing scheduling integration patterns or a service-level trigger with mocked provider).
- Mark-read and read-all persist; another user's notification is 404.
- No network email: fake/log provider asserted.

### 14.4 Non-regression gates

- API unit suite, the five targeted E2E suites from Phase 7, web Jest suite, API/web typecheck and builds, lint (with CRLF awareness documented in Phase 7).
- Workflow transition-matrix suite is mandatory for M4 (architecture guideline #9).
- Existing Phase 7 scheduling tests must pass without modification.

---

## 15. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Notification insert failure aborts the workflow transaction (Postgres aborted-tx semantics) | Transition lost due to a side effect | Savepoint containment + defensive catch; integration test forces failure (AC-5) |
| Missing one of four `PUBLISH_FAILED` paths | No failure notification | Explicit inventory in §6.1; tests per path; code review checklist |
| Post-commit enqueue loss or crash before dispatch | Email never sent though in-app row exists; row stranded `PENDING` | Notification row is durable outbox; sweep selects all stale `PENDING` rows and enqueues or resolves `SKIPPED`/`SENT`/`FAILED` (AC-6, AC-17) |
| BullMQ retry exhaustion leaves `PENDING` forever | Silent email loss | Sweep marks `FAILED` with last error for eligible deliveries; ineligible rows become `SKIPPED`; logs are diagnosable |
| Reconciler marks `SKIPPED` while the worker is sending | Email delivered but row says `SKIPPED`; terminal overwrite | Reconciler never mutates observed live-job rows; worker re-checks status/eligibility immediately before send; conditional `PENDING → terminal` guards prevent overwrites; residual in-flight/observation window documented in §8.3 (AC-17) |
| Provider token leak | Security incident | Factory-only access, redaction tests, `.env.example` placeholder, no token in logs/errors |
| Recipient explosion (many editors) | Email fan-out/queue load | Bounded editor set by permission; batch inserts; queue concurrency default; revisit if editors grow |
| Notification spam from repeated failures | Poor UX | Per-schedule dedupe key; terminal transition is once-per-schedule |
| `createManyAndReturn`/`skipDuplicates` runtime incompatibility | M1 blocker | Verify in M1; fallback to per-row `upsert` inside the savepoint |
| Email content contains sensitive editorial text | Internal only | Plain text, recipient-scoped; no external logging of bodies |
| Timezone/display issues | Misleading timestamps | Store UTC, render local time in CMS (Phase 7 convention) |
| CMS page coupling to protected dirty-state work | Merge conflicts | M5 touches only layout nav + new files; does not modify `ArticleEditor.tsx` |
| Lint/CRLF environment noise (Phase 7 finding) | False negatives | CI runs LF on Linux with `--fix`; local verification uses the documented direct ESLint invocation |

---

## 16. Open Decisions (Required)

### OD-1 — Editor recipients: role or permission?
**Status: APPROVED.**
Resolve editor recipients using the existing `article.start-review` permission. Exclude inactive users and the acting user. Rationale: RBAC permissions are the authorization contract; `editor` and `admin` both hold it today (`seed.ts:111`, `:146`), and new reviewer roles inherit notifications without code changes.

### OD-2 — Does `REQUEST_CHANGES` trigger a separate event from `REJECT`?
**Status: REJECTED / DEFERRED.**
Do not add a changes-requested notification event in Phase 8. Use exactly the four official event types (`ARTICLE_SUBMITTED_FOR_REVIEW`, `ARTICLE_APPROVED`, `ARTICLE_REJECTED`, `ARTICLE_FAILED_TO_PUBLISH`). Omit `ARTICLE_CHANGES_REQUESTED` from the Prisma enum, PostgreSQL enum, and shared types. `requestChanges` gets no notification integration.

### OD-3 — Does publication itself send a notification?
**Status: APPROVED.**
No successful-publication notification in this phase; approval notification suffices.

### OD-4 — Email provider and local development transport
**Status: APPROVED.**
Use the email-provider abstraction, `log` as the local/test/CI default, and the Postmark adapter using Node 22's built-in `fetch`. Production email configuration belongs to M3, not M1.

### OD-5 — How do repeated scheduled-publication failures avoid duplicate notifications?
**Status: LOCKED design.**
Unique `(recipientId, dedupeKey)` with `dedupeKey = article-publish-failed:{scheduleId}`.

### OD-6 — In-app refresh model
**Status: APPROVED.**
Refresh the in-app list on navigation/page entry; no polling or WebSocket in Phase 8.

### OD-7 — Notification retention
**Status: APPROVED.**
Retain notification records indefinitely for the MVP; archival is a future phase concern.

### OD-8 — Inactive recipients
**Status: APPROVED.**
Inactive users at event time receive no notification row. If an existing recipient later becomes inactive or lacks an email address, retain the in-app row and apply the documented `SKIPPED` email behavior.

### OD-9 — Successful scheduled publication
**Status: APPROVED.**
No notification for successful scheduled publication; scheduled-publish failures remain in scope.

### OD-10 — Deletion, preferences, digests, admin broadcast
**Status: DEFERRED (out of scope).** No Phase 8 surface.

### Concurrency limitations
**Status: ACCEPTED.**
Preserve the documented best-effort/at-least-once delivery guarantees, worker/reconciler safeguards, and residual race limitations. Do not introduce a claim/lease subsystem in Phase 8.

---

## 17. Explicit Out of Scope

- Notification preferences/opt-out, email digests, quiet hours, unsubscribe links.
- Push, SMS, Slack, webhooks, websockets/SSE, real-time badges.
- Notification deletion, archiving, retention sweeps, full-text search.
- Admin broadcast/announcements and cross-user notification access.
- HTML email templates, i18n/localization, templating engines.
- Changes to workflow transitions, RBAC permissions, article lifecycle, four-eyes, versioning, scheduling semantics.
- Phase 9+ ingestion/AI events, Phase 11 comments, Phase 12 analytics.
- A Mailpit/MailHog container or SMTP transport in local Compose.

---

## 18. Implementation Readiness Verdict

**APPROVED FOR IMPLEMENTATION.**

Approved using the recommended defaults, accepted concurrency limitations, and authorized M1:
1. OD-1 approved (permission-based editor recipients `article.start-review`, excluding inactive users and acting user).
2. OD-2 rejected/deferred (no changes-requested event in Phase 8; exactly four official event types; omit `ARTICLE_CHANGES_REQUESTED` from Prisma enum, PostgreSQL enum, and shared types; `requestChanges` gets no notification integration).
3. OD-3 approved (no publication notification).
4. OD-4 approved (provider abstraction, `log` default, Postmark adapter via native `fetch`).
5. OD-5 locked (dedupe key `article-publish-failed:{scheduleId}`).
6. OD-6 approved (in-app list refresh on navigation/mount; no polling/websocket).
7. OD-7 approved (indefinite notification retention for MVP).
8. OD-8 approved (inactive users at event time receive no row; later-deactivated or email-less recipients retain in-app row and mark email `SKIPPED`).
9. OD-9 approved (no notification for successful scheduled publication; failure-only).
10. OD-10 deferred (deletion, preferences, digests out of scope).
11. Concurrency limitations accepted (best-effort/at-least-once delivery guarantees, worker/reconciler safeguards, residual race limitations; no claim/lease subsystem in Phase 8).

Implementation follows `phase8-tasks.md` milestones starting with M1. M1 is authorized.

---

## 19. Traceability

- **Scope source:** `dailystar_architecture.md` §13 lines 633–640.
- **Phase 7 boundary:** `phase7-technical-spec-v1.0.md` §15 (lines 190–194) and §18 (line 260).
- **Requirements mapping:** `phase8-requirements.md` D1–D8 → §4; INV8-01–12 → §2.2, §5, §7, §8, §12; AC-1–17 (AC-16 conditional on OD-2) → §6–§13, §14.
- **Tasks mapping:** `phase8-tasks.md` M1–M6 → §4 (milestone column) and §14.
- **Verified code references** are line-numbered against baseline `bfeeb0f`; they must be re-verified if the baseline moves before implementation.
