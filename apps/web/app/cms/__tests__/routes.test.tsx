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
import { useSession } from '../session-provider';

jest.mock('../components/ArticleList', () => ({
  ArticleList: ({ title }: any) => <div>Mock ArticleList: {title}</div>
}));
jest.mock('../components/ArticleEditor', () => ({
  ArticleEditor: ({ articleId }: any) => <div>Mock ArticleEditor: {articleId}</div>
}));
jest.mock('../components/CategoryManager', () => ({
  CategoryManager: () => <div>Mock CategoryManager</div>
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

jest.mock('../../../lib/cms-api', () => ({
  useCmsApi: () => ({
    get: jest.fn().mockResolvedValue([]),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    del: jest.fn()
  })
}));

jest.mock('../session-provider', () => ({
  useSession: jest.fn(() => ({
    status: 'authenticated',
    login: jest.fn(),
    logout: jest.fn(),
    permissions: ['category.manage', 'article.read.any', 'article.approve', 'article.publish', 'article.archive'],
    user: { id: 'test-user' }
  })),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('D6 CMS Route Tree', () => {
  beforeEach(() => {
    (useSession as jest.Mock).mockReturnValue({
      status: 'authenticated',
      login: jest.fn(),
      logout: jest.fn(),
      permissions: ['category.manage', 'article.read.any'],
      user: { id: 'test-user' }
    });
  });
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
      (useSession as jest.Mock).mockReturnValue({
        status: 'unauthenticated',
        login: jest.fn(),
        logout: jest.fn(),
        permissions: [],
        user: null
      });
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
      expect(screen.getByText('Mock ArticleList: Articles')).toBeInTheDocument();
    });

    it('renders CmsNewArticlePage safely', () => {
      render(<CmsNewArticlePage />);
      expect(screen.getByText('Mock ArticleEditor: new')).toBeInTheDocument();
    });

    it('renders CmsArticleEditorPage safely with params', async () => {
      const { container } = render(
        await CmsArticleEditorPage({ params: Promise.resolve({ id: '123' }) })
      );
      expect(container).toHaveTextContent('Mock ArticleEditor: 123');
    });

    it('renders CmsReviewPage placeholder', () => {
      render(<CmsReviewPage />);
      expect(screen.getByText('Mock ArticleList: Review Queue')).toBeInTheDocument();
    });

    it('renders CmsCategoriesPage safely', () => {
      render(<CmsCategoriesPage />);
      expect(screen.getByText('Mock CategoryManager')).toBeInTheDocument();
    });
  });
});
