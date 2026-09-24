import { notFound } from 'next/navigation';
import Link from 'next/link';
import { fetchPublicApi } from '../../../lib/api';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function CategoryPage({ params }: PageProps) {
  const { slug } = await params;

  // The backend API handles the 404 if the category has 0 published articles
  const result = await fetchPublicApi(`/public/categories/${slug}/articles`);

  if (!result || !result.data) {
    notFound();
  }

  const articles = result.data;

  // Get category name from the first article, or fallback to capitalized slug
  const categoryName = articles.length > 0 && articles[0].category?.name
    ? articles[0].category.name
    : slug;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-8 text-4xl font-bold tracking-tight capitalize">
        Category: {categoryName}
      </h1>

      <div className="flex flex-col space-y-6">
        {articles.length === 0 ? (
          <p className="text-gray-500">No articles found in this category.</p>
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
