import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import SearchPage, { metadata } from '../search/page';
import { fetchPublicApi } from '../../lib/api';
import {
  PublicCategory,
  PublicSearchResponse,
  PublicSearchResult,
} from '../../lib/public-content';

const mockRedirect = jest.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

jest.mock('next/navigation', () => ({
  usePathname: () => '/search',
  notFound: jest.fn(),
  redirect: (url: string) => mockRedirect(url),
}));

jest.mock('../../lib/api', () => ({
  fetchPublicApi: jest.fn(),
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
];

const result: PublicSearchResult = {
  id: 'a1',
  slug: 'budget-session',
  title: 'Budget session opens with jobs pledge',
  excerpt: 'The government opened the budget session with a focus on employment.',
  headline: 'Budget <b>session</b> opens with a jobs pledge',
  rank: 0.42,
  publishedAt: '2026-11-13T04:30:00.000Z',
  publishedRevisionCreatedAt: '2026-11-13T04:00:00.000Z',
  hasCoverImage: false,
  coverWidth: null,
  coverHeight: null,
  coverMimeType: null,
  category: { id: 'c1', name: 'Politics', slug: 'politics' },
  author: { displayName: 'Asha Menon', bio: null, avatarUrl: null },
  tags: ['Budget'],
};

const response: PublicSearchResponse = {
  data: [result],
  total: 1,
  page: 1,
  limit: 10,
  query: 'budget',
};

function mockSearchApi(value: PublicSearchResponse = response) {
  (fetchPublicApi as jest.Mock).mockImplementation((path: string) => {
    if (path === '/public/categories') {
      return Promise.resolve(categories);
    }
    if (path.startsWith('/public/search')) {
      return Promise.resolve(value);
    }
    return Promise.resolve(null);
  });
}

describe('SearchPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders flat results with the sanitized headline, author and date', async () => {
    mockSearchApi();

    render(await SearchPage({ searchParams: Promise.resolve({ q: 'budget' }) }));

    expect(screen.getByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Results for/ })).toHaveTextContent(
      '“budget”',
    );

    const pageInput = document.getElementById('page-query') as HTMLInputElement;
    expect(pageInput).toHaveValue('budget');

    const highlight = screen.getByText('session');
    expect(highlight.tagName).toBe('B');
    expect(screen.getByRole('link', { name: /Budget session opens/ })).toHaveAttribute(
      'href',
      '/article/budget-session',
    );

    expect(screen.getByText('Asha Menon')).toBeInTheDocument();
    const time = screen.getByText('13 Nov 2026');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-11-13T04:30:00.000Z');

    expect(fetchPublicApi).toHaveBeenCalledWith('/public/search?q=budget&page=1&limit=10');
  });

  it('fails loudly if a nested item.article fixture is reintroduced', async () => {
    (fetchPublicApi as jest.Mock).mockResolvedValue({
      data: [
        {
          article: { id: 'nested', slug: 'nested-story', title: 'Nested story' },
          headline: 'Nested <b>story</b>',
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
      query: 'nested',
    });

    await expect(
      SearchPage({ searchParams: Promise.resolve({ q: 'nested' }) }),
    ).rejects.toThrow('expected flat result objects');
  });

  it('shows a no-results state for an empty result set', async () => {
    mockSearchApi({ ...response, data: [], total: 0, query: 'missing' });

    render(await SearchPage({ searchParams: Promise.resolve({ q: 'missing' }) }));

    expect(screen.getByRole('heading', { name: 'No stories found' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing matches “missing”/)).toBeInTheDocument();
  });

  it('shows an empty-query state without requesting search', async () => {
    mockSearchApi();

    render(await SearchPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'Search the newsroom' })).toBeInTheDocument();
    const searchCalls = (fetchPublicApi as jest.Mock).mock.calls.filter(([path]) =>
      String(path).startsWith('/public/search'),
    );
    expect(searchCalls).toHaveLength(0);
  });

  it('preserves the query across pagination and reports the result count', async () => {
    mockSearchApi({ ...response, total: 25, page: 2 });

    render(
      await SearchPage({ searchParams: Promise.resolve({ q: 'budget', page: '2' }) }),
    );

    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText(/Page 2 of 3/)).toBeInTheDocument();
    expect(within(pagination).getByText(/25 stories/)).toBeInTheDocument();
    expect(within(pagination).getByRole('link', { name: /Next/ })).toHaveAttribute(
      'href',
      '/search?q=budget&page=3',
    );
    expect(within(pagination).getByRole('link', { name: /Previous/ })).toHaveAttribute(
      'href',
      '/search?q=budget',
    );

    expect(fetchPublicApi).toHaveBeenCalledWith('/public/search?q=budget&page=2&limit=10');
  });

  it('redirects an out-of-range page to the last valid search page', async () => {
    mockSearchApi({ ...response, data: [], total: 25, page: 9 });

    await expect(
      SearchPage({ searchParams: Promise.resolve({ q: 'budget', page: '9' }) }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith('/search?q=budget&page=3');
  });

  it('falls back to the plain title when no highlighted headline exists', async () => {
    mockSearchApi({ ...response, data: [{ ...result, headline: null }] });

    render(await SearchPage({ searchParams: Promise.resolve({ q: 'budget' }) }));

    expect(screen.getByRole('link', { name: result.title })).toHaveAttribute(
      'href',
      '/article/budget-session',
    );
  });

  it('keeps search out of the index', () => {
    expect(metadata.title).toBe('Search');
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});
