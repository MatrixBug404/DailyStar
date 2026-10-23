export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/** Next.js sets this phase in the process that performs `next build` prerendering. */
const NEXT_BUILD_PHASE = 'phase-production-build';

/**
 * Fetches public API data.
 *
 * Error contract:
 * - HTTP 404 -> returns `null` (content is absent).
 * - HTTP 4xx/5xx -> throws (production outages and invalid requests surface).
 * - Network failure during `next build` static prerendering -> returns `null`
 *   so a build without a reachable API still produces an empty site shell.
 * - Network failure at request/runtime -> rethrows the fetch error. A runtime
 *   API outage must never be converted into a successful empty response.
 */
export async function fetchPublicApi(path: string, init?: RequestInit) {
  const url = `${API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    if (process.env.NEXT_PHASE === NEXT_BUILD_PHASE) {
      // Documented build-time fallback: the API is expected to be offline
      // while statically prerendering pages during `next build`.
      console.warn(
        `[fetchPublicApi] API unreachable during build prerender: ${url}. Returning null.`,
      );
      return null;
    }

    // Runtime network failure: surface it instead of silently rendering empty data.
    throw error;
  }

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    // Server errors (5xx/4xx) are NOT network errors: throw to ensure production outages are surfaced
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  return res.json();
}
