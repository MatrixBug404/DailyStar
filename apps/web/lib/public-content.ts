/**
 * Public newsroom types and presentation helpers.
 *
 * These mirror the public API DTOs (apps/api/src/modules/public/dto). The
 * backend mapper is authoritative: summaries expose `author` (not
 * `primaryAuthor`) and `tags` as plain strings.
 */

export interface PublicCategory {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  publishedArticleCount: number;
  children: PublicCategory[];
}

export interface PublicAuthor {
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
}

export interface PublicArticleSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  publishedAt: string | null;
  publishedRevisionCreatedAt: string;
  hasCoverImage: boolean;
  coverWidth: number | null;
  coverHeight: number | null;
  coverMimeType: string | null;
  category: {
    id: string;
    name: string;
    slug: string;
  } | null;
  author: PublicAuthor;
  tags: string[];
}

export interface PublicArticlesResponse {
  data: PublicArticleSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface PublicArticleFull extends PublicArticleSummary {
  body: string;
}

/** Flat search DTO: article fields sit alongside the highlighted headline. */
export interface PublicSearchResult extends PublicArticleSummary {
  headline: string | null;
  rank: number;
}

export interface PublicSearchResponse {
  data: PublicSearchResult[];
  total: number;
  page: number;
  limit: number;
  query: string;
}

/** API maximum is 50; these sizes keep public lists readable. */
export const CATEGORY_PAGE_SIZE = 10;
export const SEARCH_PAGE_SIZE = 10;

export interface FlatCategory {
  category: PublicCategory;
  depth: number;
}

const EDITION_TIME_ZONE = 'Asia/Kolkata';

/**
 * Newsroom edition date, rendered in Indian locale and Asia/Kolkata timezone.
 * `iso` is a stable `YYYY-MM-DD` value for `<time dateTime>`.
 */
export function formatEditionDate(date: Date = new Date()): { iso: string; label: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: EDITION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    iso: `${value('year')}-${value('month')}-${value('day')}`,
    label: new Intl.DateTimeFormat('en-IN', {
      timeZone: EDITION_TIME_ZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date),
  };
}

/** Published timestamp for display; falls back to the published revision date. */
export function articlePublishedAt(article: PublicArticleSummary): string | null {
  return article.publishedAt || article.publishedRevisionCreatedAt || null;
}

/** Trimmed author name, or null when the newsroom has not supplied one. */
export function authorDisplayName(
  author: PublicAuthor | null | undefined,
): string | null {
  const name = author?.displayName?.trim();
  return name ? name : null;
}

/** Drops empty tag values so a partial API payload cannot render blank chips. */
export function normalizeTags(tags: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** Short Indian-locale date, or null when the timestamp is missing/invalid. */
export function formatArticleDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: EDITION_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function articleHref(slug: string): string {
  return `/article/${slug}`;
}

export function categoryHref(slug: string): string {
  return `/category/${slug}`;
}

/** Valid, 1-based page number; malformed values fall back to page 1. */
export function parsePageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return 1;
  }

  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** Category page URL; page 1 stays canonical without a query string. */
export function categoryPageHref(slug: string, page: number): string {
  return page > 1 ? `${categoryHref(slug)}?page=${page}` : categoryHref(slug);
}

export function searchPageHref(query: string, page = 1): string {
  const params = new URLSearchParams({ q: query });
  if (page > 1) {
    params.set('page', String(page));
  }
  return `/search?${params.toString()}`;
}

/** Finds a section anywhere in the public category tree. */
export function findCategoryBySlug(
  categories: PublicCategory[],
  slug: string,
): PublicCategory | null {
  return (
    flattenCategories(categories).find(({ category }) => category.slug === slug)?.category ?? null
  );
}

/** Last-resort display name when optional category data is unavailable. */
export function categoryNameFromSlug(slug: string): string {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // Keep the raw slug when it is not valid percent-encoding.
  }

  return decoded
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Depth-first flattening of the public category tree (parents before children). */
export function flattenCategories(
  categories: PublicCategory[],
  depth = 0,
): FlatCategory[] {
  return categories.flatMap((category) => [
    { category, depth },
    ...flattenCategories(category.children ?? [], depth + 1),
  ]);
}
