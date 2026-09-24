import { Test, TestingModule } from '@nestjs/testing';
import { PublicService } from './public.service';
import { PostgresFtsProvider } from '../search/providers/postgres-fts.provider';
import { prisma } from '../../database/client';
import { NotFoundException } from '@nestjs/common';

jest.mock('../../database/client', () => ({
  prisma: {
    article: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    category: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    }
  },
}));

describe('PublicService', () => {
  let service: PublicService;
  let ftsProvider: PostgresFtsProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicService,
        {
          provide: PostgresFtsProvider,
          useValue: { search: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<PublicService>(PublicService);
    ftsProvider = module.get<PostgresFtsProvider>(PostgresFtsProvider);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getArticles', () => {
    it('PU-01, PU-03-06, PU-15-17: Should triple gate and apply filters', async () => {
      (prisma.article.count as jest.Mock).mockResolvedValue(1);
      (prisma.article.findMany as jest.Mock).mockResolvedValue([
        {
          id: '1',
          slug: 'test',
          publishedAt: new Date(),
          currentPublishedRevision: { title: 'Test', excerpt: 'Ext', createdAt: new Date() },
          coverMedia: null,
          category: { id: 'c1', name: 'Cat', slug: 'cat' },
          primaryAuthor: { displayName: 'Auth', bio: null, avatarUrl: null },
          tags: [],
        }
      ]);

      const result = await service.getArticles({
        page: 1, limit: 10, tag: 'tech', categoryId: 'c1', orderBy: 'publishedAt', order: 'desc'
      });

      expect(prisma.article.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PUBLISHED',
            deletedAt: null,
            currentPublishedRevisionId: { not: null },
            categoryId: 'c1',
          }),
        })
      );
      expect(result.data.length).toBe(1);
    });
  });

  describe('getArticle', () => {
    it('PU-02: Should find article with triple gate and return full DTO', async () => {
      (prisma.article.findFirst as jest.Mock).mockResolvedValue({
          id: '1',
          slug: 'test',
          publishedAt: new Date(),
          currentPublishedRevision: { title: 'Test', excerpt: 'Ext', body: 'body', createdAt: new Date() },
          coverMedia: null,
          category: null,
          primaryAuthor: { displayName: 'Auth', bio: null, avatarUrl: null },
          tags: [],
      });
      const result = await service.getArticle('test');
      expect(prisma.article.findFirst).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({
            slug: 'test',
            status: 'PUBLISHED',
            deletedAt: null,
            currentPublishedRevisionId: { not: null },
          }),
      }));
      expect(result.body).toBe('body');
    });

    it('Should throw NotFoundException if article missing', async () => {
      (prisma.article.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.getArticle('test')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCategories', () => {
    it('PU-11: ancestor-with-zero-direct unit test', async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValue([
        { id: 'parent', name: 'Parent', slug: 'parent', parentId: null, _count: { articles: 0 } },
        { id: 'child', name: 'Child', slug: 'child', parentId: 'parent', _count: { articles: 0 } },
        { id: 'leaf', name: 'Leaf', slug: 'leaf', parentId: 'child', _count: { articles: 3 } },
        { id: 'empty', name: 'Empty', slug: 'empty', parentId: null, _count: { articles: 0 } }
      ]);

      const result = await service.getCategories();
      
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('parent');
      expect(result[0].children.length).toBe(1);
      expect(result[0].children[0].id).toBe('child');
      expect(result[0].children[0].children[0].id).toBe('leaf');
      expect(result[0].children[0].children[0].publishedArticleCount).toBe(3);
    });
  });

  describe('getCategoryArticles', () => {
    it('PU-12: beyond-last-page -> 200 with empty array', async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', slug: 'cat' });
      (prisma.article.count as jest.Mock).mockResolvedValue(5);
      (prisma.article.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCategoryArticles('cat', { page: 2, limit: 10, orderBy: 'publishedAt', order: 'desc' });
      
      expect(result.data).toEqual([]);
      expect(result.total).toBe(5);
    });

    it('throws NotFoundException if category has zero eligible articles', async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', slug: 'cat' });
      (prisma.article.count as jest.Mock).mockResolvedValue(0);

      await expect(service.getCategoryArticles('cat', { page: 1, limit: 10, orderBy: 'publishedAt', order: 'desc' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('search', () => {
    it('PU-14: delegates to PostgresFtsProvider', async () => {
      (ftsProvider.search as jest.Mock).mockResolvedValue({ data: [], total: 0 });
      await service.search({ q: 'test', page: 1, limit: 10 });
      expect(ftsProvider.search).toHaveBeenCalled();
    });
  });
});
