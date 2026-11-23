import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PublicSiteShell } from '../PublicSiteShell';
import { PublicCategory } from '../../../lib/public-content';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/'),
}));

const categories: PublicCategory[] = [
  {
    id: 'c1',
    name: 'Politics',
    slug: 'politics',
    parentId: null,
    publishedArticleCount: 4,
    children: [],
  },
];

describe('PublicSiteShell', () => {
  it('wraps public content in the newsroom masthead and footer', () => {
    render(
      <PublicSiteShell categories={categories}>
        <main id="public-main-content">
          <h1>Section content</h1>
        </main>
      </PublicSiteShell>,
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Section content' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'DailyStar home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#public-main-content',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'public-main-content');
    expect(screen.getByText(/© \d{4} DailyStar/)).toBeInTheDocument();
  });

  it('renders a single main landmark and no CMS chrome', () => {
    render(
      <PublicSiteShell categories={categories}>
        <main>
          <h1>Article</h1>
        </main>
      </PublicSiteShell>,
    );

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: /cms/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
  });
});
