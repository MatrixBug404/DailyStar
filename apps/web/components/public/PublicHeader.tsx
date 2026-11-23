'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PublicCategory, categoryHref, flattenCategories } from '../../lib/public-content';
import { CategoryNavigation } from './CategoryNavigation';
import { SearchForm } from './SearchForm';

export interface EditionDate {
  /** `YYYY-MM-DD` in Asia/Kolkata, for `<time dateTime>`. */
  iso: string;
  label: string;
}

interface PublicHeaderProps {
  categories: PublicCategory[];
  edition: EditionDate;
}

const MENU_LINKS =
  'editorial-focus flex min-h-11 items-center border-b border-rule/70 transition-colors hover:text-crimson';

/**
 * Public newsroom masthead: edition date, search, CMS entry point and real
 * section navigation. Mobile navigation is a keyboard-operable disclosure
 * (Enter/Space toggles, Escape closes).
 */
export function PublicHeader({ categories, edition }: PublicHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const mobileCategories = flattenCategories(categories);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <header className="border-b border-rule bg-paper">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-6 border-b border-rule/70 py-2.5">
          <time
            dateTime={edition.iso}
            className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted"
          >
            {edition.label}
          </time>
          <div className="flex items-center gap-5">
            <SearchForm idPrefix="header" compact className="hidden md:flex" />
            <Link
              href="/cms/login"
              className="editorial-focus inline-flex min-h-11 items-center whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.14em] text-charcoal transition-colors hover:text-crimson"
            >
              CMS login
            </Link>
          </div>
        </div>

        <div className="relative flex items-center justify-center py-5 sm:py-7 lg:justify-start">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="public-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
            className="editorial-focus absolute left-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink lg:hidden"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              {menuOpen ? (
                <path d="M5 5l14 14M19 5L5 19" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>

          <Link href="/" aria-label="DailyStar home" className="editorial-focus">
            <span className="font-serif text-4xl font-bold tracking-[-0.02em] text-ink sm:text-5xl lg:text-6xl">
              Daily<span className="text-crimson">Star</span>
            </span>
          </Link>

          <Link
            href="/search"
            aria-label="Search DailyStar"
            className="editorial-focus absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink md:hidden"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="6" />
              <path d="M16 16l4 4" />
            </svg>
          </Link>
        </div>
      </div>

      <CategoryNavigation categories={categories} className="hidden border-t border-rule lg:block" />

      <div id="public-mobile-menu" hidden={!menuOpen} className="border-t border-rule lg:hidden">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:px-6">
          <SearchForm idPrefix="mobile" />
          <nav aria-label="News sections">
            <ul>
              <li>
                <Link
                  href="/"
                  aria-current={pathname === '/' ? 'page' : undefined}
                  className={`${MENU_LINKS} font-serif text-lg text-ink`}
                >
                  Home
                </Link>
              </li>
              {mobileCategories.map(({ category, depth }) => (
                <li key={category.id}>
                  <Link
                    href={categoryHref(category.slug)}
                    aria-current={
                      pathname === categoryHref(category.slug) ? 'page' : undefined
                    }
                    className={`${MENU_LINKS} font-serif ${
                      depth === 0 ? 'text-lg text-ink' : 'pl-4 text-base text-charcoal'
                    }`}
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Link
            href="/cms/login"
            className="editorial-focus inline-flex min-h-11 items-center text-[11px] font-semibold uppercase tracking-[0.14em] text-charcoal transition-colors hover:text-crimson"
          >
            CMS login
          </Link>
        </div>
      </div>
    </header>
  );
}
