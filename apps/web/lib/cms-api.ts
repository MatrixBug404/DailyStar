import { ApiErrorResponse } from '@dailystar/types';
import { API_BASE } from './api';
import { useSession } from '../app/cms/session-provider';

export class CmsApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly response?: ApiErrorResponse;
  readonly rawBody?: string;

  constructor(
    status: number,
    message: string,
    code?: string,
    response?: ApiErrorResponse,
    rawBody?: string,
  ) {
    super(message);
    this.name = 'CmsApiError';
    this.status = status;
    this.code = code;
    this.response = response;
    this.rawBody = rawBody;

    // Restore prototype chain for instanceof
    Object.setPrototypeOf(this, CmsApiError.prototype);
  }
}

export interface CmsSessionRef {
  accessToken: string | null;
  refresh: () => Promise<string | null>;
}

// Single-flight refresh promise
let refreshPromise: Promise<string | null> | null = null;

function normalizeUrl(base: string, path: string): string {
  let cleanPath = path.replace(/^\/+/, '');
  if (cleanPath.startsWith('api/v1/')) {
    cleanPath = cleanPath.slice(7);
  } else if (cleanPath === 'api/v1') {
    cleanPath = '';
  } else if (cleanPath.startsWith('v1/')) {
    cleanPath = cleanPath.slice(3);
  } else if (cleanPath === 'v1') {
    cleanPath = '';
  }
  cleanPath = cleanPath.replace(/^\/+/, '').replace(/\/+/g, '/');
  const baseUrl = base.endsWith('/') ? base.slice(0, -1) : base;
  return cleanPath ? `${baseUrl}/${cleanPath}` : baseUrl;
}

export async function cmsFetch<T = any>(
  path: string,
  init?: RequestInit,
  session?: CmsSessionRef,
): Promise<T> {
  const url = normalizeUrl(API_BASE, path);
  let token = session?.accessToken;

  const makeRequest = async (currentToken: string | null | undefined) => {
    const headers = new Headers(init?.headers);
    if (currentToken) {
      headers.set('Authorization', `Bearer ${currentToken}`);
    }
    
    return fetch(url, {
      ...init,
      headers,
      credentials: 'include',
    });
  };

  let res = await makeRequest(token);

  if (res.status === 401 && session) {
    if (!refreshPromise) {
      refreshPromise = session.refresh().finally(() => {
        refreshPromise = null;
      });
    }
    const newToken = await refreshPromise;
    if (newToken) {
      res = await makeRequest(newToken);
    }
  }

  if (!res.ok) {
    let message = `Failed to fetch ${url}: ${res.status} ${res.statusText}`;
    let code: string | undefined;
    let responseObj: ApiErrorResponse | undefined;
    let rawBody: string | undefined;

    try {
      rawBody = await res.text();
      try {
        const parsed = JSON.parse(rawBody);
        responseObj = parsed as ApiErrorResponse;
        
        if (responseObj.message) {
          if (Array.isArray(responseObj.message)) {
            message = responseObj.message.join(', ');
          } else {
            message = responseObj.message;
            // The backend returns string codes inside the message field for some errors.
            // Map those to the error's code property.
            const specificCodes = [
              'VERSION_REQUIRED', 'VERSION_MISMATCH', 'CONCURRENCY_CONFLICT',
              'ARTICLE_COVER_IMMUTABLE', 'COVER_MUTATION_NOT_PERMITTED', 'FILE_TOO_LARGE'
            ];
            if (specificCodes.includes(message)) {
              code = message;
            }
          }
        }
      } catch (e) {
        // Body was not JSON
      }
    } catch (e) {
      // Could not read body text
    }

    throw new CmsApiError(res.status, message, code, responseObj, rawBody);
  }

  // 204 No Content does not have a JSON body to parse
  if (res.status === 204) {
    return null as any;
  }

  try {
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (e) {
    return null as any;
  }
}

export function useCmsApi() {
  const session = useSession();

  const sessionRef: CmsSessionRef = {
    accessToken: session.accessToken,
    refresh: session.refresh,
  };

  const fetchApi = <T = any>(path: string, init?: RequestInit): Promise<T> => {
    return cmsFetch<T>(path, init, sessionRef);
  };

  return {
    fetchApi,
    get: <T = any>(path: string, init?: RequestInit): Promise<T> =>
      fetchApi<T>(path, { ...init, method: 'GET' }),
    post: <T = any>(path: string, body?: any, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers);
      if (body !== undefined && !headers.has('Content-Type')) {
        if (!(body instanceof FormData) && typeof body !== 'string') {
          headers.set('Content-Type', 'application/json');
        }
      }
      return fetchApi<T>(path, {
        ...init,
        method: 'POST',
        headers,
        body: body !== undefined ? (body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      });
    },
    patch: <T = any>(path: string, body?: any, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers);
      if (body !== undefined && !headers.has('Content-Type')) {
        if (!(body instanceof FormData) && typeof body !== 'string') {
          headers.set('Content-Type', 'application/json');
        }
      }
      return fetchApi<T>(path, {
        ...init,
        method: 'PATCH',
        headers,
        body: body !== undefined ? (body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      });
    },
    del: <T = any>(path: string, init?: RequestInit): Promise<T> =>
      fetchApi<T>(path, { ...init, method: 'DELETE' }),
  };
}
