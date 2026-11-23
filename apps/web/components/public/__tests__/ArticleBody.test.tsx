import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ArticleBody } from '../ArticleBody';

describe('ArticleBody', () => {
  it('renders the supported Markdown subset as semantic React elements', () => {
    render(
      <ArticleBody
        body={[
          '# Session opens',
          '',
          'A paragraph with **bold text**, *emphasis* and a [briefing](/search).',
          '',
          '- First point',
          '- Second point',
          '',
          '> A quoted line',
          '',
          '```',
          'const total = 1;',
          '```',
        ].join('\n')}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Session opens' })).toBeInTheDocument();
    expect(screen.getByText('bold text').tagName).toBe('STRONG');
    expect(screen.getByText('emphasis').tagName).toBe('EM');
    expect(screen.getByRole('link', { name: 'briefing' })).toHaveAttribute('href', '/search');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('A quoted line')).toBeInTheDocument();
    expect(screen.getByText('const total = 1;')).toBeInTheDocument();
  });

  it('renders raw HTML as text and refuses unsafe link schemes', () => {
    const { container } = render(
      <ArticleBody
        body={'<script>alert("x")</script> and [unsafe](javascript:alert(1))'}
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert("x")</script>');
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
