import Link from 'next/link';

interface PublicPaginationProps {
  page: number;
  total: number;
  limit: number;
  hrefFor: (page: number) => string;
  className?: string;
}

const LINK_CLASS =
  'editorial-focus inline-flex min-h-11 items-center border border-rule px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink transition-colors hover:border-ink hover:bg-ink hover:text-paper';

/** Previous/next pagination with the current page and total result count. */
export function PublicPagination({
  page,
  total,
  limit,
  hrefFor,
  className = '',
}: PublicPaginationProps) {
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));

  if (totalPages <= 1) {
    return null;
  }

  const currentPage = Math.min(Math.max(1, page), totalPages);

  return (
    <nav
      aria-label="Pagination"
      className={`mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-6 ${className}`}
    >
      {currentPage > 1 ? (
        <Link href={hrefFor(currentPage - 1)} rel="prev" className={LINK_CLASS}>
          <span aria-hidden="true" className="mr-2">
            ←
          </span>
          Previous
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex min-h-11 items-center border border-rule/60 px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted/50"
        >
          <span aria-hidden="true" className="mr-2">
            ←
          </span>
          Previous
        </span>
      )}

      <p className="text-xs text-muted">
        Page {currentPage} of {totalPages}
        <span aria-hidden="true" className="mx-2">
          ·
        </span>
        {total} {total === 1 ? 'story' : 'stories'}
      </p>

      {currentPage < totalPages ? (
        <Link href={hrefFor(currentPage + 1)} rel="next" className={LINK_CLASS}>
          Next
          <span aria-hidden="true" className="ml-2">
            →
          </span>
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex min-h-11 items-center border border-rule/60 px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted/50"
        >
          Next
          <span aria-hidden="true" className="ml-2">
            →
          </span>
        </span>
      )}
    </nav>
  );
}
