'use client';

import { PublicErrorState } from '../../components/public/PublicErrorState';

export default function SearchError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PublicErrorState
      title="Search is temporarily unavailable"
      description="The newsroom is unable to complete this search. Try again, or return to the latest news."
      reset={reset}
    />
  );
}
