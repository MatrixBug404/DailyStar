import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchPublicApi } from '../lib/api';

export const metadata: Metadata = {
  title: 'DailyStar — Latest News',
  description: 'Your daily news source',
};

export const revalidate = 60;

export default async function HomePage() {
  const result = await fetchPublicApi('/public/articles?page=1&limit=20');
  const articles = result?.data || [];

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-8 text-4xl font-bold tracking-tight">Latest News</h1>

      <div className="flex flex-col space-y-6">
        {articles.length === 0 ? (
          <p className="text-gray-500">No articles found.</p>
        ) : (
          articles.map((article: any) => (
            <article key={article.id} className="border-b pb-6">
              <h2 className="text-2xl font-semibold hover:text-blue-600">
                <Link href={`/article/${article.slug}`}>{article.title}</Link>
              </h2>
              {article.excerpt && (
                <p className="mt-2 text-gray-700">{article.excerpt}</p>
              )}
              <div className="mt-2 text-sm text-gray-500">
                {article.primaryAuthor?.displayName} •{' '}
                {new Date(article.publishedRevisionCreatedAt).toLocaleDateString()}
              </div>
            </article>
          ))
        )}
      </div>
    </main>
  );
}
