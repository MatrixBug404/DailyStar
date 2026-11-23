import { PublicArticleSummary } from '../../lib/public-content';

interface StoryImageProps {
  article: PublicArticleSummary;
  /** Tailwind aspect utility, e.g. `aspect-[16/9]`. */
  aspectClassName?: string;
  priority?: boolean;
  className?: string;
}

/**
 * Cover artwork through the existing `/og-image/[slug]` proxy. Only used when
 * the API reports a ready cover; otherwise a designed neutral placeholder is
 * shown. No storage URLs are exposed and no imagery is fabricated.
 *
 * The image is decorative: the adjacent headline is the single link to the
 * story, so covers do not add a duplicate tab stop or duplicate accessible
 * name. Intrinsic dimensions come from the public DTO and the wrapper keeps a
 * stable aspect ratio while the image loads.
 */
export function StoryImage({
  article,
  aspectClassName = 'aspect-[3/2]',
  priority = false,
  className = '',
}: StoryImageProps) {
  const showCover = article.hasCoverImage && Boolean(article.slug);

  return (
    <div
      className={`group relative overflow-hidden bg-paper-dark ${aspectClassName} ${className}`}
    >
      {showCover ? (
        <img
          src={`/og-image/${article.slug}`}
          alt=""
          width={article.coverWidth ?? undefined}
          height={article.coverHeight ?? undefined}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-full w-full flex-col items-center justify-center gap-2 border border-rule bg-paper-dark"
        >
          <span className="h-px w-10 bg-crimson" />
          <span className="font-serif text-lg font-bold tracking-[-0.02em] text-charcoal/70">
            DailyStar
          </span>
          {article.category && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              {article.category.name}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
