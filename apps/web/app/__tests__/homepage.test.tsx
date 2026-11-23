import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomePage from '../page';
import { fetchPublicApi } from '../../lib/api';
import { PublicArticleSummary, PublicCategory } from '../../lib/public-content';

jest.mock('../../lib/api');
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/'),
}));

const categories: PublicCategory[] = [
  {
    id: 'c1',
    name: 'Politics',
    slug: 'politics',
    parentId: null,
    publishedArticleCount: 4,
    children: [],
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

const makeArticle = (overrides: Partial<PublicArticleSummary> = {}): PublicArticleSummary => ({
  id: 'a1',
  slug: 'budget-session',
  title: 'Budget session opens with jobs pledge',
  excerpt: 'The government opened the budget session with a focus on employment.',
  publishedAt: '2026-11-13T04:30:00.000Z',
  publishedRevisionCreatedAt: '2026-11-13T04:00:00.000Z',
  hasCoverImage: true,
  coverWidth: 1200,
  coverHeight: 675,
  coverMimeType: 'image/jpeg',
  category: { id: 'c1', name: 'Politics', slug: 'politics' },
  author: { displayName: 'Asha Menon', bio: null, avatarUrl: null },
  tags: ['budget'],
  ...overrides,
});

const lead = makeArticle();

const supporting = [
  makeArticle({
    id: 'a2',
    slug: 'monsoon-forecast',
    title: 'Monsoon forecast points to a late retreat',
    excerpt: null,
    hasCoverImage: false,
    coverWidth: null,
    coverHeight: null,
    coverMimeType: null,
    category: { id: 'c3', name: 'Sport', slug: 'sport' },
    author: { displayName: ' ', bio: null, avatarUrl: null },
  }),
  makeArticle({
    id: 'a3',
    slug: 'rail-expansion',
    title: 'Rail expansion clears its final hurdle',
    category: { id: 'c1', name: 'Politics', slug: 'politics' },
    author: { displayName: 'Ravi Iyer', bio: null, avatarUrl: null },
  }),
  makeArticle({
    id: 'a4',
    slug: 'state-league',
    title: 'State league finds a new title contender',
    category: { id: 'c3', name: 'Sport', slug: 'sport' },
    author: { displayName: 'Neha Rao', bio: null, avatarUrl: null },
  }),
];

const latest = [
  makeArticle({
    id: 'a5',
    slug: 'city-water',
    title: 'City water plan enters its next phase',
    category: null,
    author: { displayName: 'Karan Shah', bio: null, avatarUrl: null },
    hasCoverImage: false,
    coverWidth: null,
    coverHeight: null,
    coverMimeType: null,
    tags: [],
  }),
  makeArticle({
    id: 'a6',
    slug: 'school-results',
    title: 'School results show a steady recovery',
  }),
];

const allArticles = [lead, ...supporting, ...latest];

function mockApi(articles: PublicArticleSummary[]) {
  (fetchPublicApi as jest.Mock).mockImplementation((path: string) => {
    if (path === '/public/categories') {
      return Promise.resolve(categories);
    }
    if (path.startsWith('/public/articles')) {
      return Promise.resolve({
        data: articles,
        total: articles.length,
        page: 1,
        limit: 20,
      });
    }
    return Promise.resolve(null);
  });
}

describe('HomePage', () => {
  beforeEach(() => {
    mockApi(allArticles);
  });

  it('renders a lead story, supporting headlines and the latest grid from API data', async () => {
    render(await HomePage());

    expect(screen.getByRole('heading', { level: 1, name: 'DailyStar latest news' })).toBeInTheDocument();

    const top = screen.getByRole('region', { name: 'Top stories' });
    const leadLinks = within(top).getAllByRole('link', { name: lead.title });
    // The headline is the single link; the cover is decorative.
    expect(leadLinks).toHaveLength(1);
    expect(leadLinks[0]).toHaveAttribute('href', '/article/budget-session');

    const leadArticle = leadLinks[0].closest('article');
    expect(leadArticle).not.toBeNull();

    const leadImage = (leadArticle as HTMLElement).querySelector('img');
    expect(leadImage).not.toBeNull();
    expect(leadImage).toHaveAttribute('src', '/og-image/budget-session');
    expect(leadImage).toHaveAttribute('alt', '');
    expect(leadImage).toHaveAttribute('width', '1200');
    expect(leadImage).toHaveAttribute('height', '675');
    expect(
      within(leadArticle as HTMLElement).getByRole('link', { name: 'Politics' }),
    ).toHaveAttribute('href', '/category/politics');
    expect(within(leadArticle as HTMLElement).getByText('Asha Menon')).toBeInTheDocument();
    expect(
      within(leadArticle as HTMLElement).getByText(
        'The government opened the budget session with a focus on employment.',
      ),
    ).toBeInTheDocument();

    const time = within(leadArticle as HTMLElement).getByText('13 Nov 2026');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-11-13T04:30:00.000Z');

    const moreHeadlines = screen.getByRole('complementary', { name: 'More headlines' });
    expect(
      within(moreHeadlines).getByRole('link', { name: supporting[0].title }),
    ).toHaveAttribute('href', '/article/monsoon-forecast');
    expect(within(moreHeadlines).getAllByRole('heading', { level: 3 })).toHaveLength(3);

    const latestRegion = screen.getByRole('region', { name: 'Latest news' });
    expect(within(latestRegion).getAllByRole('heading', { level: 3 })).toHaveLength(2);
    const latestLinks = within(latestRegion).getAllByRole('link', { name: latest[0].title });
    // The headline is the single link; the cover is decorative.
    expect(latestLinks).toHaveLength(1);
    expect(latestLinks[0]).toHaveAttribute('href', '/article/city-water');
  });

  it('shows a designed placeholder for a story without a cover and omits missing authors', async () => {
    render(await HomePage());

    const storyLinks = screen.getAllByRole('link', { name: latest[0].title });
    const article = storyLinks[0].closest('article') as HTMLElement;

    expect(within(article).queryByRole('img')).not.toBeInTheDocument();
    expect(within(article).getByText('DailyStar')).toBeInTheDocument();
    // The missing-cover placeholder is itself a link to the article.
    expect(
      within(article).getAllByRole('link').some((link) =>
        link.getAttribute('href') === '/article/city-water',
      ),
    ).toBe(true);
    expect(within(article).queryByText('undefined')).not.toBeInTheDocument();
    expect(within(article).getByText('13 Nov 2026')).toBeInTheDocument();
    expect(within(article).queryByRole('link', { name: /politics|sport/i })).not.toBeInTheDocument();
  });

  it('renders a designed empty state when nothing is published', async () => {
    mockApi([]);

    render(await HomePage());

    expect(screen.getByRole('heading', { name: 'No published stories yet' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Top stories' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Latest news' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: 'Search DailyStar' })) {
      expect(link).toHaveAttribute('href', '/search');
    }
  });

  it('keeps the API error contract instead of masking failures', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (fetchPublicApi as jest.Mock).mockRejectedValue(new Error('API offline'));

    await expect(HomePage()).rejects.toThrow('API offline');
    warn.mockRestore();
  });
});
