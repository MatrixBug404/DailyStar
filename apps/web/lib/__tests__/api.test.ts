import { fetchPublicApi, API_BASE } from '../api';
import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('fetchPublicApi', () => {
  const originalFetch = global.fetch;
  const originalNextPhase = process.env.NEXT_PHASE;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXT_PHASE;
  });

  afterEach(() => {
    if (originalNextPhase === undefined) {
      delete process.env.NEXT_PHASE;
    } else {
      process.env.NEXT_PHASE = originalNextPhase;
    }
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns parsed JSON data on successful HTTP 200 response', async () => {
    const mockData = { data: [{ id: '1', title: 'Breaking News' }] };
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(mockData),
    } as any);

    const result = await fetchPublicApi('/public/articles');

    expect(global.fetch).toHaveBeenCalledWith(`${API_BASE}/public/articles`, undefined);
    expect(result).toEqual(mockData);
  });

  it('returns null on HTTP 404 Not Found response', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as any);

    const result = await fetchPublicApi('/public/articles/non-existent');

    expect(result).toBeNull();
  });

  it('returns null on network failure during build-time prerendering (NEXT_PHASE=phase-production-build)', async () => {
    process.env.NEXT_PHASE = 'phase-production-build';
    global.fetch = jest
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:3001'));

    const result = await fetchPublicApi('/public/articles');

    expect(result).toBeNull();
  });

  it('rethrows network failure at runtime instead of returning empty data', async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:3001'));

    await expect(fetchPublicApi('/public/articles')).rejects.toThrow(
      'connect ECONNREFUSED 127.0.0.1:3001',
    );
  });

  it('throws an error on HTTP 500 server error to prevent silently hiding production outages', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as any);

    await expect(fetchPublicApi('/public/articles')).rejects.toThrow(
      'Failed to fetch http://localhost:3001/api/v1/public/articles: 500 Internal Server Error',
    );
  });

  it('throws an error on HTTP 502/503 bad gateway to surface upstream API downtime', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    } as any);

    await expect(fetchPublicApi('/public/articles')).rejects.toThrow(
      'Failed to fetch http://localhost:3001/api/v1/public/articles: 502 Bad Gateway',
    );
  });
});
