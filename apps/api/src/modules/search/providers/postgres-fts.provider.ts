import { Injectable, BadRequestException } from '@nestjs/common';
import { prisma } from '../../../database/client';
import { Prisma } from '../../../database/generated/prisma';
import { SearchQueryDto } from '../dto/search-query.dto';
import { SearchResultDto } from '../dto/search-result.dto';

@Injectable()
export class PostgresFtsProvider {
  async search(
    queryDto: SearchQueryDto,
  ): Promise<{ data: SearchResultDto[]; total: number; page: number; limit: number; query: string }> {
    const { q, page, limit, categorySlug, tag } = queryDto;

    // Reject empty queries (in case class-validator hasn't run or missed something)
    if (!q || !q.trim()) {
      throw new BadRequestException('Query cannot be empty');
    }

    const queryStr = q.trim();
    const offset = (page - 1) * limit;

    const whereFragment = this.buildWhereFragment(queryStr, categorySlug, tag);

    const countQuery = Prisma.sql`
      SELECT CAST(COUNT(*) AS INTEGER) as total
      FROM article_revisions r
        CROSS JOIN plainto_tsquery('english', ${queryStr}) AS query
        JOIN articles a
          ON  a."currentPublishedRevisionId" = r.id
          AND a.status    = 'PUBLISHED'
          AND a."deletedAt" IS NULL
          AND a."currentPublishedRevisionId" IS NOT NULL
        LEFT JOIN categories c ON a."categoryId" = c.id
      ${whereFragment}
    `;

    const resultQuery = Prisma.sql`
      SELECT
        a.id,
        a.slug,
        r.title,
        r.excerpt,
        r."createdAt" AS "publishedRevisionCreatedAt",
        a."publishedAt",
        (a."coverMediaId" IS NOT NULL AND m.status = 'READY') AS "hasCoverImage",
        CASE WHEN a."coverMediaId" IS NOT NULL AND m.status = 'READY' THEN m."mimeType" ELSE NULL END AS "coverMimeType",
        CASE WHEN a."coverMediaId" IS NOT NULL AND m.status = 'READY' THEN m.width ELSE NULL END AS "coverWidth",
        CASE WHEN a."coverMediaId" IS NOT NULL AND m.status = 'READY' THEN m.height ELSE NULL END AS "coverHeight",
        ts_headline(
          'english',
          r.body,
          query,
          'StartSel=<b>,StopSel=</b>,MaxWords=35,MinWords=15,ShortWord=3,HighlightAll=false'
        ) AS headline,
        ts_rank(r."searchVector", query) AS rank,
        c.id AS "categoryId",
        c.name AS "categoryName",
        c.slug AS "categorySlug",
        ap."displayName" AS "authorDisplayName",
        ap.bio AS "authorBio",
        ap."avatarUrl" AS "authorAvatarUrl",
        COALESCE(
          (
            SELECT array_agg(t.name)
            FROM article_tags at_join
            JOIN tags t ON at_join."tagId" = t.id
            WHERE at_join."articleId" = a.id
          ),
          ARRAY[]::text[]
        ) as tags
      FROM article_revisions r
        CROSS JOIN plainto_tsquery('english', ${queryStr}) AS query
        JOIN articles a
          ON  a."currentPublishedRevisionId" = r.id
          AND a.status    = 'PUBLISHED'
          AND a."deletedAt" IS NULL
          AND a."currentPublishedRevisionId" IS NOT NULL
        LEFT JOIN media m          ON a."coverMediaId" = m.id
        LEFT JOIN categories c     ON a."categoryId"   = c.id
        LEFT JOIN author_profiles ap ON a."primaryAuthorId" = ap."userId"
      ${whereFragment}
      ORDER BY rank DESC, a."publishedAt" DESC, a.id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const [[countResult], results] = await Promise.all([
      prisma.$queryRaw<[{ total: number }]>(countQuery),
      prisma.$queryRaw<any[]>(resultQuery),
    ]);

    const data: SearchResultDto[] = results.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      publishedRevisionCreatedAt: row.publishedRevisionCreatedAt.toISOString(),
      hasCoverImage: row.hasCoverImage,
      coverWidth: row.coverWidth,
      coverHeight: row.coverHeight,
      coverMimeType: row.coverMimeType,
      headline: this.sanitizeHeadline(row.headline),
      rank: row.rank,
      category: row.categoryId
        ? {
            id: row.categoryId,
            name: row.categoryName,
            slug: row.categorySlug,
          }
        : null,
      author: {
        displayName: row.authorDisplayName,
        bio: row.authorBio,
        avatarUrl: row.authorAvatarUrl,
      },
      tags: row.tags || [],
    }));

    return {
      data,
      total: countResult?.total || 0,
      page,
      limit,
      query: queryStr,
    };
  }

  private buildWhereFragment(query: string, categorySlug?: string, tag?: string): Prisma.Sql {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`r."searchVector" @@ plainto_tsquery('english', ${query})`,
    ];

    if (categorySlug !== undefined) {
      conditions.push(Prisma.sql`c.slug = ${categorySlug}`);
    }

    if (tag !== undefined) {
      conditions.push(Prisma.sql`
        EXISTS (
          SELECT 1
          FROM   article_tags  at2
          JOIN   tags          t2  ON at2."tagId" = t2.id
          WHERE  at2."articleId" = a.id
            AND  LOWER(t2.name)  = LOWER(${tag})
        )
      `);
    }

    return conditions.length === 0
      ? Prisma.empty
      : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  }

  public sanitizeHeadline(raw: string | null): string | null {
    if (!raw) return null;
    const sanitized = raw
      .replace(/<(?!\/?b(?:\s*>))[^>]*>/gi, '')
      .replace(/<b\b[^>]*>/gi, '<b>')
      .replace(/<\/b\b[^>]*>/gi, '</b>');
    return sanitized.trim() || null;
  }
}
