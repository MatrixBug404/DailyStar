import Link from 'next/link';
import { PublicArticleSummary, articleHref } from '../../lib/public-content';
import { StoryImage } from './StoryImage';
import { CategoryKicker, StoryByline } from './StoryMeta';

interface StoryCardProps {
  article: PublicArticleSummary;
  /**
   * Backend-sanitized highlighted search headline. Search results are flat DTOs
   * that extend the summary shape, so the same card serves both lists.
   */
  headline?: string | null;
  headingLevel?: 'h2' | 'h3';
  priority?: boolean;
}

/** Editorial card: fixed image ratio, kicker, headline, excerpt, byline. */
export function StoryCard({
  article,
  headline = null,
  headingLevel = 'h3',
  priority = false,
}: StoryCardProps) {
  const href = articleHref(article.slug);
  const Heading = headingLevel;

  return (
    <article className="group flex flex-col border-t border-rule pt-5">
      <StoryImage article={article} aspectClassName="aspect-[3/2]" priority={priority} />
      <div className="mt-4 flex flex-1 flex-col">
        <CategoryKicker category={article.category} />
        <Heading className="mt-2 font-serif text-xl font-bold leading-snug tracking-tight sm:text-2xl">
          <Link href={href} className="editorial-focus transition-colors hover:text-crimson">
            {headline ? (
              // The search API sanitizes this to a plain string containing only
              // balanced <b> highlight tags before it leaves the server.
              <span dangerouslySetInnerHTML={{ __html: headline }} />
            ) : (
              article.title
            )}
          </Link>
        </Heading>
        {article.excerpt && (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-charcoal/80">
            {article.excerpt}
          </p>
        )}
        <StoryByline article={article} className="mt-3" />
      </div>
    </article>
  );
}
