import { PostgresFtsProvider } from './postgres-fts.provider';
import { prisma } from '../../../database/client';
import { SearchQueryDto } from '../dto/search-query.dto';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

jest.mock('../../../database/client', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

describe('PostgresFtsProvider', () => {
  let provider: PostgresFtsProvider;

  beforeEach(() => {
    provider = new PostgresFtsProvider();
    jest.clearAllMocks();
  });

  describe('search', () => {
    const mockQueryResult = {
      id: '123',
      slug: 'test-slug',
      title: 'Test Title',
      excerpt: 'Test Excerpt',
      publishedAt: new Date('2023-01-01T00:00:00Z'),
      publishedRevisionCreatedAt: new Date('2023-01-01T00:00:00Z'),
      hasCoverImage: false,
      coverWidth: null,
      coverHeight: null,
      coverMimeType: null,
      headline: 'This is a <b>test</b>',
      rank: 0.9,
      categoryId: null,
      categoryName: null,
      categorySlug: null,
      authorDisplayName: 'Author',
      authorBio: null,
      authorAvatarUrl: null,
      tags: [],
    };

    it('PU-09: ranking/order is rank DESC, publishedAt DESC, article.id ASC', async () => {
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ total: 1 }]) // Count
        .mockResolvedValueOnce([mockQueryResult]); // Result

      const dto: SearchQueryDto = { q: 'test', page: 1, limit: 10 };
      await provider.search(dto);

      const calls = (prisma.$queryRaw as jest.Mock).mock.calls;
      expect(calls.length).toBe(2);

      const resultQuery = calls[1][0];
      // Prisma.Sql object structure check
      const sqlStrings = resultQuery.strings.join('?');
      expect(sqlStrings).toContain('ORDER BY rank DESC, a."publishedAt" DESC, a.id ASC');
    });

    it('PU-20: result and count query use identical visibility/filter logic', async () => {
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([mockQueryResult]);

      const dto: SearchQueryDto = { q: 'test', page: 1, limit: 10, categorySlug: 'news', tag: 'tech' };
      await provider.search(dto);

      const calls = (prisma.$queryRaw as jest.Mock).mock.calls;
      const countQuery = calls[0][0];
      const resultQuery = calls[1][0];

      const countSql = countQuery.strings.join('?');
      const resultSql = resultQuery.strings.join('?');

      expect(countSql).toContain("plainto_tsquery('english'");
      expect(resultSql).toContain("plainto_tsquery('english'");
      
      expect(countSql).toContain('c.slug =');
      expect(resultSql).toContain('c.slug =');
      
      expect(countSql).toContain('EXISTS');
      expect(resultSql).toContain('EXISTS');
      expect(countSql).toContain('LOWER(t2.name)');
    });
    
    it('throws BadRequestException if q is empty', async () => {
      const dto: SearchQueryDto = { q: '   ', page: 1, limit: 10 };
      await expect(provider.search(dto)).rejects.toThrow(BadRequestException);
    });

    it('Filter combinations test', async () => {
      // no optional filters
      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce([mockQueryResult]);
      await provider.search({ q: 'test', page: 1, limit: 10 });
      let calls = (prisma.$queryRaw as jest.Mock).mock.calls;
      expect(calls[1][0].strings.join('?')).not.toContain('c.slug =');
      expect(calls[1][0].strings.join('?')).not.toContain('EXISTS');
      jest.clearAllMocks();

      // categorySlug only
      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce([mockQueryResult]);
      await provider.search({ q: 'test', page: 1, limit: 10, categorySlug: 'news' });
      calls = (prisma.$queryRaw as jest.Mock).mock.calls;
      expect(calls[1][0].strings.join('?')).toContain('c.slug =');
      expect(calls[1][0].strings.join('?')).not.toContain('EXISTS');
      jest.clearAllMocks();

      // tag only
      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce([mockQueryResult]);
      await provider.search({ q: 'test', page: 1, limit: 10, tag: 'tech' });
      calls = (prisma.$queryRaw as jest.Mock).mock.calls;
      expect(calls[1][0].strings.join('?')).not.toContain('c.slug =');
      expect(calls[1][0].strings.join('?')).toContain('EXISTS');
    });
  });

  describe('sanitizeHeadline (PU-13, PU-10)', () => {
    it('PU-13: headline sanitization removes non-<b> HTML', () => {
      const raw = '<p>This is a <script>alert(1)</script> <b>test</b> of <i>sanitization</i>.</p>';
      const sanitized = provider.sanitizeHeadline(raw);
      expect(sanitized).toBe('This is a alert(1) <b>test</b> of sanitization.');
    });

    it('PU-10: title-only match headline might be null or have no <b> tags, returning as is', () => {
      const raw = 'This is an excerpt without bold tags.';
      const sanitized = provider.sanitizeHeadline(raw);
      expect(sanitized).toBe('This is an excerpt without bold tags.');
      
      expect(provider.sanitizeHeadline(null)).toBeNull();
    });
  });

  describe('SearchQueryDto whitespace trimming behavior', () => {
    it('trims whitespace and leaves empty string for whitespace-only input', () => {
      const plain = { q: '   ', page: 1, limit: 10 };
      const instance = plainToInstance(SearchQueryDto, plain);
      expect(instance.q).toBe('');
      
      const plain2 = { q: ' test ', page: 1, limit: 10 };
      const instance2 = plainToInstance(SearchQueryDto, plain2);
      expect(instance2.q).toBe('test');
    });
  });
});
