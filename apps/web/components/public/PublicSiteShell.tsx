import React from 'react';
import { PublicCategory, formatEditionDate } from '../../lib/public-content';
import { PublicFooter } from './PublicFooter';
import { PublicHeader } from './PublicHeader';

interface PublicSiteShellProps {
  categories: PublicCategory[];
  children: React.ReactNode;
}

/**
 * Shared public newsroom chrome: masthead, section navigation and footer.
 * Used only by public routes — CMS routes keep their own layouts.
 * Each page supplies its own semantic <main>.
 */
export function PublicSiteShell({ categories, children }: PublicSiteShellProps) {
  const edition = formatEditionDate();

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink [&>main]:flex-1">
      <a
        href="#public-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:border focus:border-ink focus:bg-paper focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
      >
        Skip to content
      </a>
      <PublicHeader categories={categories} edition={edition} />
      {children}
      <PublicFooter categories={categories} />
    </div>
  );
}
