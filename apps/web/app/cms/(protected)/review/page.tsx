import React from 'react';
import { ArticleList } from '../../components/ArticleList';
import { ArticleStatus } from '@dailystar/types';

/**
 * /cms/review
 */
export default function CmsReviewPage() {
  return (
    <main>
      <ArticleList
        title="Review Queue"
        fixedStatusFilter={[ArticleStatus.SUBMITTED_FOR_REVIEW, ArticleStatus.UNDER_REVIEW]}
      />
    </main>
  );
}
