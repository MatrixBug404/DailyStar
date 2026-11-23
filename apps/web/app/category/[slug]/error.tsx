'use client';

import { PublicErrorState } from '../../../components/public/PublicErrorState';

export default function CategoryError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PublicErrorState
      title="This section could not be loaded"
      description="The newsroom is temporarily unable to fetch this section. Try again, or return to the latest news."
      reset={reset}
    />
  );
}
