import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchPublicApi } from '../../../lib/api';
import { fetchPublicCategories } from '../../../lib/public-categories';
import {
  CATEGORY_PAGE_SIZE,
  PublicArticlesResponse,
  categoryHref,
  categoryNameFromSlug,
  categoryPageHref,
  findCategoryBySlug,
  parsePageParam,
} from '../../../lib/public-content';
import { PublicSiteShell } from '../../../components/public/PublicSiteShell';
import { StoryCard } from '../../../components/public/StoryCard';
import { PublicEmptyState } from '../../../components/public/PublicEmptyState';
import { PublicPagination } from '../../../components/public/PublicPagination';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const categories = await fetchPublicCategories();
  const name = findCategoryBySlug(categories, slug)?.name ?? categoryNameFromSlug(slug);

  return {
    title: name,
    alternates: {
      canonical: categoryHref(slug),
    },
    openGraph: {
      type: 'website',
      title: name,
      url: categoryHref(slug),
    },
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const page = parsePageParam(query.page);

  const [result, categories] = await Promise.all([
    fetchPublicApi<PublicArticlesResponse>(
      `/public/categories/${encodeURIComponent(slug)}/articles?page=${page}&limit=${CATEGORY_PAGE_SIZE}`,
    ),
    fetchPublicCategories(),
  ]);

  if (!result || !Array.isArray(result.data)) {
    notFound();
  }

  const total = Math.max(0, result.total);
  const limit = result.limit > 0 ? result.limit : CATEGORY_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // The API can return an empty page beyond the last page; keep the URL valid.
  if (total > 0 && result.data.length === 0 && page !== totalPages) {
    redirect(categoryPageHref(slug, totalPages));
  }

  const category = findCategoryBySlug(categories, slug);
  const categoryName =
    category?.name ??
    result.data[0]?.category?.name ??
    categoryNameFromSlug(slug);

  return (
    <PublicSiteShell categories={categories}>
      <main
        id="public-main-content"
        className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14"
      >
        <header className="max-w-3xl border-b-2 border-ink pb-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-crimson">
            Section
          </p>
          <h1 className="mt-2 font-serif text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            {categoryName}
          </h1>
          <p className="mt-4 text-sm text-muted">
            {total} {total === 1 ? 'published story' : 'published stories'}
          </p>
        </header>

        {result.data.length === 0 ? (
          <div className="mt-10">
            <PublicEmptyState
              title="No stories in this section yet"
              message="This section has no published stories at the moment. Please check back shortly."
            >
              <Link
                href="/search"
                className="editorial-focus inline-flex min-h-11 items-center border border-ink px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink transition-colors hover:bg-ink hover:text-paper"
              >
                Search DailyStar
              </Link>
            </PublicEmptyState>
          </div>
        ) : (
          <>
            <h2 className="sr-only">Latest stories in {categoryName}</h2>
            <div className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {result.data.map((article) => (
                <StoryCard key={article.id} article={article} />
              ))}
            </div>

            <PublicPagination
              page={page}
              total={total}
              limit={limit}
              hrefFor={(targetPage) => categoryPageHref(slug, targetPage)}
            />
          </>
        )}
      </main>
    </PublicSiteShell>
  );
}
