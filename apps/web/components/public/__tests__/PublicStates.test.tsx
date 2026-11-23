import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PublicLoadingState } from '../PublicLoadingState';
import { PublicErrorState } from '../PublicErrorState';
import { PublicNotFound } from '../PublicNotFound';

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

describe('public route states', () => {
  it('announces a loading state with the shared shell', () => {
    render(<PublicLoadingState label="Loading article" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading article');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('renders a retryable error state', () => {
    const reset = jest.fn();

    render(
      <PublicErrorState
        title="This story could not be loaded"
        description="Try again shortly."
        reset={reset}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'This story could not be loaded' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Back to latest news' })).toHaveAttribute('href', '/');
  });

  it('renders a branded not-found state with public navigation', () => {
    render(
      <PublicNotFound
        categories={[]}
        eyebrow="404 · Article"
        title="This story was not found"
        description="It may have moved."
      />,
    );

    expect(screen.getByRole('heading', { name: 'This story was not found' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'Latest news' })).toHaveAttribute('href', '/');
    expect(within(main).getByRole('link', { name: 'Search DailyStar' })).toHaveAttribute(
      'href',
      '/search',
    );
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});
