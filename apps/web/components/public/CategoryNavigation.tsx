'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PublicCategory, categoryHref } from '../../lib/public-content';

interface CategoryNavigationProps {
  categories: PublicCategory[];
  className?: string;
}

/**
 * Desktop section navigation sourced from the public categories API.
 * Home is a real route and remains available when category data is missing.
 */
export function CategoryNavigation({ categories, className = '' }: CategoryNavigationProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="News sections" className={className}>
      <ul className="mx-auto flex max-w-7xl items-stretch gap-7 overflow-x-auto px-4 sm:px-6 lg:px-8">
        <li>
          <Link
            href="/"
            aria-current={pathname === '/' ? 'page' : undefined}
            className={`editorial-focus inline-flex min-h-11 items-center whitespace-nowrap border-b-2 text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors ${
              pathname === '/'
                ? 'border-crimson text-ink'
                : 'border-transparent text-charcoal hover:text-crimson'
            }`}
          >
            Home
          </Link>
        </li>
        {categories.map((category) => {
          const href = categoryHref(category.slug);
          const active = pathname === href;

          return (
            <li key={category.id}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`editorial-focus inline-flex min-h-11 items-center whitespace-nowrap border-b-2 text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  active
                    ? 'border-crimson text-ink'
                    : 'border-transparent text-charcoal hover:text-crimson'
                }`}
              >
                {category.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
