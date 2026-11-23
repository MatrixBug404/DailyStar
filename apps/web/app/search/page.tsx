import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fetchPublicApi } from '../../lib/api';
import { fetchPublicCategories } from '../../lib/public-categories';
import {
  PublicSearchResponse,
  PublicSearchResult,
  SEARCH_PAGE_SIZE,
  parsePageParam,
  searchPageHref,
} from '../../lib/public-content';
import { PublicSiteShell } from '../../components/public/PublicSiteShell';
import { SearchForm } from '../../components/public/SearchForm';
import { StoryCard } from '../../components/public/StoryCard';
import { PublicEmptyState } from '../../components/public/PublicEmptyState';
import { PublicPagination } from '../../components/public/PublicPagination';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search',
  robots: {
    index: false,
    follow: true,
  },
};

interface PageProps {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
  }>;
}

/**
 * The search API returns flat rows that include the article summary fields.
 * Reject a nested `{ article }` payload loudly instead of rendering an empty
 * or malformed result list.
 */
function readSearchResults(response: PublicSearchResponse | null): PublicSearchResult[] {
  if (!response) {
    return [];
  }

  if (!Array.isArray(response.data)) {
    throw new Error('Unexpected search response: data must be an array');
  }

  return response.data.map((item) => {
    if (!item || typeof item.slug !== 'string' || typeof item.title !== 'string') {
      throw new Error('Unexpected search response: expected flat result objects');
    }
    return item;
  });
}

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawQuery = typeof params.q === 'string' ? params.q : Array.isArray(params.q) ? params.q[0] : '';
  const query = (rawQuery ?? '').trim().slice(0, 200);
  const page = parsePageParam(params.page);

  const [searchResponse, categories] = await Promise.all([
    query
      ? fetchPublicApi<PublicSearchResponse>(
          `/public/search?q=${encodeURIComponent(query)}&page=${page}&limit=${SEARCH_PAGE_SIZE}`,
        )
      : Promise.resolve(null),
    fetchPublicCategories(),
  ]);

  const results = readSearchResults(searchResponse);
  const total = Math.max(0, searchResponse?.total ?? 0);
  const limit = (searchResponse?.limit ?? SEARCH_PAGE_SIZE) || SEARCH_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // A page beyond the result set is not a meaningful search URL.
  if (query && total > 0 && results.length === 0 && page !== totalPages) {
    redirect(searchPageHref(query, totalPages));
  }

  return (
    <PublicSiteShell categories={categories}>
      <main
        id="public-main-content"
        className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14"
      >
        <div className="max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-crimson">
            Newsroom archive
          </p>
          <h1 className="mt-2 font-serif text-4xl font-bold tracking-tight sm:text-5xl">
            Search
          </h1>
          <SearchForm idPrefix="page" defaultValue={query} className="mt-6 max-w-xl" />
        </div>

        {!query ? (
          <div className="mt-10">
            <PublicEmptyState
              eyebrow="DailyStar"
              title="Search the newsroom"
              message="Find published stories by headline, topic or keyword."
            />
          </div>
        ) : (
          <>
            <div className="mt-12 flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-4">
              <h2 className="font-serif text-2xl font-bold tracking-tight sm:text-3xl">
                Results for <span className="text-crimson">“{query}”</span>
              </h2>
              <p className="text-xs text-muted">
                {total} {total === 1 ? 'story' : 'stories'}
              </p>
            </div>

            {results.length === 0 ? (
              <div className="mt-8">
                <PublicEmptyState
                  title="No stories found"
                  message={`Nothing matches “${query}”. Try a different keyword or a broader phrase.`}
                />
              </div>
            ) : (
              <>
                <div className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                  {results.map((article) => (
                    <StoryCard
                      key={article.id}
                      article={article}
                      headline={article.headline}
                    />
                  ))}
                </div>

                <PublicPagination
                  page={page}
                  total={total}
                  limit={limit}
                  hrefFor={(targetPage) => searchPageHref(query, targetPage)}
                />
              </>
            )}
          </>
        )}
      </main>
    </PublicSiteShell>
  );
}
