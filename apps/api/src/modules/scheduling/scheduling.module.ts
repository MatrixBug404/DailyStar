import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulingService } from './scheduling.service';
import { SchedulingProcessor } from './scheduling.processor';
import { WorkflowModule } from '../workflow/workflow.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'article-publishing',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        // Keep completed jobs long enough for the safety sweep to reconcile
        // persisted state, but bound Redis growth. Age is in seconds.
        removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
        // Retain failures for diagnosis, bounded by age and count.
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
      },
    }),
    ScheduleModule.forRoot(),
    forwardRef(() => WorkflowModule),
  ],
  providers: [SchedulingService, SchedulingProcessor],
  exports: [SchedulingService],
})
export class SchedulingModule {}
