import { Controller, Post, Get, Param, UseGuards, Req, Body, HttpCode } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../rbac/guards/permission.guard';

@Controller('v1/articles')
@UseGuards(AuthGuard, PermissionGuard)
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

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
  requestChanges(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.workflowService.requestChanges(id, this.getUserContext(req), body.expectedVersion, body.comment);
  }

  @Post(':id/reject')
  @RequirePermission('article.reject')
  reject(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.workflowService.reject(id, this.getUserContext(req), body.expectedVersion, body.comment);
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
  schedule(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.workflowService.schedule(id, this.getUserContext(req), body.expectedVersion, body.scheduledFor);
  }

  @Post(':id/cancel-schedule')
  @RequirePermission('article.cancel-schedule')
  cancelSchedule(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.workflowService.cancelSchedule(id, this.getUserContext(req), body.expectedVersion);
  }

  @Post(':id/archive')
  @RequirePermission('article.archive')
  archive(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this.workflowService.archive(id, this.getUserContext(req), body.expectedVersion);
  }

  @Get(':id/audit')
  @RequirePermission('article.read.any')
  getAuditLogs(@Param('id') id: string, @Req() req: any) {
    return this.workflowService.getAuditLogs(id, this.getUserContext(req));
  }
}
