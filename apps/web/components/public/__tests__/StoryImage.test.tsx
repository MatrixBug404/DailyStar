import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StoryImage } from '../StoryImage';
import { PublicArticleSummary } from '../../../lib/public-content';

const article: PublicArticleSummary = {
  id: 'a1',
  slug: 'budget-session',
  title: 'Budget session opens',
  excerpt: null,
  publishedAt: '2026-11-13T04:30:00.000Z',
  publishedRevisionCreatedAt: '2026-11-13T04:00:00.000Z',
  hasCoverImage: true,
  coverWidth: 1200,
  coverHeight: 675,
  coverMimeType: 'image/jpeg',
  category: { id: 'c1', name: 'Politics', slug: 'politics' },
  author: { displayName: 'Asha Menon', bio: null, avatarUrl: null },
  tags: [],
};

describe('StoryImage', () => {
  it('renders a decorative cover with intrinsic dimensions and no duplicate link', () => {
    const { container } = render(<StoryImage article={article} priority />);

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('src', '/og-image/budget-session');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('width', '1200');
    expect(image).toHaveAttribute('height', '675');
    expect(image).toHaveAttribute('loading', 'eager');
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders a designed placeholder without an image or accessible duplicate', () => {
    const { container } = render(
      <StoryImage
        article={{
          ...article,
          hasCoverImage: false,
          coverWidth: null,
          coverHeight: null,
          coverMimeType: null,
        }}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.textContent).toContain('DailyStar');
  });
});
