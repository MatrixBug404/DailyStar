/** BullMQ queue and job identifiers for Phase 8 email delivery. */
export const NOTIFICATION_EMAIL_QUEUE = 'notification-email';
export const NOTIFICATION_EMAIL_JOB = 'send-notification-email';

export interface NotificationEmailJobData {
  notificationId: string;
}
