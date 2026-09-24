import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchPublicApi } from '../../../lib/api';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await fetchPublicApi(`/public/articles/${slug}`);

  if (!article) {
    return { title: 'Not Found' };
  }

  const metadata: Metadata = {
    title: article.title,
    description: article.excerpt,
  };

  if (article.hasCoverImage) {
    metadata.openGraph = {
      images: [`/og-image/${slug}`],
    };
  }

  return metadata;
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = await fetchPublicApi(`/public/articles/${slug}`);

  if (!article) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      {article.hasCoverImage && (
        <div className="mb-8 overflow-hidden rounded-xl">
          <img
            src={`/og-image/${slug}`}
            alt={article.title}
            className="w-full h-auto object-cover max-h-[500px]"
          />
        </div>
      )}

      <header className="mb-8 border-b pb-8">
        {article.category && (
          <div className="mb-4">
            <Link
              href={`/category/${article.category.slug}`}
              className="font-semibold text-blue-600 uppercase tracking-wider text-sm"
            >
              {article.category.name}
            </Link>
          </div>
        )}

        <h1 className="text-4xl font-bold tracking-tight mb-4">{article.title}</h1>

        <div className="flex flex-wrap items-center text-gray-500 gap-4">
          <span className="font-medium text-gray-900">
            {article.primaryAuthor?.displayName}
          </span>
          <span>•</span>
          <span>Updated: {new Date(article.publishedRevisionCreatedAt).toLocaleDateString()}</span>
        </div>
      </header>

      <article className="prose prose-lg max-w-none text-gray-800 whitespace-pre-wrap">
        {article.body}
      </article>

      {article.tags && article.tags.length > 0 && (
        <div className="mt-12 flex flex-wrap gap-2">
          {article.tags.map((t: any) => (
            <span
              key={t.tag.id}
              className="inline-block rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700"
            >
              #{t.tag.name}
            </span>
          ))}
        </div>
      )}
    </main>
  );
}
