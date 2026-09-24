import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '../../database/client';
import { Prisma } from '../../database/generated/prisma';
import { PostgresFtsProvider } from '../search/providers/postgres-fts.provider';
import { PublicFeedQueryDto } from './dto/public-feed-query.dto';
import { CategoryArticlesQueryDto } from './dto/category-articles-query.dto';
import { PublicArticleSummaryDto } from './dto/public-article-summary.dto';
import { PublicArticleFullDto } from './dto/public-article-full.dto';
import { PublicCategoryDto } from './dto/public-category.dto';
import { SearchQueryDto } from '../search/dto/search-query.dto';

@Injectable()
export class PublicService {
  constructor(private readonly postgresFtsProvider: PostgresFtsProvider) {}

  private readonly tripleGate = {
    status: 'PUBLISHED' as const,
    deletedAt: null,
    currentPublishedRevisionId: { not: null },
  };

  async getArticles(query: PublicFeedQueryDto) {
    const { page, limit, categoryId, categorySlug, tag, orderBy, order } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ArticleWhereInput = {
      ...this.tripleGate,
    };

    if (categoryId) {
      where.categoryId = categoryId;
    } else if (categorySlug) {
      where.category = { slug: categorySlug };
    }

    if (tag) {
      where.tags = {
        some: {
          tag: {
            name: {
              equals: tag,
              mode: 'insensitive',
            },
          },
        },
      };
    }

    const [total, articles] = await Promise.all([
      prisma.article.count({ where }),
      prisma.article.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [orderBy]: order },
        include: {
          currentPublishedRevision: true,
          coverMedia: true,
          category: true,
          primaryAuthor: true,
          tags: {
            include: { tag: true },
          },
        },
      }),
    ]);

    const data: PublicArticleSummaryDto[] = articles.map((article) => this.mapToSummary(article));

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async getArticle(slug: string): Promise<PublicArticleFullDto> {
    const article = await prisma.article.findFirst({
      where: {
        slug,
        ...this.tripleGate,
      },
      include: {
        currentPublishedRevision: true,
        coverMedia: true,
        category: true,
        primaryAuthor: true,
        tags: {
          include: { tag: true },
        },
      },
    });

    if (!article) {
      throw new NotFoundException();
    }

    return this.mapToFull(article);
  }

  async getCategories(): Promise<PublicCategoryDto[]> {
    const categoriesWithCount = await prisma.category.findMany({
      include: {
        _count: {
          select: {
            articles: {
              where: {
                ...this.tripleGate,
              },
            },
          },
        },
      },
    });

    const eligibleCategoryIds = new Set(
      categoriesWithCount
        .filter((c) => c._count.articles > 0)
        .map((c) => c.id)
    );

    const visibleCategoryIds = new Set<string>();
    
    for (const id of eligibleCategoryIds) {
      let currentId: string | null = id;
      while (currentId) {
        visibleCategoryIds.add(currentId);
        const parent = categoriesWithCount.find((c) => c.id === currentId)?.parentId;
        currentId = parent || null;
      }
    }

    const visibleCategories = categoriesWithCount.filter((c) => visibleCategoryIds.has(c.id));
    const categoryMap = new Map<string, PublicCategoryDto>();
    const rootCategories: PublicCategoryDto[] = [];

    for (const c of visibleCategories) {
      categoryMap.set(c.id, {
        id: c.id,
        name: c.name,
        slug: c.slug,
        parentId: c.parentId,
        publishedArticleCount: c._count.articles,
        children: [],
      });
    }

    for (const c of visibleCategories) {
      const dto = categoryMap.get(c.id)!;
      if (c.parentId && categoryMap.has(c.parentId)) {
        categoryMap.get(c.parentId)!.children.push(dto);
      } else {
        rootCategories.push(dto);
      }
    }

    const sortTree = (nodes: PublicCategoryDto[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      nodes.forEach((n) => sortTree(n.children));
    };
    sortTree(rootCategories);

    return rootCategories;
  }

  async getCategoryArticles(slug: string, query: CategoryArticlesQueryDto) {
    const category = await prisma.category.findUnique({
      where: { slug },
    });

    if (!category) {
      throw new NotFoundException();
    }

    const { page, limit, tag, orderBy, order } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ArticleWhereInput = {
      categoryId: category.id,
      ...this.tripleGate,
    };

    if (tag) {
      where.tags = {
        some: {
          tag: {
            name: {
              equals: tag,
              mode: 'insensitive',
            },
          },
        },
      };
    }

    const total = await prisma.article.count({ where });

    if (total === 0) {
      throw new NotFoundException();
    }

    const articles = await prisma.article.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [orderBy]: order },
      include: {
        currentPublishedRevision: true,
        coverMedia: true,
        category: true,
        primaryAuthor: true,
        tags: {
          include: { tag: true },
        },
      },
    });

    const data: PublicArticleSummaryDto[] = articles.map((article) => this.mapToSummary(article));

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async search(query: SearchQueryDto) {
    return this.postgresFtsProvider.search(query);
  }

  private mapToSummary(article: any): PublicArticleSummaryDto {
    const revision = article.currentPublishedRevision;
    const media = article.coverMedia;

    return {
      id: article.id,
      slug: article.slug,
      title: revision.title,
      excerpt: revision.excerpt,
      publishedAt: article.publishedAt.toISOString(),
      publishedRevisionCreatedAt: revision.createdAt.toISOString(),
      hasCoverImage: media != null && media.status === 'READY',
      coverWidth: media != null && media.status === 'READY' ? media.width : null,
      coverHeight: media != null && media.status === 'READY' ? media.height : null,
      coverMimeType: media != null && media.status === 'READY' ? media.mimeType : null,
      category: article.category
        ? {
            id: article.category.id,
            name: article.category.name,
            slug: article.category.slug,
          }
        : null,
      author: {
        displayName: article.primaryAuthor.displayName,
        bio: article.primaryAuthor.bio,
        avatarUrl: article.primaryAuthor.avatarUrl,
      },
      tags: article.tags.map((at: any) => at.tag.name),
    };
  }

  private mapToFull(article: any): PublicArticleFullDto {
    const revision = article.currentPublishedRevision;
    const media = article.coverMedia;

    return {
      id: article.id,
      slug: article.slug,
      title: revision.title,
      excerpt: revision.excerpt,
      body: revision.body,
      publishedAt: article.publishedAt.toISOString(),
      publishedRevisionCreatedAt: revision.createdAt.toISOString(),
      hasCoverImage: media != null && media.status === 'READY',
      coverWidth: media != null && media.status === 'READY' ? media.width : null,
      coverHeight: media != null && media.status === 'READY' ? media.height : null,
      coverMimeType: media != null && media.status === 'READY' ? media.mimeType : null,
      category: article.category
        ? {
            id: article.category.id,
            name: article.category.name,
            slug: article.category.slug,
          }
        : null,
      author: {
        displayName: article.primaryAuthor.displayName,
        bio: article.primaryAuthor.bio,
        avatarUrl: article.primaryAuthor.avatarUrl,
      },
      tags: article.tags.map((at: any) => at.tag.name),
    };
  }
}
