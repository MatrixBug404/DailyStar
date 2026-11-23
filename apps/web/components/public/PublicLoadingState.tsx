import { PublicSiteShell } from './PublicSiteShell';

interface PublicLoadingStateProps {
  label: string;
}

/** Public route loading frame; keeps the masthead and footer stable. */
export function PublicLoadingState({ label }: PublicLoadingStateProps) {
  return (
    <PublicSiteShell categories={[]}>
      <main
        id="public-main-content"
        className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
      >
        <div role="status" aria-live="polite">
          <span className="sr-only">{label}</span>
          <div aria-hidden="true" className="animate-pulse">
            <div className="h-3 w-24 bg-rule" />
            <div className="mt-5 h-10 w-3/4 max-w-2xl bg-rule" />
            <div className="mt-4 h-4 w-full max-w-xl bg-rule/70" />
            <div className="mt-2 h-4 w-2/3 max-w-lg bg-rule/70" />
            <div className="mt-10 aspect-[16/9] w-full max-w-4xl bg-paper-dark" />
            <div className="mt-8 space-y-3">
              <div className="h-4 w-full max-w-3xl bg-rule/70" />
              <div className="h-4 w-full max-w-3xl bg-rule/70" />
              <div className="h-4 w-5/6 max-w-2xl bg-rule/70" />
            </div>
          </div>
        </div>
      </main>
    </PublicSiteShell>
  );
}
