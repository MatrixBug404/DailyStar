import { cmsFetch, CmsApiError, useCmsApi } from '../cms-api';
import { renderHook } from '@testing-library/react';
import { useSession } from '../../app/cms/session-provider';

jest.mock('../../app/cms/session-provider', () => ({
  useSession: jest.fn(),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('cms-api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('A. AUTHENTICATED REQUEST', () => {
    it('1. GET with access token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValueOnce(JSON.stringify({ data: 'ok' })),
      });
      const session = { accessToken: 'test-token', refresh: jest.fn() };
      const res = await cmsFetch('/test', {}, session);
      expect(res).toEqual({ data: 'ok' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(init.credentials).toBe('include');
      expect(init.headers.get('Authorization')).toBe('Bearer test-token');
    });

    it('2. Custom headers preserved', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValueOnce('{}'),
      });
      const session = { accessToken: 'test-token', refresh: jest.fn() };
      await cmsFetch('/test', { headers: { 'X-Custom': 'val' } }, session);
      const init = mockFetch.mock.calls[0][1];
      expect(init.headers.get('Authorization')).toBe('Bearer test-token');
      expect(init.headers.get('X-Custom')).toBe('val');
    });
  });

  describe('B. SUCCESS RESPONSES', () => {
    it('3. 204 response -> null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });
      const res = await cmsFetch('/test');
      expect(res).toBeNull();
    });

    it('4. Empty successful body -> null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValueOnce(''),
      });
      const res = await cmsFetch('/test');
      expect(res).toBeNull();
    });
  });

  describe('C. STRUCTURED ERRORS', () => {
    it('5. Structured 409 ApiErrorResponse', async () => {
      const errorResp = {
        statusCode: 409,
        message: 'CONCURRENCY_CONFLICT',
        path: '/api/v1/test',
        timestamp: '2023-01-01',
      };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        text: jest.fn().mockResolvedValueOnce(JSON.stringify(errorResp)),
      });

      let err: any;
      try { await cmsFetch('/test'); } catch (e) { err = e; }

      expect(err).toBeInstanceOf(CmsApiError);
      expect(err.status).toBe(409);
      expect(err.code).toBe('CONCURRENCY_CONFLICT');
      expect(err.message).toBe('CONCURRENCY_CONFLICT');
      expect(err.response).toEqual(errorResp);
    });

    it('6. Validation error (message: string[])', async () => {
      const errorResp = {
        statusCode: 400,
        message: ['title is required', 'slug is invalid'],
      };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValueOnce(JSON.stringify(errorResp)),
      });

      let err: any;
      try { await cmsFetch('/test'); } catch (e) { err = e; }
      
      expect(err.message).toBe('title is required, slug is invalid');
    });

    it('7. Non-JSON 502', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: jest.fn().mockResolvedValueOnce('<html>nginx error</html>'),
      });

      let err: any;
      try { await cmsFetch('/test'); } catch (e) { err = e; }

      expect(err.status).toBe(502);
      expect(err.rawBody).toBe('<html>nginx error</html>');
      expect(err.message).toContain('Failed to fetch');
      expect(err.message).toContain('502');
    });
  });

  describe('D. 401 RETRY', () => {
    it('8. Initial 401 -> refresh succeeds -> retry succeeds', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({ ok: true, status: 200, text: jest.fn().mockResolvedValueOnce('{"ok":true}') });
      
      const session = {
        accessToken: 'old-token',
        refresh: jest.fn().mockResolvedValueOnce('new-token'),
      };

      const res = await cmsFetch('/test', {}, session);
      expect(res).toEqual({ ok: true });
      expect(session.refresh).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer old-token');
      expect(mockFetch.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer new-token');
    });

    it('9. Initial 401 -> refresh returns null', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: jest.fn().mockResolvedValueOnce('') });
      const session = {
        accessToken: 'old-token',
        refresh: jest.fn().mockResolvedValueOnce(null),
      };

      await expect(cmsFetch('/test', {}, session)).rejects.toThrow(CmsApiError);
      
      expect(session.refresh).toHaveBeenCalledTimes(1);
      // original request NOT retried
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('10. Initial 401 -> refresh succeeds -> retry returns 401', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({ ok: false, status: 401, text: jest.fn().mockResolvedValueOnce('') });
      const session = {
        accessToken: 'old-token',
        refresh: jest.fn().mockResolvedValueOnce('new-token'),
      };

      await expect(cmsFetch('/test', {}, session)).rejects.toThrow(CmsApiError);

      expect(session.refresh).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('E. SINGLE-FLIGHT', () => {
    it('11. Concurrent requests receive 401', async () => {
      let resolveRefresh: (val: string) => void;
      const refreshPromise = new Promise<string>((resolve) => {
        resolveRefresh = resolve;
      });

      const session = {
        accessToken: 'old-token',
        refresh: jest.fn().mockReturnValue(refreshPromise),
      };

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({ ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify({ id: 1 })) })
        .mockResolvedValueOnce({ ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify({ id: 2 })) });

      const p1 = cmsFetch('/t1', {}, session);
      const p2 = cmsFetch('/t2', {}, session);

      await new Promise((r) => setTimeout(r, 10)); // let first fetches resolve

      expect(session.refresh).toHaveBeenCalledTimes(1);

      resolveRefresh!('new-token');
      const [r1, r2] = await Promise.all([p1, p2]);
      
      expect(r1).toEqual({ id: 1 });
      expect(r2).toEqual({ id: 2 });
      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(mockFetch.mock.calls[2][1].headers.get('Authorization')).toBe('Bearer new-token');
      expect(mockFetch.mock.calls[3][1].headers.get('Authorization')).toBe('Bearer new-token');
      
      // Test that promise clears and later 401 can refresh again
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })
      session.refresh.mockResolvedValueOnce('newer-token');
      try { await cmsFetch('/t3', {}, session); } catch(e) {}
      expect(session.refresh).toHaveBeenCalledTimes(2);
    });
  });

  describe('F. URL NORMALIZATION', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });
    });

    const cases = [
      ['/articles', 'http://localhost:3001/api/v1/articles'],
      ['articles', 'http://localhost:3001/api/v1/articles'],
      ['/v1/articles', 'http://localhost:3001/api/v1/articles'],
      ['v1/articles', 'http://localhost:3001/api/v1/articles'],
      ['/api/v1/articles', 'http://localhost:3001/api/v1/articles'],
      ['api/v1/articles', 'http://localhost:3001/api/v1/articles'],
      ['//articles', 'http://localhost:3001/api/v1/articles'],
      ['/v1//articles', 'http://localhost:3001/api/v1/articles'],
    ];

    cases.forEach(([input, expected], i) => {
      it(`12-17. Normalizes ${input}`, async () => {
        await cmsFetch(input);
        expect(mockFetch.mock.calls[0][0]).toBe(expected);
      });
    });
  });

  describe('G. REQUEST HELPERS & H. SECURITY & I. useCmsApi', () => {
    it('18-30. useCmsApi helper tests', async () => {
      const mockSession = {
        accessToken: 'hook-token',
        refresh: jest.fn().mockResolvedValue('refresh-token'),
      };
      (useSession as jest.Mock).mockReturnValue(mockSession);
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      const { result } = renderHook(() => useCmsApi());

      // 28. reads live accessToken
      await result.current.get('/get');
      expect(mockFetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer hook-token');

      // 18. POST object body + auto Content-Type
      await result.current.post('/post', { hello: 'world' });
      expect(mockFetch.mock.calls[1][1].method).toBe('POST');
      expect(mockFetch.mock.calls[1][1].body).toBe('{"hello":"world"}');
      expect(mockFetch.mock.calls[1][1].headers.get('Content-Type')).toBe('application/json');

      // 19. POST pre-serialized string
      await result.current.post('/post-str', '{"raw":true}', { headers: { 'Content-Type': 'application/custom' } });
      expect(mockFetch.mock.calls[2][1].body).toBe('{"raw":true}');
      expect(mockFetch.mock.calls[2][1].headers.get('Content-Type')).toBe('application/custom');

      // 20. POST FormData
      const fd = new FormData();
      await result.current.post('/post-fd', fd);
      expect(mockFetch.mock.calls[3][1].body).toBe(fd);
      expect(mockFetch.mock.calls[3][1].headers.has('Content-Type')).toBe(false);

      // 21. PATCH object body
      await result.current.patch('/patch', { edit: 1 });
      expect(mockFetch.mock.calls[4][1].method).toBe('PATCH');
      expect(mockFetch.mock.calls[4][1].body).toBe('{"edit":1}');

      // 22. PATCH string/raw body
      await result.current.patch('/patch-str', 'raw');
      expect(mockFetch.mock.calls[5][1].body).toBe('raw');

      // 23 & 24. DELETE
      await result.current.del('/del');
      expect(mockFetch.mock.calls[6][1].method).toBe('DELETE');
      expect(mockFetch.mock.calls[6][1].body).toBeUndefined();

      // 27. No token leakage in thrown errors
      mockFetch.mockResolvedValueOnce({ ok: false, status: 400, text: jest.fn().mockResolvedValue('{}') });
      let err: any;
      try { await result.current.get('/error'); } catch (e) { err = e; }
      expect(err.message).not.toContain('hook-token');
    });
  });
});
