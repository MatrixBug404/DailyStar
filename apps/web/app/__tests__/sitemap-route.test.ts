/**
 * @jest-environment node
 */
import { GET, revalidate } from '../sitemap.xml/route';
import * as api from '../../lib/api';

jest.mock('../../lib/api', () => ({
  fetchPublicApi: jest.fn(),
}));

describe('Sitemap Route', () => {
  const originalConsoleWarn = console.warn;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    console.warn = jest.fn();
    process.env = { ...originalEnv, NEXT_PUBLIC_SITE_URL: 'https://test.com' };
  });

  afterAll(() => {
    console.warn = originalConsoleWarn;
    process.env = originalEnv;
  });

  const mockCategories = (cats: any) => {
    (api.fetchPublicApi as jest.Mock).mockResolvedValueOnce(cats);
  };

  const mockArticles = (pages: any[]) => {
    const mock = api.fetchPublicApi as jest.Mock;
    pages.forEach(page => mock.mockResolvedValueOnce({ data: page }));
    // Return empty for subsequent calls
    mock.mockResolvedValue({ data: [] });
  };

  it('Test 1: homepage is included', async () => {
    mockCategories([]);
    mockArticles([]);
    const res = await GET();
    const xml = await res.text();
    expect(xml).toContain('<loc>https://test.com/</loc>');
  });

  it('Test 2: eligible category is included', async () => {
    mockCategories([{ slug: 'tech', publishedArticleCount: 5, children: [] }]);
    mockArticles([]);
    const res = await GET();
    const xml = await res.text();
    expect(xml).toContain('<loc>https://test.com/category/tech</loc>');
  });

  it('Test 3: category with publishedArticleCount = 0 is excluded', async () => {
    mockCategories([{ slug: 'empty', publishedArticleCount: 0, children: [] }]);
    mockArticles([]);
    const res = await GET();
    const xml = await res.text();
    expect(xml).not.toContain('empty');
  });

  it('Test 4: nested category tree is flattened correctly', async () => {
    mockCategories([{
      slug: 'parent', publishedArticleCount: 1, children: [
        { slug: 'child', publishedArticleCount: 2, children: [] }
      ]
    }]);
    mockArticles([]);
    const res = await GET();
    const xml = await res.text();
    expect(xml).toContain('parent');
    expect(xml).toContain('child');
  });

  it('Test 5, 6, 7: article/category generated correctly, lastmod uses publishedRevisionCreatedAt', async () => {
    mockCategories([{ slug: 'tech', publishedArticleCount: 1 }]);
    mockArticles([[{ slug: 'article-1', publishedRevisionCreatedAt: '2023-01-01T00:00:00.000Z' }]]);
    const res = await GET();
    const xml = await res.text();

    expect(xml).toContain('<loc>https://test.com/article/article-1</loc>');
    expect(xml).toContain('<loc>https://test.com/category/tech</loc>');
    expect(xml).toContain('<lastmod>2023-01-01T00:00:00.000Z</lastmod>');
  });

  it('Test 8, 9, 10, 11: pagination limits and combinations', async () => {
    mockCategories([]);

    // Page 1: 50 articles
    const page1 = Array.from({ length: 50 }, (_, i) => ({ slug: `a${i}`, publishedRevisionCreatedAt: '2023-01-01T00:00:00.000Z' }));
    // Page 2: 2 articles
    const page2 = [{ slug: 'b1', publishedRevisionCreatedAt: '2023-01-01T00:00:00.000Z' }, { slug: 'b2', publishedRevisionCreatedAt: '2023-01-01T00:00:00.000Z' }];

    mockArticles([page1, page2]);

    await GET();

    expect(api.fetchPublicApi).toHaveBeenCalledWith('/public/categories');
    expect(api.fetchPublicApi).toHaveBeenCalledWith('/public/articles?page=1&limit=50');
    expect(api.fetchPublicApi).toHaveBeenCalledWith('/public/articles?page=2&limit=50');
    expect(api.fetchPublicApi).toHaveBeenCalledTimes(3);
  });

  it('Test 12: 50,000 TOTAL URL boundary', async () => {
    mockCategories([]);

    // Generate an infinite stream of 50 item pages
    (api.fetchPublicApi as jest.Mock).mockImplementation(async (url) => {
      if (url === '/public/categories') return [];
      const pageData = Array.from({ length: 50 }, (_, i) => ({ slug: `slug-${i}`, publishedRevisionCreatedAt: '2023-01-01' }));
      return { data: pageData };
    });

    const res = await GET();
    const xml = await res.text();

    const urlMatches = xml.match(/<url>/g);
    // Should be exactly 50,000 (including homepage)
    expect(urlMatches?.length).toBe(50000);
    expect(console.warn).toHaveBeenCalledWith('Sitemap limit of 50000 reached during articles.');
  });

  it('Test 13, 14, 15: valid XML, missing search and og-image, revalidate = 3600', async () => {
    expect(revalidate).toBe(3600);

    mockCategories([]);
    mockArticles([]);
    const res = await GET();
    const xml = await res.text();

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).not.toContain('/search');
    expect(xml).not.toContain('/og-image');
  });

  it('escapes xml entities properly', async () => {
    mockCategories([]);
    mockArticles([[{ slug: 'article-&', publishedRevisionCreatedAt: '2023-01-01T00:00:00.000Z' }]]);
    const res = await GET();
    const xml = await res.text();
    expect(xml).toContain('<loc>https://test.com/article/article-&amp;</loc>');
  });
});
