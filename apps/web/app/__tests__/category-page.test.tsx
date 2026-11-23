import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import CategoryPage, { generateMetadata } from '../category/[slug]/page';
import { fetchPublicApi } from '../../lib/api';
import {
  PublicArticleSummary,
  PublicArticlesResponse,
  PublicCategory,
} from '../../lib/public-content';

const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const mockRedirect = jest.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

jest.mock('next/navigation', () => ({
  usePathname: () => '/category/politics',
  notFound: () => mockNotFound(),
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

const article: PublicArticleSummary = {
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
  tags: ['Budget'],
};

function listResponse(overrides: Partial<PublicArticlesResponse> = {}): PublicArticlesResponse {
  return {
    data: [article],
    total: 1,
    page: 1,
    limit: 10,
    ...overrides,
  };
}

function mockCategoryApi(value: PublicArticlesResponse | null = listResponse()) {
  (fetchPublicApi as jest.Mock).mockImplementation((path: string) => {
    if (path === '/public/categories') {
      return Promise.resolve(categories);
    }
    if (path.startsWith('/public/categories/politics/articles')) {
      return Promise.resolve(value);
    }
    return Promise.resolve(null);
  });
}

function renderCategory(value: PublicArticlesResponse | null = listResponse(), page?: string) {
  mockCategoryApi(value);
  return CategoryPage({
    params: Promise.resolve({ slug: 'politics' }),
    searchParams: Promise.resolve(page ? { page } : {}),
  });
}

describe('CategoryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the section name, author and semantic date without legacy styling', async () => {
    render(await renderCategory());

    expect(screen.getByRole('heading', { level: 1, name: 'Politics' })).toBeInTheDocument();
    expect(screen.queryByText(/Category:/)).not.toBeInTheDocument();
    expect(screen.getByText('Asha Menon')).toBeInTheDocument();

    const time = screen.getByText('13 Nov 2026');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-11-13T04:30:00.000Z');

    expect(fetchPublicApi).toHaveBeenCalledWith(
      '/public/categories/politics/articles?page=1&limit=10',
    );
  });

  it('does not leave orphaned punctuation when the author is missing', async () => {
    render(
      await renderCategory(
        listResponse({
          data: [
            {
              ...article,
              author: { displayName: ' ', bio: null, avatarUrl: null },
            },
          ],
        }),
      ),
    );

    const card = screen.getByRole('article');
    expect(within(card).queryByText('·')).not.toBeInTheDocument();
    expect(within(card).getByText('13 Nov 2026')).toBeInTheDocument();
  });

  it('reports the current page and preserves page links', async () => {
    render(await renderCategory(listResponse({ total: 25, page: 2 }), '2'));

    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText(/Page 2 of 3/)).toBeInTheDocument();
    expect(within(pagination).getByText(/25 stories/)).toBeInTheDocument();
    expect(within(pagination).getByRole('link', { name: /Next/ })).toHaveAttribute(
      'href',
      '/category/politics?page=3',
    );
    expect(within(pagination).getByRole('link', { name: /Previous/ })).toHaveAttribute(
      'href',
      '/category/politics',
    );
  });

  it('redirects a page beyond the last page', async () => {
    await expect(
      renderCategory(listResponse({ data: [], total: 25, page: 9 }), '9'),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith('/category/politics?page=3');
  });

  it('renders a designed empty state when a section has no stories', async () => {
    render(await renderCategory(listResponse({ data: [], total: 0 })));

    expect(
      screen.getByRole('heading', { name: 'No stories in this section yet' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Search DailyStar' }),
    ).toHaveAttribute('href', '/search');
  });

  it('calls notFound() when the category API returns 404 (null)', async () => {
    await expect(renderCategory(null)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('still renders content when optional category navigation fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    (fetchPublicApi as jest.Mock).mockImplementation((path: string) => {
      if (path === '/public/categories') {
        return Promise.reject(new Error('navigation offline'));
      }
      if (path.startsWith('/public/categories/politics/articles')) {
        return Promise.resolve(listResponse());
      }
      return Promise.resolve(null);
    });

    render(
      await CategoryPage({
        params: Promise.resolve({ slug: 'politics' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Politics' })).toBeInTheDocument();
    expect(screen.getByText('Asha Menon')).toBeInTheDocument();
    warn.mockRestore();
  });

  it('emits a section title and canonical URL', async () => {
    (fetchPublicApi as jest.Mock).mockResolvedValue(categories);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'politics' }),
    });

    expect(metadata.title).toBe('Politics');
    expect(metadata.alternates).toEqual({ canonical: '/category/politics' });
  });
});
