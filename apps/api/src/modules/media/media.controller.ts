import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UseFilters,
  UploadedFile,
  Req,
  BadRequestException,
  Query,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../rbac/guards/permission.guard';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { MediaService } from './media.service';
import { FileSizeLimitExceptionFilter } from './filters/file-size-limit-exception.filter';

@Controller('v1/media')
@UseGuards(AuthGuard, PermissionGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  private getUserContext(req: any) {
    return {
      sub: req.user.sub,
      email: req.user.email,
      roles: req.user.roles,
      permissions: req.userPermissions || [],
    };
  }

  @Post()
  @RequirePermission('media.upload')
  @UseInterceptors(FileInterceptor('file'))
  @UseFilters(FileSizeLimitExceptionFilter)
  async upload(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('FILE_REQUIRED');
    return this.mediaService.processUpload(
      file.buffer,
      file.originalname,
      this.getUserContext(req),
    );
  }

  @Get()
  @RequirePermission('media.read.own')
  async listOwn(
    @Req() req: any,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(1, parseInt(pageStr ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10)));
    return this.mediaService.listOwn(this.getUserContext(req), page, limit);
  }

  @Get(':id')
  @RequirePermission('media.read.own')
  async getMetadata(@Param('id') id: string, @Req() req: any) {
    const media = await this.mediaService.findById(id, this.getUserContext(req));
    return this.mediaService.toResponseDto(media);
  }

  @Get(':id/signed-url')
  @RequirePermission('media.read.own')
  async getSignedUrl(@Param('id') id: string, @Req() req: any) {
    const { signedUrl, expiresAt } = await this.mediaService.generateSignedUrl(
      id,
      this.getUserContext(req),
    );
    return { signedUrl, expiresAt: expiresAt.toISOString() };
  }

  @Delete(':id')
  @RequirePermission('media.delete.own')
  @HttpCode(204)
  async deleteMedia(@Param('id') id: string, @Req() req: any) {
    await this.mediaService.softDelete(id, this.getUserContext(req));
  }
}
