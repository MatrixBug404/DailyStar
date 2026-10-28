import { PaginatedResponse } from './index';

export enum NotificationType {
  ARTICLE_SUBMITTED_FOR_REVIEW = 'ARTICLE_SUBMITTED_FOR_REVIEW',
  ARTICLE_APPROVED = 'ARTICLE_APPROVED',
  ARTICLE_REJECTED = 'ARTICLE_REJECTED',
  ARTICLE_FAILED_TO_PUBLISH = 'ARTICLE_FAILED_TO_PUBLISH',
}

export enum NotificationEmailStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export interface NotificationSummary {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  articleId: string | null;
  readAt: string | null;
  createdAt: string;
}

export type NotificationListResponse = PaginatedResponse<NotificationSummary>;
