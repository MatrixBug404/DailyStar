import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchPublicApi } from '../../lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search | DailyStar',
  robots: {
    index: false,
    follow: true,
  },
};

interface PageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : Array.isArray(params.q) ? params.q[0] : '';

  let articles: any[] = [];

  if (q && q.trim().length > 0) {
    const result = await fetchPublicApi(`/public/search?q=${encodeURIComponent(q.trim())}`);
    articles = result?.data || [];
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Search</h1>

      <form method="GET" action="/search" className="mb-10 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search news..."
          className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          required
        />
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
        >
          Search
        </button>
      </form>

      {q && (
        <div className="mb-6">
          <p className="text-gray-600">
            Showing results for <span className="font-semibold">&quot;{q}&quot;</span>
          </p>
        </div>
      )}

      <div className="flex flex-col space-y-8">
        {q && articles.length === 0 ? (
          <p className="text-gray-500">No results found.</p>
        ) : (
          articles.map((item: any) => {
            const article = item.article;
            return (
              <article key={article.id} className="border-b pb-6">
                <h2 className="text-2xl font-semibold hover:text-blue-600 mb-2">
                  <Link href={`/article/${article.slug}`}>
                    {/* Render sanitized highlighted headline */}
                    <span dangerouslySetInnerHTML={{ __html: item.headline }} />
                  </Link>
                </h2>
                {article.excerpt && (
                  <p className="text-gray-700">{article.excerpt}</p>
                )}
                <div className="mt-2 text-sm text-gray-500">
                  {article.primaryAuthor?.displayName} •{' '}
                  {new Date(article.publishedRevisionCreatedAt).toLocaleDateString()}
                </div>
              </article>
            );
          })
        )}
      </div>
    </main>
  );
}
