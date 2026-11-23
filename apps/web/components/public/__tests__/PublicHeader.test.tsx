import React from 'react';
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { usePathname } from 'next/navigation';
import { PublicHeader } from '../PublicHeader';
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
    children: [
      {
        id: 'c2',
        name: 'Policy',
        slug: 'policy',
        parentId: 'c1',
        publishedArticleCount: 2,
        children: [],
      },
    ],
  },
  {
    id: 'c3',
    name: 'Sport',
    slug: 'sport',
    parentId: null,
    publishedArticleCount: 9,
    children: [],
  },
];

const edition = { iso: '2026-11-13', label: 'Friday, 13 November 2026' };

function renderHeader() {
  return render(<PublicHeader categories={categories} edition={edition} />);
}
describe('PublicHeader', () => {
  beforeEach(() => {
    (usePathname as jest.Mock).mockReturnValue('/');
  });

  it('renders the masthead, edition date and CMS entry point', () => {
    renderHeader();

    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'DailyStar home' })).toHaveAttribute(
      'href',
      '/',
    );

    const date = screen.getByText('Friday, 13 November 2026');
    expect(date.tagName).toBe('TIME');
    expect(date).toHaveAttribute('datetime', '2026-11-13');

    const cmsLinks = banner.querySelectorAll('a[href="/cms/login"]');
    expect(cmsLinks).toHaveLength(2);
  });

  it('provides labelled search forms that submit to the search route', () => {
    renderHeader();

    const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form[role="search"]'));
    expect(forms).toHaveLength(2);

    for (const form of forms) {
      expect(form).toHaveAttribute('action', '/search');
      expect(form).toHaveAttribute('method', 'get');

      const input = form.querySelector<HTMLInputElement>('input[name="q"]');
      expect(input).not.toBeNull();
      expect(input).toHaveAttribute('type', 'search');
      expect(input).toHaveAttribute('required');
      expect(input).toHaveAttribute('pattern', '.*\\S.*');

      const label = form.querySelector<HTMLLabelElement>('label');
      expect(label).not.toBeNull();
      expect(label).toHaveAttribute('for', input!.id);
      expect(label).toHaveTextContent('Search DailyStar');

      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      expect(submit).not.toBeNull();
      expect(submit).toHaveTextContent('Search');
    }
  });

  it('rejects whitespace-only submissions and permits real queries', () => {
    renderHeader();

    const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form[role="search"]'));
    expect(forms).toHaveLength(2);

    for (const form of forms) {
      const input = form.querySelector<HTMLInputElement>('input[name="q"]');
      expect(input).not.toBeNull();

      input!.value = '   ';
      const whitespaceEvent = createEvent.submit(form, { bubbles: true, cancelable: true });
      form.dispatchEvent(whitespaceEvent);
      expect(whitespaceEvent.defaultPrevented).toBe(true);

      input!.value = 'India news';
      const validEvent = createEvent.submit(form, { bubbles: true, cancelable: true });
      form.dispatchEvent(validEvent);
      expect(validEvent.defaultPrevented).toBe(false);
    }
  });

  it('renders navigation from the public categories API only', () => {
    renderHeader();

    const politicsLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href="/category/politics"]'),
    );
    expect(politicsLinks).toHaveLength(2);
    for (const link of politicsLinks) {
      expect(link).toHaveTextContent('Politics');
    }

    expect(
      document.querySelectorAll('a[href="/category/sport"]').length,
    ).toBeGreaterThan(0);
    // Nested sections are listed in the mobile menu only.
    expect(document.querySelectorAll('a[href="/category/policy"]').length).toBe(1);
    expect(screen.queryByRole('link', { name: 'Entertainment' })).not.toBeInTheDocument();

    expect(
      screen.getAllByRole('navigation', { name: 'News sections' }).length,
    ).toBeGreaterThan(0);
  });

  it('remains usable without category data', () => {
    render(<PublicHeader categories={[]} edition={edition} />);

    expect(screen.getAllByRole('link', { name: 'Home' }).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('a[href^="/category/"]')).toHaveLength(0);
  });

  it('marks the active section with aria-current', () => {
    (usePathname as jest.Mock).mockReturnValue('/category/politics');

    renderHeader();

    expect(
      document.querySelectorAll('a[href="/category/politics"][aria-current="page"]'),
    ).toHaveLength(2);
    expect(document.querySelectorAll('a[href="/"][aria-current="page"]')).toHaveLength(0);
  });

  it('toggles the mobile navigation and closes it with Escape', () => {
    renderHeader();

    const panel = document.getElementById('public-mobile-menu');
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('hidden');

    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'public-mobile-menu');

    fireEvent.click(toggle);

    expect(panel).not.toHaveAttribute('hidden');
    const closeToggle = screen.getByRole('button', { name: 'Close menu' });
    expect(closeToggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(panel).toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
