import { render, screen } from '@testing-library/react';
import HomePage from '../page';

// Mock Next.js metadata exports that aren't available in test environment
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
}));

/**
 * Phase 0 smoke test — verifies the landing page renders
 * with the DailyStar heading present in the DOM.
 */
describe('HomePage', () => {
  it('renders the DailyStar heading', () => {
    render(<HomePage />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toContain('DailyStar');
  });

  it('shows the infrastructure status section', () => {
    render(<HomePage />);
    expect(screen.getByRole('region', { name: /infrastructure status/i })).toBeInTheDocument();
    expect(screen.getByText('Next.js')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
  });

  it('includes a health check API link', () => {
    render(<HomePage />);
    const link = screen.getByRole('link', { name: /localhost:3001\/health/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'http://localhost:3001/health');
  });
});
