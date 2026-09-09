import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { prisma } from '../../database/client';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { generateSlug } from './slug.util';
import { RevisionsService } from './revisions.service';
import { AuthorProfilesService } from './author-profiles.service';
import { TagsService } from '../categories-tags/tags.service';
import { WorkflowService } from '../workflow/workflow.service';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly revisionsService: RevisionsService,
    private readonly authorProfilesService: AuthorProfilesService,
    private readonly tagsService: TagsService,
    private readonly workflowService: WorkflowService
  ) {}

  private async generateUniqueSlug(title: string, tx: any) {
    const baseSlug = generateSlug(title);
    let slug = baseSlug;
    let counter = 1;
    
    while (true) {
      const existing = await tx.article.findUnique({ where: { slug } });
      if (!existing) return slug;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  private async checkVisibility(id: string, user: { sub: string, permissions: string[] }) {
    const article = await prisma.article.findUnique({ where: { id } });
    if (!article || article.deletedAt) throw new NotFoundException('Article not found');
    
    if (article.primaryAuthorId !== user.sub && !user.permissions.includes('article.read.any')) {
      throw new NotFoundException('Article not found');
    }
    return article;
  }

  async create(createArticleDto: CreateArticleDto, user: any) {
    await this.authorProfilesService.findOrCreateProfile(user.sub, user.email || user.displayName || 'Author');

    return prisma.$transaction(async (tx) => {
      const slug = await this.generateUniqueSlug(createArticleDto.title, tx);
      
      let tagsData: { tagId: string }[] = [];
      if (createArticleDto.tags && createArticleDto.tags.length > 0) {
        if (createArticleDto.tags.length > 10) throw new BadRequestException('Max 10 tags allowed');
        const tags = await this.tagsService.findOrCreate(createArticleDto.tags);
        tagsData = tags.map(t => ({ tagId: t.id }));
      }

      const article = await tx.article.create({
        data: {
          slug,
          primaryAuthorId: user.sub,
          createdBy: user.sub,
          categoryId: createArticleDto.categoryId,
          tags: { create: tagsData }
        }
      });

      const revision = await this.revisionsService.appendRevision(
        article.id,
        user.sub,
        createArticleDto.title,
        createArticleDto.body,
        createArticleDto.excerpt || null,
        tx
      );

      return tx.article.update({
        where: { id: article.id },
        data: { currentRevisionId: revision.id },
        include: { currentRevision: true, tags: { include: { tag: true } } }
      });
    });
  }

  async findAll(user: any) {
    const where: any = { deletedAt: null };
    if (!user.permissions.includes('article.read.any')) {
      where.primaryAuthorId = user.sub;
    }
    return prisma.article.findMany({ where, include: { currentRevision: true } });
  }

  async findOne(id: string, user: any) {
    const article = await this.checkVisibility(id, user);
    return prisma.article.findUnique({ 
      where: { id }, 
      include: { currentRevision: true, tags: { include: { tag: true } } } 
    });
  }

  async getRevisions(id: string, user: any) {
    await this.checkVisibility(id, user);
    return prisma.articleRevision.findMany({
      where: { articleId: id },
      orderBy: { revisionNumber: 'desc' },
      select: { id: true, revisionNumber: true, createdAt: true, authorId: true }
    });
  }

  async getRevision(id: string, revisionId: string, user: any) {
    await this.checkVisibility(id, user);
    const revision = await prisma.articleRevision.findUnique({ where: { id: revisionId } });
    if (!revision || revision.articleId !== id) throw new NotFoundException('Revision not found');
    return revision;
  }

  async update(id: string, updateArticleDto: UpdateArticleDto, user: any) {
    const article = await this.checkVisibility(id, user);
    
    if (article.primaryAuthorId !== user.sub && !user.permissions.includes('article.update.any')) {
      throw new NotFoundException('Article not found');
    }

    if (updateArticleDto.expectedVersion && updateArticleDto.expectedVersion !== article.version) {
      throw new ConflictException('CONCURRENCY_CONFLICT');
    }

    return prisma.$transaction(async (tx) => {
      const current = await tx.article.findUnique({ where: { id }, include: { currentRevision: true } });
      if (!current || !current.currentRevision) throw new NotFoundException();
      if (updateArticleDto.expectedVersion && updateArticleDto.expectedVersion !== current.version) {
        throw new ConflictException('CONCURRENCY_CONFLICT');
      }

      const title = updateArticleDto.title !== undefined ? updateArticleDto.title : current.currentRevision.title;
      const body = updateArticleDto.body !== undefined ? updateArticleDto.body : current.currentRevision.body;
      const excerpt = updateArticleDto.excerpt !== undefined ? updateArticleDto.excerpt : current.currentRevision.excerpt;

      const revision = await this.revisionsService.appendRevision(
        id,
        user.sub,
        title,
        body,
        excerpt,
        tx
      );

      let tagsUpdate = undefined;
      if (updateArticleDto.tags) {
         if (updateArticleDto.tags.length > 10) throw new BadRequestException('Max 10 tags allowed');
         await tx.articleTag.deleteMany({ where: { articleId: id } });
         const tags = await this.tagsService.findOrCreate(updateArticleDto.tags);
         tagsUpdate = { create: tags.map(t => ({ tagId: t.id })) };
      }

      let slug = current.slug;
      if (updateArticleDto.title && updateArticleDto.title !== current.currentRevision.title) {
        slug = await this.generateUniqueSlug(title, tx);
      }

      // Auto-revert to DRAFT if APPROVED or SCHEDULED (Pattern A)
      if (current.status === 'APPROVED' || current.status === 'SCHEDULED') {
        await this.workflowService.revertToDraft(id, user, tx);
      }

      return tx.article.update({
        where: { id },
        data: {
          slug,
          version: { increment: 1 },
          updatedBy: user.sub,
          currentRevisionId: revision.id,
          categoryId: updateArticleDto.categoryId !== undefined ? updateArticleDto.categoryId : current.categoryId,
          ...(tagsUpdate && { tags: tagsUpdate })
        },
        include: { currentRevision: true, tags: { include: { tag: true } } }
      });
    });
  }

  async remove(id: string, user: any) {
    const article = await prisma.article.findUnique({ where: { id } });
    if (!article || article.deletedAt) throw new NotFoundException('Article not found');

    if (article.primaryAuthorId !== user.sub && !user.permissions.includes('article.delete.any')) {
      throw new NotFoundException('Article not found');
    }

    await prisma.article.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 }, updatedBy: user.sub }
    });
  }

  async restore(id: string, user: any) {
    const article = await prisma.article.findUnique({ where: { id } });
    if (!article || !article.deletedAt) throw new NotFoundException('Article not found');

    if (article.primaryAuthorId !== user.sub && !user.permissions.includes('article.delete.any')) {
      throw new NotFoundException('Article not found');
    }

    return prisma.article.update({
      where: { id },
      data: { deletedAt: null, version: { increment: 1 }, updatedBy: user.sub },
      include: { currentRevision: true }
    });
  }
}
