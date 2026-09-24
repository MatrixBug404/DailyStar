import { render, screen } from '@testing-library/react';
import HomePage, { revalidate as homeRevalidate } from '../page';
import ArticlePage, { revalidate as articleRevalidate } from '../article/[slug]/page';
import CategoryPage, { revalidate as categoryRevalidate } from '../category/[slug]/page';
import SearchPage, { dynamic as searchDynamic } from '../search/page';

const mockNotFound = jest.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
  notFound: () => mockNotFound(),
}));

jest.mock('../../lib/api', () => ({
  fetchPublicApi: jest.fn(),
}));

import { fetchPublicApi } from '../../lib/api';

describe('Public Pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('HomePage', () => {
    it('exports revalidate = 60', () => {
      expect(homeRevalidate).toBe(60);
    });

    it('renders article data from mocked API', async () => {
      (fetchPublicApi as jest.Mock).mockResolvedValueOnce({
        data: [
          {
            id: '1',
            slug: 'test-article',
            title: 'Test Headline',
            excerpt: 'Test Excerpt',
            publishedRevisionCreatedAt: new Date().toISOString(),
            primaryAuthor: { displayName: 'Author Name' },
          },
        ],
      });

      const ui = await HomePage();
      render(ui);

      expect(screen.getByText('Test Headline')).toBeInTheDocument();
      expect(screen.getByText('Test Excerpt')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Test Headline' })).toHaveAttribute('href', '/article/test-article');
    });
  });

  describe('ArticlePage', () => {
    it('exports revalidate = 300', () => {
      expect(articleRevalidate).toBe(300);
    });

    it('uses /og-image/[slug] for cover, never presigned URL', async () => {
      (fetchPublicApi as jest.Mock).mockResolvedValueOnce({
        id: '1',
        title: 'Article Cover Test',
        body: 'Body text',
        slug: 'test-cover',
        publishedRevisionCreatedAt: new Date().toISOString(),
        hasCoverImage: true,
      });

      const params = Promise.resolve({ slug: 'test-cover' });
      const ui = await ArticlePage({ params });
      render(ui);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', '/og-image/test-cover');
      expect(img.getAttribute('src')).not.toContain('http'); // No presigned URL
    });
  });

  describe('CategoryPage', () => {
    it('exports revalidate = 300', () => {
      expect(categoryRevalidate).toBe(300);
    });

    it('triggers notFound() when API returns 404 (null)', async () => {
      (fetchPublicApi as jest.Mock).mockResolvedValueOnce(null);

      const params = Promise.resolve({ slug: 'empty-cat' });
      try {
        await CategoryPage({ params });
      } catch (e: any) {
        expect(e.message).toBe('NEXT_NOT_FOUND');
      }

      expect(mockNotFound).toHaveBeenCalled();
    });
  });

  describe('SearchPage', () => {
    it('has no ISR/revalidate and sets dynamic = force-dynamic', () => {
      // @ts-expect-error test
      expect(SearchPage.revalidate).toBeUndefined();
      expect(searchDynamic).toBe('force-dynamic');
    });

    it('renders sanitized <b> markup using dangerouslySetInnerHTML', async () => {
      (fetchPublicApi as jest.Mock).mockResolvedValueOnce({
        data: [
          {
            article: {
              id: '1',
              slug: 'test-search',
              publishedRevisionCreatedAt: new Date().toISOString(),
            },
            headline: 'Search <b>Highlight</b>',
          },
        ],
      });

      const searchParams = Promise.resolve({ q: 'highlight' });
      const ui = await SearchPage({ searchParams });
      render(ui);

      // The <b> tag should be rendered as HTML, meaning we can find the text 'Highlight' inside a B element
      const highlightEl = screen.getByText('Highlight');
      expect(highlightEl.tagName).toBe('B');
    });
  });
});
