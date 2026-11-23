import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchPublicApi } from '../../../lib/api';
import { fetchPublicCategories } from '../../../lib/public-categories';
import {
  PublicArticleFull,
  articleHref,
  articlePublishedAt,
  authorDisplayName,
  normalizeTags,
} from '../../../lib/public-content';
import { PublicSiteShell } from '../../../components/public/PublicSiteShell';
import { StoryImage } from '../../../components/public/StoryImage';
import { CategoryKicker, StoryByline } from '../../../components/public/StoryMeta';
import { ArticleBody } from '../../../components/public/ArticleBody';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await fetchPublicApi<PublicArticleFull>(
    `/public/articles/${encodeURIComponent(slug)}`,
  );

  if (!article) {
    return {
      title: 'Article not found',
      robots: { index: false, follow: true },
    };
  }

  const description = article.excerpt?.trim() || undefined;
  const publishedTime = articlePublishedAt(article) ?? undefined;
  const authorName = authorDisplayName(article.author);
  const cover =
    article.hasCoverImage && article.slug
      ? {
          url: `/og-image/${article.slug}`,
          alt: article.title,
          ...(article.coverWidth && article.coverWidth > 0
            ? { width: article.coverWidth }
            : {}),
          ...(article.coverHeight && article.coverHeight > 0
            ? { height: article.coverHeight }
            : {}),
        }
      : null;

  return {
    title: article.title,
    description,
    alternates: {
      canonical: articleHref(article.slug),
    },
    openGraph: {
      type: 'article',
      title: article.title,
      description,
      url: articleHref(article.slug),
      ...(publishedTime ? { publishedTime } : {}),
      ...(authorName ? { authors: [authorName] } : {}),
      ...(cover ? { images: [cover] } : {}),
    },
  };
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;

  // Article first: a missing story ends in notFound() without starting an
  // optional navigation request that will never be used.
  const article = await fetchPublicApi<PublicArticleFull>(
    `/public/articles/${encodeURIComponent(slug)}`,
  );

  if (!article) {
    notFound();
  }

  const categories = await fetchPublicCategories();
  const tags = normalizeTags(article.tags);
  const authorBio = article.author?.bio?.trim() || null;

  return (
    <PublicSiteShell categories={categories}>
      <main
        id="public-main-content"
        className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-14"
      >
        <article className="mx-auto max-w-3xl">
          <header>
            <CategoryKicker category={article.category} />

            <h1 className="mt-3 font-serif text-4xl font-bold leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">
              {article.title}
            </h1>

            {article.excerpt && (
              <p className="mt-5 font-serif text-xl leading-relaxed text-charcoal/90 sm:text-2xl">
                {article.excerpt}
              </p>
            )}

            <StoryByline
              article={article}
              className="mt-6 border-y border-rule py-3 text-sm"
            />
          </header>

          {article.hasCoverImage && (
            <StoryImage
              article={article}
              aspectClassName="aspect-[16/9]"
              priority
              className="mt-8"
            />
          )}

          <ArticleBody body={article.body} className="mt-10" />

          {tags.length > 0 && (
            <section aria-labelledby="article-tags-heading" className="mt-12 border-t border-rule pt-6">
              <h2
                id="article-tags-heading"
                className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted"
              >
                Tags
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <li key={tag}>
                    <span className="inline-flex min-h-9 items-center border border-rule bg-paper-dark px-3 text-xs font-medium text-charcoal">
                      #{tag}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {authorBio && (
            <aside
              aria-label="About the author"
              className="mt-12 border-l-2 border-crimson pl-5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                About the author
              </p>
              <p className="mt-2 text-sm leading-relaxed text-charcoal">{authorBio}</p>
            </aside>
          )}
        </article>
      </main>
    </PublicSiteShell>
  );
}
