/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, dynamic } from '../og-image/[slug]/route';
import crypto from 'crypto';

// Save the original fetch
const originalFetch = global.fetch;

describe('OG Image / Cover Proxy Route', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    process.env.PUBLIC_COVER_PROXY_TRUST_SECRET = 'test_secret_32_bytes_or_longer_xxxxx';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.PUBLIC_COVER_PROXY_TRUST_SECRET;
  });

  function createRequest(headers: Record<string, string> = {}) {
    return new NextRequest('http://localhost:3000/og-image/test-slug', {
      headers: new Headers(headers),
    });
  }

  function getExpectedSignature(ip: string) {
    return crypto.createHmac('sha256', process.env.PUBLIC_COVER_PROXY_TRUST_SECRET!)
      .update(ip)
      .digest('hex');
  }

  // NX-03
  it('NX-03: should export dynamic = "force-dynamic" and no revalidate', () => {
    expect(dynamic).toBe('force-dynamic');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const route = require('../og-image/[slug]/route');
    expect(route.revalidate).toBeUndefined();
  });

  // NX-01
  it('NX-01: should return 302 to signedUrl when article and cover exist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ hasCoverImage: true }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ signedUrl: 'https://minio/signed-url' }),
    });

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ slug: 'test-slug' }) });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://minio/signed-url');

    // Check no-store cache
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][1].cache).toBe('no-store');
    expect(mockFetch.mock.calls[1][1].cache).toBe('no-store');
  });

  // NX-02
  it('NX-02: should return 404 and not fetch cover if hasCoverImage is false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ hasCoverImage: false }),
    });

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ slug: 'test-slug' }) });

    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only article fetched
  });

  // Additional 1: HMAC correctness
  it('1. should compute correct lowercase HMAC for the IP', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hasCoverImage: true }) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ signedUrl: 'http://url' }) });

    const req = createRequest({ 'x-real-ip': ' 203.0.113.1 ' });
    await GET(req, { params: Promise.resolve({ slug: 'test-slug' }) });

    const expectedSig = getExpectedSignature('203.0.113.1');
    const headersPassed = mockFetch.mock.calls[0][1].headers;

    expect(headersPassed['X-DailyStar-Client-IP']).toBe('203.0.113.1');
    expect(headersPassed['X-DailyStar-Client-IP-Signature']).toBe(expectedSig);
  });

  // Additional 2: Forwarded precedence
  it('2. should prioritize Forwarded over X-Real-IP and X-Forwarded-For', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hasCoverImage: false }) });

    const req = createRequest({
      'forwarded': 'for="203.0.113.1"',
      'x-real-ip': '1.1.1.1',
      'x-forwarded-for': '2.2.2.2',
    });

    await GET(req, { params: Promise.resolve({ slug: 'test-slug' }) });
    expect(mockFetch.mock.calls[0][1].headers['X-DailyStar-Client-IP']).toBe('203.0.113.1');
  });

  // Additional 3: X-Real-IP precedence
  it('3. should prioritize X-Real-IP over X-Forwarded-For if Forwarded is absent', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hasCoverImage: false }) });

    const req = createRequest({
      'x-real-ip': '1.1.1.1',
      'x-forwarded-for': '2.2.2.2',
    });

    await GET(req, { params: Promise.resolve({ slug: 'test-slug' }) });
    expect(mockFetch.mock.calls[0][1].headers['X-DailyStar-Client-IP']).toBe('1.1.1.1');
  });

  // Additional 4: X-Forwarded-For fallback
  it('4. should use the leftmost X-Forwarded-For if it is the only header', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hasCoverImage: false }) });

    const req = createRequest({
      'x-forwarded-for': ' 2.2.2.2 , 3.3.3.3',
    });

    await GET(req, { params: Promise.resolve({ slug: 'test-slug' }) });
    expect(mockFetch.mock.calls[0][1].headers['X-DailyStar-Client-IP']).toBe('2.2.2.2');
  });

  // Additional 5: Local fallback
  it('5. should default to 127.0.0.1 if no IP headers are present', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hasCoverImage: false }) });

    const req = createRequest();

    await GET(req, { params: Promise.resolve({ slug: 'test-slug' }) });
    expect(mockFetch.mock.calls[0][1].headers['X-DailyStar-Client-IP']).toBe('127.0.0.1');
  });

  // Additional 9: Cover failure
  it('9. should return 404 if cover endpoint returns non-200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hasCoverImage: true }) });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ slug: 'test-slug' }) });

    expect(res.status).toBe(404);
  });

  // Additional 10: Article failure
  it('10. should return 404 if article endpoint returns 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ slug: 'test-slug' }) });

    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // Additional 11: Network failure
  it('11. should propagate network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const req = createRequest();
    await expect(GET(req, { params: Promise.resolve({ slug: 'test-slug' }) })).rejects.toThrow('Network error');
  });

  // Additional 12: IPv6 parsing
  it('12. should handle IPv6 Forwarded parsing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hasCoverImage: false }) });

    const req = createRequest({
      'forwarded': 'for="[2001:db8::1]:1234"',
    });

    await GET(req, { params: Promise.resolve({ slug: 'test-slug' }) });
    expect(mockFetch.mock.calls[0][1].headers['X-DailyStar-Client-IP']).toBe('2001:db8::1');
  });
});
