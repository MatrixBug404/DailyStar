import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RecipientResolverService } from './recipient-resolver.service';
import { NOTIFICATION_EMAIL_QUEUE } from './email/email.constants';
import { emailProviderProvider } from './email/email-provider.factory';
import { EmailDispatchService } from './email/email-dispatch.service';
import { NotificationEmailProcessor } from './email/notification-email.processor';
import { NotificationEmailReconciler } from './email/notification-email.reconciler';

/**
 * Phase 8 notifications module.
 *
 * M2: read API + recipient resolution.
 * M3: email provider abstraction, `notification-email` queue, dispatch, worker
 *     and reconciliation sweep. The queue uses the global Bull root connection
 *     configuration — no second Redis factory is created.
 * M4 imports this module from `WorkflowModule` — the dependency stays one-way
 * (Workflow → Notifications). Cron discovery is provided by the app-wide
 * `ScheduleModule.forRoot()` registered by `SchedulingModule`.
 */
@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: NOTIFICATION_EMAIL_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        defaultJobOptions: {
          attempts: configService.get<number>('notifications.email.maxAttempts', 5),
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
          removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
        },
      }),
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    RecipientResolverService,
    emailProviderProvider,
    EmailDispatchService,
    NotificationEmailProcessor,
    NotificationEmailReconciler,
  ],
  exports: [NotificationsService, RecipientResolverService, EmailDispatchService],
})
export class NotificationsModule {}
