import robots from '../robots';

describe('Robots configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('1. returns MetadataRoute.Robots-compatible structure', () => {
    const res = robots();
    expect(res).toHaveProperty('rules');
    expect(res).toHaveProperty('sitemap');
  });

  it('2. allow = "/"', () => {
    const res = robots();
    expect(Array.isArray(res.rules) ? res.rules[0].allow : res.rules.allow).toBe('/');
  });

  it('3. disallow = "/api/"', () => {
    const res = robots();
    expect(Array.isArray(res.rules) ? res.rules[0].disallow : res.rules.disallow).toBe('/api/');
  });

  it('4. sitemap derives from NEXT_PUBLIC_SITE_URL', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com';
    const res = robots();
    expect(res.sitemap).toBe('https://example.com/sitemap.xml');
  });

  it('5. localhost fallback works when NEXT_PUBLIC_SITE_URL is undefined', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const res = robots();
    expect(res.sitemap).toBe('http://localhost:3000/sitemap.xml');
  });
});
