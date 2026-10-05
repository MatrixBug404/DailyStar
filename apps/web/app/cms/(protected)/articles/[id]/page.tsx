import React from 'react';
import { ArticleEditor } from '../../../components/ArticleEditor';

/**
 * /cms/articles/[id]
 */
export default async function CmsArticleEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  return (
    <main>
      <ArticleEditor articleId={resolvedParams.id} />
    </main>
  );
}
