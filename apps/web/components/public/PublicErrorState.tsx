'use client';

import Link from 'next/link';
import { PublicSiteShell } from './PublicSiteShell';

interface PublicErrorStateProps {
  title: string;
  description: string;
  reset?: () => void;
}

/** Route-level public error frame with retry and a safe way back home. */
export function PublicErrorState({ title, description, reset }: PublicErrorStateProps) {
  return (
    <PublicSiteShell categories={[]}>
      <main
        id="public-main-content"
        className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8"
      >
        <span aria-hidden="true" className="mx-auto block h-px w-12 bg-crimson" />
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
          DailyStar
        </p>
        <h1 className="mt-3 font-serif text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-muted">{description}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {reset && (
            <button
              type="button"
              onClick={reset}
              className="editorial-focus inline-flex min-h-11 items-center border border-ink bg-ink px-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-paper transition-colors hover:bg-crimson"
            >
              Try again
            </button>
          )}
          <Link
            href="/"
            className="editorial-focus inline-flex min-h-11 items-center border border-rule px-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink transition-colors hover:border-ink"
          >
            Back to latest news
          </Link>
        </div>
      </main>
    </PublicSiteShell>
  );
}
