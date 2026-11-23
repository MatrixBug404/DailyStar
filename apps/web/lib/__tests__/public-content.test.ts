import {
  PublicArticleSummary,
  PublicCategory,
  articleHref,
  articlePublishedAt,
  authorDisplayName,
  categoryHref,
  categoryNameFromSlug,
  categoryPageHref,
  findCategoryBySlug,
  flattenCategories,
  formatArticleDate,
  formatEditionDate,
  normalizeTags,
  parsePageParam,
  searchPageHref,
} from '../public-content';

const categories: PublicCategory[] = [
  {
    id: 'c1',
    name: 'Politics',
    slug: 'politics',
    parentId: null,
    publishedArticleCount: 4,
    children: [
      {
        id: 'c2',
        name: 'Policy',
        slug: 'policy',
        parentId: 'c1',
        publishedArticleCount: 2,
        children: [],
      },
    ],
  },
  {
    id: 'c3',
    name: 'Sport',
    slug: 'sport',
    parentId: null,
    publishedArticleCount: 9,
    children: [],
  },
];

const article: PublicArticleSummary = {
  id: 'a1',
  slug: 'budget-session',
  title: 'Budget session opens',
  excerpt: 'A summary.',
  publishedAt: '2026-11-13T04:30:00.000Z',
  publishedRevisionCreatedAt: '2026-11-13T03:00:00.000Z',
  hasCoverImage: true,
  coverWidth: 1200,
  coverHeight: 675,
  coverMimeType: 'image/jpeg',
  category: { id: 'c1', name: 'Politics', slug: 'politics' },
  author: { displayName: 'Asha Menon', bio: null, avatarUrl: null },
  tags: ['budget'],
};

describe('public content helpers', () => {
  it('formats the edition date in Asia/Kolkata with a stable ISO value', () => {
    // 2026-11-13T20:00Z is already 14 November in Kolkata.
    const edition = formatEditionDate(new Date('2026-11-13T20:00:00.000Z'));

    expect(edition.iso).toBe('2026-11-14');
    expect(edition.label).toContain('Saturday');
    expect(edition.label).toContain('14 November 2026');
  });

  it('uses the publication timestamp and falls back to the revision date', () => {
    expect(articlePublishedAt(article)).toBe('2026-11-13T04:30:00.000Z');
    expect(
      articlePublishedAt({ ...article, publishedAt: null }),
    ).toBe('2026-11-13T03:00:00.000Z');
    expect(
      articlePublishedAt({
        ...article,
        publishedAt: null,
        publishedRevisionCreatedAt: '',
      }),
    ).toBeNull();
  });

  it('formats article dates and rejects invalid timestamps', () => {
    expect(formatArticleDate('2026-11-13T04:30:00.000Z')).toBe('13 Nov 2026');
    expect(formatArticleDate(null)).toBeNull();
    expect(formatArticleDate('')).toBeNull();
    expect(formatArticleDate('not-a-date')).toBeNull();
  });

  it('flattens the category tree depth-first', () => {
    expect(
      flattenCategories(categories).map(({ category, depth }) => [category.slug, depth]),
    ).toEqual([
      ['politics', 0],
      ['policy', 1],
      ['sport', 0],
    ]);
  });

  it('builds public route paths', () => {
    expect(articleHref('budget-session')).toBe('/article/budget-session');
    expect(categoryHref('politics')).toBe('/category/politics');
  });

  it('normalizes only valid, 1-based page parameters', () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam('')).toBe(1);
    expect(parsePageParam('0')).toBe(1);
    expect(parsePageParam('-3')).toBe(1);
    expect(parsePageParam('2.5')).toBe(1);
    expect(parsePageParam('not-a-page')).toBe(1);
    expect(parsePageParam('3')).toBe(3);
    expect(parsePageParam(['4', '5'])).toBe(4);
  });

  it('builds pagination URLs without redundant page=1 parameters', () => {
    expect(categoryPageHref('politics', 1)).toBe('/category/politics');
    expect(categoryPageHref('politics', 2)).toBe('/category/politics?page=2');
    expect(searchPageHref('budget', 1)).toBe('/search?q=budget');
    expect(searchPageHref('union budget', 3)).toBe('/search?q=union+budget&page=3');
  });

  it('finds nested sections and provides a fallback display name', () => {
    expect(findCategoryBySlug(categories, 'policy')?.name).toBe('Policy');
    expect(findCategoryBySlug(categories, 'missing')).toBeNull();
    expect(categoryNameFromSlug('union-budget')).toBe('Union Budget');
  });

  it('normalizes missing authors and empty tags safely', () => {
    expect(authorDisplayName(article.author)).toBe('Asha Menon');
    expect(authorDisplayName({ displayName: '   ', bio: null, avatarUrl: null })).toBeNull();
    expect(authorDisplayName(undefined)).toBeNull();
    expect(normalizeTags([' Budget ', '', 'Economy'])).toEqual(['Budget', 'Economy']);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
  });
});
