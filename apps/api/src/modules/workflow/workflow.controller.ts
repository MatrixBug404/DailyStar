import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
  Body,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../rbac/guards/permission.guard';
import { RequestChangesDto } from './dto/request-changes.dto';
import { RejectDto } from './dto/reject.dto';

@Controller('v1/articles')
@UseGuards(AuthGuard, PermissionGuard)
export class WorkflowController {
  private readonly logger = new Logger(WorkflowController.name);

  constructor(
    private readonly workflowService: WorkflowService,
    private readonly schedulingService: SchedulingService,
  ) {}

  private getUserContext(req: any) {
    return { ...req.user, permissions: req.userPermissions || [] };
  }

  @Post(':id/submit-review')
  @RequirePermission('article.submit-review')
  submitReview(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.workflowService.submitReview(id, this.getUserContext(req), body.expectedVersion);
  }

  @Post(':id/start-review')
  @RequirePermission('article.start-review')
  startReview(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.workflowService.startReview(id, this.getUserContext(req), body.expectedVersion);
  }

  @Post(':id/request-changes')
  @RequirePermission('article.request-changes')
  requestChanges(@Param('id') id: string, @Req() req: any, @Body() body: RequestChangesDto) {
    return this.workflowService.requestChanges(
      id,
      this.getUserContext(req),
      body.expectedVersion,
      body.comment,
    );
  }

  @Post(':id/reject')
  @RequirePermission('article.reject')
  reject(@Param('id') id: string, @Req() req: any, @Body() body: RejectDto) {
    return this.workflowService.reject(
      id,
      this.getUserContext(req),
      body.expectedVersion,
      body.comment,
    );
  }

  @Post(':id/approve')
  @RequirePermission('article.approve')
  approve(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.workflowService.approve(id, this.getUserContext(req), body.expectedVersion);
  }

  @Post(':id/publish')
  @RequirePermission('article.publish')
  publish(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.workflowService.publish(id, this.getUserContext(req), body.expectedVersion);
  }

  @Post(':id/schedule')
  @RequirePermission('article.schedule')
  async schedule(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    const result = await this.workflowService.schedule(
      id,
      this.getUserContext(req),
      body.expectedVersion,
      body.scheduledFor,
    );

    // Enqueue BullMQ job ONLY AFTER successful DB commit. The committed
    // PublicationSchedule is authoritative: if Redis is temporarily
    // unavailable, the schedule remains valid and the safety sweep will
    // re-enqueue the missing job. The HTTP response must reflect the
    // committed schedule rather than implying the transaction rolled back.
    try {
      await this.schedulingService.enqueuePublishJob(
        result.schedule.id,
        result.schedule.articleId,
        result.schedule.expectedArticleVersion,
        new Date(result.schedule.scheduledFor),
      );
    } catch (enqueueError: unknown) {
      const message = enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
      this.logger.error(
        `Schedule ${result.schedule.id} was committed but BullMQ enqueue failed: ${message}. ` +
          'The safety sweep will recover the missing job.',
      );
    }

    return result.article;
  }

  @Post(':id/cancel-schedule')
  @RequirePermission('article.cancel-schedule')
  async cancelSchedule(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    const result = await this.workflowService.cancelSchedule(
      id,
      this.getUserContext(req),
      body.expectedVersion,
    );

    // Attempt BullMQ job removal BEST EFFORT after successful DB commit
    for (const scheduleId of result.cancelledScheduleIds) {
      await this.schedulingService.removePublishJob(scheduleId);
    }

    return result.article;
  }

  @Post(':id/archive')
  @RequirePermission('article.archive')
  archive(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.workflowService.archive(id, this.getUserContext(req), body.expectedVersion);
  }

  @Post(':id/reopen')
  @RequirePermission('article.submit-review')
  reopen(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.workflowService.reopenDraft(id, this.getUserContext(req), body?.expectedVersion);
  }

  @Get(':id/audit')
  @RequirePermission('article.read.any')
  getAuditLogs(@Param('id') id: string, @Req() req: any) {
    return this.workflowService.getAuditLogs(id, this.getUserContext(req));
  }
}
