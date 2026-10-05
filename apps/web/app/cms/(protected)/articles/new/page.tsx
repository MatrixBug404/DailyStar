import React from 'react';
import { ArticleEditor } from '../../../components/ArticleEditor';

/**
 * /cms/articles/new
 */
export default function CmsNewArticlePage() {
  return (
    <main>
      <ArticleEditor articleId="new" />
    </main>
  );
}
