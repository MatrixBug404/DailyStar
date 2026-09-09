import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'DailyStar — Your Trusted News Source',
  description:
    'DailyStar is a modern digital news portal with an AI-assisted editorial pipeline. ' +
    'Accurate reporting, powered by technology.',
};

/**
 * DailyStar landing page (Phase 0 — minimal scaffold).
 *
 * This page will be replaced in Phase 5 with the full public news homepage
 * (top stories, category listings, search, etc.).
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-950 via-blue-900 to-slate-900">
      {/* Header */}
      <header className="mb-12 text-center">
        <div className="mb-4 inline-flex items-center rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-1.5 text-sm text-blue-300">
          Phase 0 — Project Scaffolding
        </div>

        <h1 className="mt-4 text-6xl font-bold tracking-tight text-white md:text-7xl">
          Daily<span className="text-blue-400">Star</span>
        </h1>

        <p className="mt-4 max-w-lg text-lg text-blue-200/80">
          Modern digital news portal — accurate reporting, editorial integrity, AI-assisted
          newsroom.
        </p>
      </header>

      {/* Status grid */}
      <section
        aria-label="Infrastructure status"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {[
          { label: 'Next.js', status: 'Running', icon: '⚡' },
          { label: 'NestJS API', status: 'Running', icon: '🚀' },
          { label: 'PostgreSQL', status: 'Docker', icon: '🐘' },
          { label: 'Redis', status: 'Docker', icon: '⚙️' },
        ].map(({ label, status, icon }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-sm"
          >
            <span className="text-2xl" role="img" aria-label={label}>
              {icon}
            </span>
            <div>
              <p className="text-sm font-semibold text-white">{label}</p>
              <p className="text-xs text-green-400">{status}</p>
            </div>
          </div>
        ))}
      </section>

      {/* Footer note */}
      <footer className="mt-16 text-center text-sm text-blue-300/50">
        <p>DailyStar Phase 0 scaffold — see README for local development instructions.</p>
        <p className="mt-1">
          Backend API:{' '}
          <a
            href="http://localhost:3001/health"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline-offset-2 hover:underline"
          >
            http://localhost:3001/health
          </a>
        </p>
      </footer>
    </main>
  );
}
