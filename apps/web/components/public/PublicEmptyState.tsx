import React from 'react';

interface PublicEmptyStateProps {
  eyebrow?: string;
  title: string;
  message: string;
  children?: React.ReactNode;
}

/** Shared bordered empty state for public archives and search. */
export function PublicEmptyState({ eyebrow, title, message, children }: PublicEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center border-y border-rule py-16 text-center">
      <span aria-hidden="true" className="h-px w-12 bg-crimson" />
      {eyebrow && (
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-2 font-serif text-3xl font-bold tracking-tight">{title}</h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">{message}</p>
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}
