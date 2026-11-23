import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchPublicApi } from '../lib/api';
import { fetchPublicCategories } from '../lib/public-categories';
import {
  PublicArticleSummary,
  PublicArticlesResponse,
  articleHref,
} from '../lib/public-content';
import { PublicSiteShell } from '../components/public/PublicSiteShell';
import { StoryCard } from '../components/public/StoryCard';
import { StoryImage } from '../components/public/StoryImage';
import { CategoryKicker, StoryByline } from '../components/public/StoryMeta';

export const metadata: Metadata = {
  title: 'Latest News',
  description:
    'The latest published stories and sections from the DailyStar newsroom, ' +
    'reported and edited for readers in India.',
};

export const revalidate = 60;

interface SectionHeadingProps {
  id: string;
  title: string;
}

function SectionHeading({ id, title }: SectionHeadingProps) {
  return (
    <div className="flex items-center gap-4">
      <h2 id={id} className="font-serif text-2xl font-bold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <span aria-hidden="true" className="h-px flex-1 bg-rule" />
    </div>
  );
}

function EmptyNewsroom() {
  return (
    <div className="flex flex-col items-center justify-center border-y border-rule py-20 text-center">
      <span aria-hidden="true" className="h-px w-12 bg-crimson" />
      <h2 className="mt-6 font-serif text-3xl font-bold tracking-tight">No published stories yet</h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
        The newsroom has not published any stories at the moment. Please check back shortly.
      </p>
      <Link
        href="/search"
        className="editorial-focus mt-6 border border-ink px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink transition-colors hover:bg-ink hover:text-paper"
      >
        Search DailyStar
      </Link>
    </div>
  );
}

export default async function HomePage() {
  // Content is requested before categories so the article feed remains the
  // primary response of this page.
  const [feed, sectionCategories] = await Promise.all([
    fetchPublicApi<PublicArticlesResponse>('/public/articles?page=1&limit=20'),
    fetchPublicCategories(),
  ]);

  const articles: PublicArticleSummary[] = Array.isArray(feed?.data) ? feed.data : [];

  const lead = articles[0];
  const supporting = articles.slice(1, 4);
  const latest = articles.slice(4);

  return (
    <PublicSiteShell categories={sectionCategories}>
      <main
        id="public-main-content"
        className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8"
      >
        <h1 className="sr-only">DailyStar latest news</h1>

        {!lead ? (
          <div className="py-10 lg:py-14">
            <EmptyNewsroom />
          </div>
        ) : (
          <>
            <section aria-labelledby="top-stories-heading" className="py-8 lg:py-12">
              <SectionHeading id="top-stories-heading" title="Top stories" />

              <div className="mt-6 grid gap-10 lg:grid-cols-12 lg:gap-8">
                <article className={`group ${supporting.length > 0 ? 'lg:col-span-8' : 'lg:col-span-12'}`}>
                  <StoryImage article={lead} aspectClassName="aspect-[16/9]" priority />
                  <div className="mt-5 max-w-3xl">
                    <CategoryKicker category={lead.category} />
                    <h2 className="mt-2 font-serif text-3xl font-bold leading-[1.05] tracking-tight sm:text-4xl lg:text-5xl">
                      <Link
                        href={articleHref(lead.slug)}
                        className="editorial-focus transition-colors hover:text-crimson"
                      >
                        {lead.title}
                      </Link>
                    </h2>
                    {lead.excerpt && (
                      <p className="mt-4 font-serif text-lg leading-relaxed text-charcoal/90 sm:text-xl">
                        {lead.excerpt}
                      </p>
                    )}
                    <StoryByline article={lead} className="mt-4" />
                  </div>
                </article>

                {supporting.length > 0 && (
                  <aside
                    aria-labelledby="more-headlines-heading"
                    className="lg:col-span-4 lg:border-l lg:border-rule lg:pl-8"
                  >
                    <h2 id="more-headlines-heading" className="font-serif text-xl font-bold tracking-tight">
                      More headlines
                    </h2>
                    <ol className="mt-2 divide-y divide-rule">
                      {supporting.map((article, index) => (
                        <li key={article.id} className="py-4">
                          <article className="group grid grid-cols-[auto_1fr] gap-3">
                            <span
                              aria-hidden="true"
                              className="font-serif text-2xl font-bold leading-none text-crimson/60"
                            >
                              {String(index + 2).padStart(2, '0')}
                            </span>
                            <div>
                              <CategoryKicker category={article.category} />
                              <h3 className="mt-1 font-serif text-lg font-semibold leading-snug">
                                <Link
                                  href={articleHref(article.slug)}
                                  className="editorial-focus transition-colors hover:text-crimson"
                                >
                                  {article.title}
                                </Link>
                              </h3>
                              <StoryByline article={article} className="mt-2" />
                            </div>
                          </article>
                        </li>
                      ))}
                    </ol>
                  </aside>
                )}
              </div>
            </section>

            {latest.length > 0 && (
              <section aria-labelledby="latest-heading" className="border-t-2 border-ink py-8 lg:py-12">
                <SectionHeading id="latest-heading" title="Latest news" />
                <div className="mt-6 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                  {latest.map((article) => (
                    <StoryCard key={article.id} article={article} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </PublicSiteShell>
  );
}
