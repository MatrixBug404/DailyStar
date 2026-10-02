import React from 'react';

/**
 * /cms/articles/[id] placeholder (D6).
 * Renders the article ID dynamically.
 */
export default async function CmsArticleEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  return (
    <main>
      <h1 className="text-2xl font-bold">Edit Article</h1>
      <p>Editor placeholder for article ID: {resolvedParams.id} (D6).</p>
    </main>
  );
}
