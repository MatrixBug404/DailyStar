'use client';

import { PublicErrorState } from '../../../components/public/PublicErrorState';

export default function ArticleError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PublicErrorState
      title="This story could not be loaded"
      description="The newsroom is temporarily unable to fetch this article. Try again, or return to the latest news."
      reset={reset}
    />
  );
}
