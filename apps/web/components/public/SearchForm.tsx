'use client';

import React from 'react';

interface SearchFormProps {
  /** Prefix for the input id so multiple forms can coexist on one page. */
  idPrefix?: string;
  className?: string;
  compact?: boolean;
  defaultValue?: string;
}

/**
 * Search entry point. Submits a plain GET to the existing /search route, so it
 * works without client-side JavaScript; the pattern/required attributes also
 * guard against empty or whitespace-only queries when JS is unavailable.
 */
export function SearchForm({
  idPrefix = 'search',
  className = '',
  compact = false,
  defaultValue = '',
}: SearchFormProps) {
  const inputId = `${idPrefix}-query`;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const formData = new FormData(event.currentTarget);
    const query = String(formData.get('q') ?? '').trim();
    if (!query) {
      event.preventDefault();
    }
  };

  return (
    <form
      role="search"
      action="/search"
      method="get"
      onSubmit={handleSubmit}
      className={`flex items-center ${compact ? '' : 'flex-col gap-2 sm:flex-row'} ${className}`}
    >
      <label htmlFor={inputId} className="sr-only">
        Search DailyStar
      </label>
      <input
        id={inputId}
        type="search"
        name="q"
        required
        pattern={String.raw`.*\S.*`}
        title="Enter a search term"
        placeholder="Search stories"
        defaultValue={defaultValue}
        autoComplete="off"
        className={`min-h-11 min-w-0 rounded-none border border-rule bg-white/70 px-3 py-2 text-sm text-ink placeholder:text-muted/80 focus:border-crimson focus:outline-none focus:ring-1 focus:ring-crimson ${
          compact ? 'w-52' : 'w-full'
        }`}
      />
      <button
        type="submit"
        className={`editorial-focus min-h-11 shrink-0 border border-ink bg-ink px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-paper transition-colors hover:bg-crimson ${
          compact ? 'ml-2' : ''
        }`}
      >
        Search
      </button>
    </form>
  );
}
