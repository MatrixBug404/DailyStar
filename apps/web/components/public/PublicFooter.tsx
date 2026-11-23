import Link from 'next/link';
import { PublicCategory, categoryHref } from '../../lib/public-content';

interface PublicFooterProps {
  categories: PublicCategory[];
  year?: number;
}

/**
 * Public newsroom footer. Only real, existing routes are linked — no invented
 * social accounts, addresses or legal claims.
 */
export function PublicFooter({ categories, year = new Date().getFullYear() }: PublicFooterProps) {
  return (
    <footer className="mt-16 border-t-4 border-ink bg-ink text-paper">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="font-serif text-3xl font-bold tracking-[-0.02em]">
              Daily<span className="text-crimson-light">Star</span>
            </p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-paper/70">
              Read the latest published stories, browse sections and search the newsroom.
            </p>
          </div>

          <nav aria-label="Footer sections">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-paper/60">
              Sections
            </h2>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link href="/" className="editorial-focus inline-flex min-h-11 items-center transition-colors hover:text-paper/70">
                  Home
                </Link>
              </li>
              {categories.map((category) => (
                <li key={category.id}>
                  <Link
                    href={categoryHref(category.slug)}
                    className="editorial-focus inline-flex min-h-11 items-center transition-colors hover:text-paper/70"
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Footer links">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-paper/60">
              DailyStar
            </h2>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link href="/search" className="editorial-focus inline-flex min-h-11 items-center transition-colors hover:text-paper/70">
                  Search
                </Link>
              </li>
              <li>
                <Link
                  href="/cms/login"
                  className="editorial-focus inline-flex min-h-11 items-center transition-colors hover:text-paper/70"
                >
                  CMS login
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <p className="mt-10 border-t border-paper/20 pt-6 text-xs text-paper/60">
          © {year} DailyStar
        </p>
      </div>
    </footer>
  );
}
