import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ArticlePage, { generateMetadata } from '../article/[slug]/page';
import { fetchPublicApi } from '../../lib/api';
import { PublicArticleFull, PublicCategory } from '../../lib/public-content';

const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const mockRedirect = jest.fn(() => {
  throw new Error('NEXT_REDIRECT');
});

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
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

const article: PublicArticleFull = {
  id: 'a1',
  slug: 'budget-session',
  title: 'Budget session opens with jobs pledge',
  excerpt: 'The government opened the budget session with a focus on employment.',
  body: [
    '# A long session',
    '',
    'The house met with **record attendance** and a [live briefing](/search).',
    '',
    '- Jobs guarantee',
    '- Rail expansion',
  ].join('\n'),
  publishedAt: '2026-11-13T04:30:00.000Z',
  publishedRevisionCreatedAt: '2026-11-13T04:00:00.000Z',
  hasCoverImage: true,
  coverWidth: 1200,
  coverHeight: 675,
  coverMimeType: 'image/jpeg',
  category: { id: 'c1', name: 'Politics', slug: 'politics' },
  author: {
    displayName: 'Asha Menon',
    bio: 'Asha Menon covers parliament and public policy.',
    avatarUrl: null,
  },
  tags: ['Budget', 'Economy'],
};

function mockArticleApi(value: PublicArticleFull | null = article) {
  (fetchPublicApi as jest.Mock).mockImplementation((path: string) => {
    if (path === '/public/categories') {
      return Promise.resolve(categories);
    }
    if (path.startsWith('/public/articles/')) {
      return Promise.resolve(value);
    }
    return Promise.resolve(null);
  });
}

function renderArticle(value: PublicArticleFull = article) {
  mockArticleApi(value);
  return ArticlePage({ params: Promise.resolve({ slug: value.slug }) });
}

describe('ArticlePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders string tags and the Markdown body without crashing', async () => {
    const { container } = render(await renderArticle());

    expect(screen.getByRole('heading', { level: 1, name: article.title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'A long session' })).toBeInTheDocument();
    expect(screen.getByText('record attendance').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'live briefing' })).toHaveAttribute(
      'href',
      '/search',
    );

    expect(screen.getByText('#Budget')).toBeInTheDocument();
    expect(screen.getByText('#Economy')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });

  it('handles an article with no tags', async () => {
    render(await renderArticle({ ...article, tags: [] }));

    expect(screen.queryByText('Tags')).not.toBeInTheDocument();
    expect(screen.queryByText('#Budget')).not.toBeInTheDocument();
  });

  it('handles a partial payload where tags are missing entirely', async () => {
    render(
      await renderArticle({
        ...article,
        tags: undefined as unknown as string[],
      }),
    );

    expect(screen.queryByText('Tags')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: article.title })).toBeInTheDocument();
  });

  it('renders the real author field and a semantic publication date', async () => {
    render(await renderArticle());

    expect(screen.getByText('Asha Menon')).toBeInTheDocument();
    expect(screen.getByText('Asha Menon covers parliament and public policy.')).toBeInTheDocument();

    const time = screen.getByText('13 Nov 2026');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-11-13T04:30:00.000Z');
  });

  it('omits the author and separator cleanly when no author is supplied', async () => {
    render(
      await renderArticle({
        ...article,
        author: { displayName: '   ', bio: null, avatarUrl: null },
      }),
    );

    expect(screen.queryByText('·')).not.toBeInTheDocument();
    expect(screen.queryByText('Asha Menon')).not.toBeInTheDocument();
    expect(screen.getByText('13 Nov 2026')).toBeInTheDocument();
  });

  it('uses the cover proxy with intrinsic dimensions and decorative alt text', async () => {
    const { container } = render(await renderArticle());

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('src', '/og-image/budget-session');
    expect(image?.getAttribute('src')).not.toContain('http');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('width', '1200');
    expect(image).toHaveAttribute('height', '675');
    expect(container.querySelector('a img')).toBeNull();
  });

  it('calls notFound() when the article API returns 404 (null)', async () => {
    mockArticleApi(null);

    await expect(
      ArticlePage({ params: Promise.resolve({ slug: 'missing-story' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalled();
  });

  it('emits canonical, Open Graph article, author and publication metadata', async () => {
    (fetchPublicApi as jest.Mock).mockResolvedValue(article);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: article.slug }),
    });

    expect(metadata.title).toBe(article.title);
    expect(metadata.description).toBe(article.excerpt);
    expect(metadata.alternates).toEqual({ canonical: '/article/budget-session' });
    expect(metadata.openGraph).toMatchObject({
      type: 'article',
      title: article.title,
      url: '/article/budget-session',
      publishedTime: '2026-11-13T04:30:00.000Z',
      authors: ['Asha Menon'],
      images: [{ url: '/og-image/budget-session', width: 1200, height: 675 }],
    });
  });
});
