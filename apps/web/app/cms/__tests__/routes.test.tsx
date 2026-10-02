import React from 'react';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import CmsLayout from '../layout';
import CmsLoginPage from '../login/page';
import ProtectedLayout from '../(protected)/layout';
import CmsDashboardPage from '../(protected)/page';
import CmsArticlesPage from '../(protected)/articles/page';
import CmsNewArticlePage from '../(protected)/articles/new/page';
import CmsArticleEditorPage from '../(protected)/articles/[id]/page';
import CmsReviewPage from '../(protected)/review/page';
import CmsCategoriesPage from '../(protected)/categories/page';

describe('D6 CMS Route Tree', () => {
  it('does NOT have apps/web/app/cms/page.tsx to avoid route collision', () => {
    const pagePath = path.join(__dirname, '..', 'page.tsx');
    expect(fs.existsSync(pagePath)).toBe(false);
  });

  describe('Route Components Rendering', () => {
    it('renders CmsLayout without throwing', () => {
      render(<CmsLayout><div>Child</div></CmsLayout>);
      expect(screen.getByText('Child')).toBeInTheDocument();
    });

    it('renders CmsLoginPage placeholder', () => {
      render(<CmsLoginPage />);
      expect(screen.getByText('CMS Login')).toBeInTheDocument();
    });

    it('renders ProtectedLayout placeholder', () => {
      render(<ProtectedLayout><div>Protected Child</div></ProtectedLayout>);
      expect(screen.getByText('Protected Child')).toBeInTheDocument();
      expect(screen.getByText('DailyStar CMS (Protected)')).toBeInTheDocument();
    });

    it('renders CmsDashboardPage placeholder', () => {
      render(<CmsDashboardPage />);
      expect(screen.getByText('CMS Dashboard')).toBeInTheDocument();
    });

    it('renders CmsArticlesPage placeholder', () => {
      render(<CmsArticlesPage />);
      expect(screen.getByText('Articles')).toBeInTheDocument();
    });

    it('renders CmsNewArticlePage placeholder', () => {
      render(<CmsNewArticlePage />);
      expect(screen.getByText('New Article')).toBeInTheDocument();
    });

    it('renders CmsArticleEditorPage safely with params', async () => {
      const { container } = render(
        await CmsArticleEditorPage({ params: Promise.resolve({ id: '123' }) })
      );
      expect(container).toHaveTextContent('Edit Article');
      expect(container).toHaveTextContent('123');
    });

    it('renders CmsReviewPage placeholder', () => {
      render(<CmsReviewPage />);
      expect(screen.getByText('Review Queue')).toBeInTheDocument();
    });

    it('renders CmsCategoriesPage placeholder', () => {
      render(<CmsCategoriesPage />);
      expect(screen.getByText('Categories')).toBeInTheDocument();
    });
  });
});
