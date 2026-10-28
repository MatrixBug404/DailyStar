import { Injectable } from '@nestjs/common';
import { NotificationType } from '@dailystar/types';
import { prisma } from '../../database/client';

/** Permission that defines the editorial reviewer set (OD-1 approved). */
export const EDITOR_NOTIFICATION_PERMISSION = 'article.start-review';

export interface NotificationRecipient {
  id: string;
  email: string;
}

export interface NotificationArticleTarget {
  id: string;
  primaryAuthorId: string | null;
}

/**
 * Minimal slice of the Prisma client used by the resolver. Both the root
 * `PrismaClient` and an interactive-transaction client satisfy it, which lets
 * M4 resolve recipients inside the workflow transaction (read-only).
 */
export type RecipientResolverDb = Pick<typeof prisma, 'user'>;

const EDITOR_TARGETED_EVENTS: ReadonlySet<NotificationType> = new Set([
  NotificationType.ARTICLE_SUBMITTED_FOR_REVIEW,
  NotificationType.ARTICLE_FAILED_TO_PUBLISH,
]);

const AUTHOR_TARGETED_EVENTS: ReadonlySet<NotificationType> = new Set([
  NotificationType.ARTICLE_APPROVED,
  NotificationType.ARTICLE_REJECTED,
]);

/**
 * Resolves notification recipients for Phase 8 events (spec §6.1/§6.2).
 *
 * - Editors are selected by the `article.start-review` permission, never by
 *   role name, so `admin` and any future reviewer role are included.
 * - Inactive users are excluded at event time (OD-8).
 * - The acting user is excluded. For scheduler-originated failures there is
 *   no human actor, so only the editor set applies.
 * - Author events target `Article.primaryAuthorId`.
 * - Recipients are deduplicated when the same user qualifies twice.
 */
@Injectable()
export class RecipientResolverService {
  async resolveEditorRecipients(
    actorId: string | null,
    db: RecipientResolverDb = prisma,
  ): Promise<NotificationRecipient[]> {
    const users = await db.user.findMany({
      where: {
        isActive: true,
        ...(actorId ? { id: { not: actorId } } : {}),
        roles: {
          some: {
            role: {
              permissions: {
                some: {
                  permission: { name: EDITOR_NOTIFICATION_PERMISSION },
                },
              },
            },
          },
        },
      },
      select: { id: true, email: true, isActive: true },
      orderBy: { id: 'asc' },
    });

    return users
      .filter((user) => user.isActive)
      .map((user) => ({ id: user.id, email: user.email }));
  }

  async resolveAuthorRecipient(
    primaryAuthorId: string | null | undefined,
    actorId: string | null,
    db: RecipientResolverDb = prisma,
  ): Promise<NotificationRecipient[]> {
    if (!primaryAuthorId) {
      return [];
    }

    const author = await db.user.findUnique({
      where: { id: primaryAuthorId },
      select: { id: true, email: true, isActive: true },
    });

    if (!author || !author.isActive) {
      return [];
    }

    if (actorId !== null && author.id === actorId) {
      return [];
    }

    return [{ id: author.id, email: author.email }];
  }

  /**
   * Resolves the recipient set for one of the four approved events.
   */
  async resolveRecipientsForEvent(
    type: NotificationType,
    article: NotificationArticleTarget,
    actorId: string | null,
    db: RecipientResolverDb = prisma,
  ): Promise<NotificationRecipient[]> {
    const recipients: NotificationRecipient[] = [];

    if (EDITOR_TARGETED_EVENTS.has(type)) {
      recipients.push(...(await this.resolveEditorRecipients(actorId, db)));
    }

    if (AUTHOR_TARGETED_EVENTS.has(type)) {
      recipients.push(...(await this.resolveAuthorRecipient(article.primaryAuthorId, actorId, db)));
    }

    return this.mergeUniqueRecipients(recipients);
  }

  /** Keeps the first occurrence of each user so nobody is notified twice. */
  mergeUniqueRecipients(recipients: NotificationRecipient[]): NotificationRecipient[] {
    const unique = new Map<string, NotificationRecipient>();
    for (const recipient of recipients) {
      if (!unique.has(recipient.id)) {
        unique.set(recipient.id, recipient);
      }
    }
    return Array.from(unique.values());
  }
}
