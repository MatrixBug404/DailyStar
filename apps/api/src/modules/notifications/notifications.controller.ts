import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { NotificationListQueryDto } from './dto/notification-list-query.dto';
import { NotificationsService } from './notifications.service';

/**
 * Authenticated notifications API (Phase 8 spec §10).
 *
 * There is intentionally no `@RequirePermission` decorator: ownership of the
 * notification row replaces permission gating. The recipient ID always comes
 * from the authenticated JWT payload (`req.user.sub`), never from client input.
 */
@Controller('v1/notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@Req() req: any, @Query() query: NotificationListQueryDto) {
    return this.notificationsService.list(req.user.sub, query);
  }

  @Get('unread-count')
  unreadCount(@Req() req: any) {
    return this.notificationsService.unreadCount(req.user.sub);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.notificationsService.markRead(req.user.sub, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  readAll(@Req() req: any) {
    return this.notificationsService.markAllRead(req.user.sub);
  }
}
