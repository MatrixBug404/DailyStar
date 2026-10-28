import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationListResponse, NotificationSummary, NotificationType } from '@dailystar/types';
import { prisma } from '../../database/client';
import { Notification as NotificationRecord, Prisma } from '../../database/generated/prisma';
import { NotificationListQueryDto } from './dto/notification-list-query.dto';
import { RecipientResolverService } from './recipient-resolver.service';

type NotificationRow = Pick<
  NotificationRecord,
  'id' | 'type' | 'title' | 'body' | 'articleId' | 'readAt' | 'createdAt'
>;

/** Constant savepoint name; only fixed SQL strings are used for it (spec §12). */
const NOTIFICATION_SAVEPOINT = 'notification_create';

/**
 * Input for a workflow-originated notification (spec §6.1/§7.2).
 *
 * Display strings are built by `WorkflowService` inside the transition
 * transaction so the persisted snapshot does not depend on mutable article
 * state at read or email time.
 */
export interface NotificationEventInput {
  type: NotificationType;
  articleId: string;
  primaryAuthorId: string | null;
  actorId: string | null;
  dedupeKey: string;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
}

/**
 * Maps a persisted notification to the public API contract.
 *
 * Deliberately whitelists fields: `emailStatus`, `dedupeKey`, `data` and the
 * email error columns are internal and must never be exposed (spec §10.3).
 */
function toNotificationSummary(notification: NotificationRow): NotificationSummary {
  return {
    id: notification.id,
    type: notification.type as NotificationType,
    title: notification.title,
    body: notification.body,
    articleId: notification.articleId,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
  };
}

/**
 * Read-side notifications API.
 *
 * Every operation is scoped to the authenticated user's ID (never a request
 * parameter); foreign or missing IDs are indistinguishable (404, spec §12).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly recipientResolver: RecipientResolverService) {}

  /**
   * Creates durable notification rows inside the caller's workflow transaction.
   *
   * Postgres aborts the enclosing transaction on a failed statement, so a plain
   * try/catch cannot contain a notification-only failure. The rows are written
   * between `SAVEPOINT`/`RELEASE`; any insert error rolls back to the savepoint
   * and leaves the already-applied lifecycle transition intact (INV8-02/03).
   * When no recipient is eligible, no savepoint or write is performed.
   */
  async createForEventSafely(
    tx: Prisma.TransactionClient,
    event: NotificationEventInput,
  ): Promise<Array<{ id: string }>> {
    const recipients = await this.recipientResolver.resolveRecipientsForEvent(
      event.type,
      { id: event.articleId, primaryAuthorId: event.primaryAuthorId },
      event.actorId,
      tx,
    );

    if (recipients.length === 0) {
      return [];
    }

    await tx.$executeRawUnsafe(`SAVEPOINT ${NOTIFICATION_SAVEPOINT}`);

    try {
      const created = await tx.notification.createManyAndReturn({
        data: recipients.map((recipient) => ({
          recipientId: recipient.id,
          type: event.type,
          title: event.title,
          body: event.body,
          articleId: event.articleId,
          dedupeKey: event.dedupeKey,
          ...(event.data === undefined ? {} : { data: event.data }),
        })),
        skipDuplicates: true,
        select: { id: true },
      });

      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${NOTIFICATION_SAVEPOINT}`);
      return created;
    } catch (error: unknown) {
      // Restore the transaction to its pre-notification state. The lifecycle
      // transition completed before this call and remains committable.
      try {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${NOTIFICATION_SAVEPOINT}`);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${NOTIFICATION_SAVEPOINT}`);
      } catch (rollbackError: unknown) {
        this.logger.error(
          `Failed to roll back notification savepoint for ${event.type} on article ` +
            `${event.articleId}: ${this.errorCode(rollbackError)}`,
        );
      }

      this.logger.warn(
        `Notification creation failed for ${event.type} on article ${event.articleId}; ` +
          `workflow transaction is preserved (${this.errorCode(error)})`,
      );
      return [];
    }
  }

  async list(userId: string, query: NotificationListQueryDto): Promise<NotificationListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.NotificationWhereInput = { recipientId: userId };
    if (query.unreadOnly === true) {
      where.readAt = null;
    }

    // Deterministic ordering required by spec §10.2: createdAt DESC, id ASC.
    const orderBy: Prisma.NotificationOrderByWithRelationInput[] = [
      { createdAt: 'desc' },
      { id: 'asc' },
    ];

    const [rows, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      data: rows.map(toNotificationSummary),
      total,
      page,
      limit,
    };
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    const unread = await prisma.notification.count({
      where: { recipientId: userId, readAt: null },
    });
    return { unread };
  }

  /**
   * Marks one of the caller's notifications as read (idempotent).
   *
   * A notification owned by another user is treated exactly like a missing
   * one so its existence is not leaked.
   */
  async markRead(userId: string, notificationId: string): Promise<NotificationSummary> {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.recipientId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.readAt) {
      return toNotificationSummary(notification);
    }

    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
    });

    return toNotificationSummary(updated);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  }

  /** Safe diagnostic only: error class/code, never message contents or PII. */
  private errorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      return String((error as { code?: unknown }).code);
    }
    return error instanceof Error ? error.name : 'UnknownError';
  }
}
