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
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => callback(mockTx));

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
});
