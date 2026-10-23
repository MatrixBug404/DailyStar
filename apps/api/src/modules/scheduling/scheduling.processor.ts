import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, forwardRef, Inject } from '@nestjs/common';
import { WorkflowService, TerminalPublicationError } from '../workflow/workflow.service';

@Processor('article-publishing')
export class SchedulingProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulingProcessor.name);

  constructor(
    @Inject(forwardRef(() => WorkflowService))
    private readonly workflowService: WorkflowService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { scheduleId } = job.data;
    this.logger.log(`Processing scheduled publish for job ${job.id}, schedule ${scheduleId}`);

    try {
      const article = await this.workflowService.executeScheduledPublish(scheduleId);
      this.logger.log(`Successfully published article for schedule ${scheduleId}`);
      return { status: 'published', articleId: article?.id };
    } catch (error: any) {
      this.logger.error(`Failed to execute scheduled publish for schedule ${scheduleId}: ${error.message}`);

      // WorkflowService is the only boundary allowed to declare a terminal
      // business outcome. Its explicit typed error is the sole terminal signal;
      // message text must never decide whether an infrastructure error is retryable.
      if (error instanceof TerminalPublicationError) {
        return { status: 'terminal_failure', reason: error.message };
      }

      // Transient database or infrastructure failure -> throw to trigger BullMQ retry backoff
      throw error;
    }
  }
}
