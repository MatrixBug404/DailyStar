import Link from 'next/link';
import {
  PublicArticleSummary,
  articlePublishedAt,
  authorDisplayName,
  categoryHref,
  formatArticleDate,
} from '../../lib/public-content';

interface CategoryKickerProps {
  category: PublicArticleSummary['category'];
  className?: string;
}

/** Section kicker; omitted entirely when the article has no category. */
export function CategoryKicker({ category, className = '' }: CategoryKickerProps) {
  if (!category) {
    return null;
  }

  return (
    <Link
      href={categoryHref(category.slug)}
      className={`editorial-focus text-[11px] font-bold uppercase tracking-[0.18em] text-crimson transition-colors hover:text-crimson-dark ${className}`}
    >
      {category.name}
    </Link>
  );
}

interface StoryBylineProps {
  article: PublicArticleSummary;
  className?: string;
}

/** Author and publication date, rendered from the public `author` field. */
export function StoryByline({ article, className = '' }: StoryBylineProps) {
  const publishedAt = articlePublishedAt(article);
  const dateLabel = formatArticleDate(publishedAt);
  const author = authorDisplayName(article.author);

  if (!author && !dateLabel) {
    return null;
  }

  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted ${className}`}>
      {author && <span className="font-medium text-charcoal">{author}</span>}
      {author && dateLabel && <span aria-hidden="true">·</span>}
      {dateLabel &&
        (publishedAt ? (
          <time dateTime={publishedAt}>{dateLabel}</time>
        ) : (
          <span>{dateLabel}</span>
        ))}
    </p>
  );
}
