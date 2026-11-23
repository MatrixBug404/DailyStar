import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PublicFooter } from '../PublicFooter';
import { PublicCategory } from '../../../lib/public-content';

const categories: PublicCategory[] = [
  {
    id: 'c1',
    name: 'Politics',
    slug: 'politics',
    parentId: null,
    publishedArticleCount: 4,
    children: [],
  },
  {
    id: 'c2',
    name: 'Sport',
    slug: 'sport',
    parentId: null,
    publishedArticleCount: 9,
    children: [],
  },
];

describe('PublicFooter', () => {
  it('renders branding and only real site routes', () => {
    render(<PublicFooter categories={categories} year={2026} />);

    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('© 2026 DailyStar')).toBeInTheDocument();

    // The crimson wordmark accent must stay legible on the dark footer.
    const wordmarkAccent = footer.querySelector('p.font-serif span');
    expect(wordmarkAccent).not.toBeNull();
    expect(wordmarkAccent).toHaveClass('text-crimson-light');

    expect(within(footer).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(within(footer).getByRole('link', { name: 'Politics' })).toHaveAttribute(
      'href',
      '/category/politics',
    );
    expect(within(footer).getByRole('link', { name: 'Sport' })).toHaveAttribute(
      'href',
      '/category/sport',
    );
    expect(within(footer).getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search');
    expect(within(footer).getByRole('link', { name: 'CMS login' })).toHaveAttribute(
      'href',
      '/cms/login',
    );

    for (const link of within(footer).getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toMatch(/^https?:/);
    }

    expect(within(footer).getByRole('navigation', { name: 'Footer sections' })).toBeInTheDocument();
    expect(within(footer).getByRole('navigation', { name: 'Footer links' })).toBeInTheDocument();
  });

  it('keeps the footer usable without category data', () => {
    render(<PublicFooter categories={[]} year={2026} />);

    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(within(footer).getByRole('link', { name: 'Search' })).toBeInTheDocument();
    expect(within(footer).queryByRole('link', { name: 'Politics' })).not.toBeInTheDocument();
  });
});
