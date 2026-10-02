import { Test, TestingModule } from '@nestjs/testing';
import { ArticlesService } from './articles.service';
import { RevisionsService } from './revisions.service';
import { AuthorProfilesService } from './author-profiles.service';
import { TagsService } from '../categories-tags/tags.service';
import { WorkflowService } from '../workflow/workflow.service';
import { MediaService } from '../media/media.service';

const mockTx = {
  article: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  articleTag: {
    deleteMany: jest.fn(),
  },
};

jest.mock('../../database/client', () => ({
  prisma: {
    article: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { prisma } from '../../database/client';

describe('ArticlesService', () => {
  let service: ArticlesService;
  let revisionsService: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg(mockTx);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArticlesService,
        {
          provide: RevisionsService,
          useValue: {
            appendRevision: jest.fn().mockResolvedValue({ id: 'rev-2' }),
          },
        },
        { provide: AuthorProfilesService, useValue: {} },
        { provide: TagsService, useValue: {} },
        {
          provide: WorkflowService,
          useValue: {
            revertToDraft: jest.fn(),
          },
        },
        { provide: MediaService, useValue: {} },
      ],
    }).compile();

    service = module.get<ArticlesService>(ArticlesService);
    revisionsService = module.get<RevisionsService>(RevisionsService);

    // Mock checkVisibility to just return the article
    jest.spyOn(service as any, 'checkVisibility').mockImplementation(async (id) => {
      return { id, primaryAuthorId: 'user-1' };
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('update (PB-01 Slug Immutability)', () => {
    const user = { sub: 'user-1', permissions: ['article.update.any'] };

    it('DRAFT TITLE UPDATE: regenerates slug when publishedAt is null', async () => {
      const currentDraft = {
        id: 'art-1',
        slug: 'old-draft-slug',
        publishedAt: null, // DRAFT
        categoryId: 'cat-1',
        currentRevision: {
          title: 'Old Title',
          body: 'Body',
          excerpt: 'Excerpt',
        },
      };

      mockTx.article.findUnique.mockResolvedValueOnce(currentDraft);
      // For generateUniqueSlug check
      mockTx.article.findUnique.mockResolvedValueOnce(null);
      mockTx.article.update.mockResolvedValue({ id: 'art-1', slug: 'new-title' });

      await service.update('art-1', { title: 'New Title' }, user);

      // findUnique is called twice: once for the article, once for unique slug check
      expect(mockTx.article.findUnique).toHaveBeenCalledTimes(2);
      expect(mockTx.article.findUnique).toHaveBeenNthCalledWith(2, { where: { slug: 'new-title' } });

      expect(mockTx.article.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: 'new-title',
          }),
        }),
      );
    });

    it('PUBLISHED TITLE UPDATE: keeps original slug when publishedAt is not null', async () => {
      const currentPublished = {
        id: 'art-1',
        slug: 'original-published-slug',
        publishedAt: new Date(), // PUBLISHED
        categoryId: 'cat-1',
        currentRevision: {
          title: 'Old Title',
          body: 'Body',
          excerpt: 'Excerpt',
        },
      };

      mockTx.article.findUnique.mockResolvedValueOnce(currentPublished);
      mockTx.article.update.mockResolvedValue({ id: 'art-1', slug: 'original-published-slug' });

      await service.update('art-1', { title: 'New Title' }, user);

      // generateUniqueSlug should NOT be called
      expect(mockTx.article.findUnique).toHaveBeenCalledTimes(1);

      expect(mockTx.article.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: 'original-published-slug', // Preserved!
          }),
        }),
      );
    });
  });

  describe('findAll (D3 Pagination & Filtering)', () => {
    it('should paginate, filter, and sort articles', async () => {
      const user = { sub: 'author-1', permissions: ['article.read.any'] };
      const query: any = {
        page: 2,
        limit: 10,
        status: ['PUBLISHED'],
        categoryId: 'cat-1',
        sortBy: 'title',
        order: 'asc',
      };

      (prisma.article.findMany as jest.Mock).mockResolvedValue(['art-1', 'art-2']);
      (prisma.article.count as jest.Mock).mockResolvedValue(20);

      const result = await service.findAll(query, user);

      expect(prisma.article.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null, status: { in: ['PUBLISHED'] }, categoryId: 'cat-1' },
        skip: 10,
        take: 10,
        orderBy: [{ currentRevision: { title: 'asc' } }, { id: 'asc' }],
        include: { currentRevision: true },
      });
      expect(prisma.article.count).toHaveBeenCalledWith({
        where: { deletedAt: null, status: { in: ['PUBLISHED'] }, categoryId: 'cat-1' },
      });

      expect(result).toEqual({
        data: ['art-1', 'art-2'],
        total: 20,
        page: 2,
        limit: 10,
      });
    });

    it('should enforce ownership if article.read.any is missing', async () => {
      const user = { sub: 'author-1', permissions: [] };
      const query: any = { page: 1, limit: 10, sortBy: 'updatedAt', order: 'desc' };

      (prisma.article.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.article.count as jest.Mock).mockResolvedValue(0);

      await service.findAll(query, user);

      expect(prisma.article.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, primaryAuthorId: 'author-1' },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        }),
      );
    });
  });
});
