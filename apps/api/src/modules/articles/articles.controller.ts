import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { ArticlesService } from './articles.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { SetCoverMediaDto } from '../media/dto/set-cover-media.dto';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../rbac/guards/permission.guard';

@Controller('v1/articles')
@UseGuards(AuthGuard, PermissionGuard)
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  private getUserContext(req: any) {
    return { ...req.user, permissions: req.userPermissions || [] };
  }

  @Post()
  @RequirePermission('article.create')
  create(@Body() createArticleDto: CreateArticleDto, @Req() req: any) {
    return this.articlesService.create(createArticleDto, this.getUserContext(req));
  }

  @Get()
  findAll(@Req() req: any) {
    return this.articlesService.findAll(this.getUserContext(req));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.articlesService.findOne(id, this.getUserContext(req));
  }

  @Get(':id/revisions')
  getRevisions(@Param('id') id: string, @Req() req: any) {
    return this.articlesService.getRevisions(id, this.getUserContext(req));
  }

  @Get(':id/revisions/:revisionId')
  getRevision(@Param('id') id: string, @Param('revisionId') revisionId: string, @Req() req: any) {
    return this.articlesService.getRevision(id, revisionId, this.getUserContext(req));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateArticleDto: UpdateArticleDto, @Req() req: any) {
    return this.articlesService.update(id, updateArticleDto, this.getUserContext(req));
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.articlesService.remove(id, this.getUserContext(req));
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @Req() req: any) {
    return this.articlesService.restore(id, this.getUserContext(req));
  }

  @Patch(':id/cover')
  async setCoverMedia(@Param('id') id: string, @Body() dto: SetCoverMediaDto, @Req() req: any) {
    return this.articlesService.setCoverMedia(id, dto, this.getUserContext(req));
  }

  @Get(':id/cover')
  async getArticleCover(@Param('id') id: string, @Req() req: any) {
    return this.articlesService.getArticleCover(id, this.getUserContext(req));
  }
}
