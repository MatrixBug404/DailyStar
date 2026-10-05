import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ArticleList } from '../components/ArticleList';
import { useCmsApi } from '../../../lib/cms-api';
import { useSession } from '../session-provider';
import { ArticleStatus } from '@dailystar/types';

jest.mock('../../../lib/cms-api');
jest.mock('../session-provider');
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

describe('ArticleList', () => {
  const mockGet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useCmsApi as jest.Mock).mockReturnValue({
      get: mockGet,
    });
    (useSession as jest.Mock).mockReturnValue({
      permissions: ['article.read.any', 'category.read'],
      user: { id: 'user-1' }
    });

    mockGet.mockImplementation((url: string) => {
      if (url === '/v1/categories') return Promise.resolve([
        { id: 'cat-1', name: 'Category 1' }
      ]);
      if (url.includes('/v1/articles')) return Promise.resolve({
        data: [{ id: '1', status: ArticleStatus.DRAFT, updatedAt: new Date().toISOString(), currentRevision: { title: 'Test Article' } }],
        total: 10,
        page: 1,
        limit: 20
      });
      return Promise.resolve({});
    });
  });

  const renderComponent = async (props: any = { title: 'Articles' }) => {
    let result;
    await act(async () => {
      result = render(<ArticleList {...props} />);
    });
    return result;
  };

  it('renders correctly and makes initial fetch', async () => {
    await renderComponent();
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/articles?page=1&limit=20&sortBy=updatedAt&order=desc'));
    expect(screen.getByText('Test Article')).toBeInTheDocument();
  });

  it('changes status filter and re-fetches', async () => {
    await renderComponent();
    mockGet.mockClear();

    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: ArticleStatus.PUBLISHED } });
    });

    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('status=PUBLISHED'));
  });

  it('changes category filter and re-fetches', async () => {
    await renderComponent();
    mockGet.mockClear();

    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'cat-1' } });
    });

    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('categoryId=cat-1'));
  });

  it('changes sortBy and re-fetches', async () => {
    await renderComponent();
    mockGet.mockClear();

    const select = screen.getByLabelText('Sort By') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'createdAt' } });
    });

    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('sortBy=createdAt'));
  });

  it('changes order and re-fetches', async () => {
    await renderComponent();
    mockGet.mockClear();

    const select = screen.getByLabelText('Order') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'asc' } });
    });

    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('order=asc'));
  });

  it('handles pagination', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/v1/categories') return Promise.resolve([]);
      if (url.includes('/v1/articles')) return Promise.resolve({
        data: [{ id: '1', status: ArticleStatus.DRAFT, updatedAt: new Date().toISOString(), currentRevision: { title: 'Test Article' } }],
        total: 50,
        page: 1,
        limit: 20
      });
      return Promise.resolve({});
    });

    await renderComponent();
    mockGet.mockClear();

    const nextButton = screen.getByText('Next');
    await act(async () => {
      fireEvent.click(nextButton);
    });

    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('page=2'));
  });

  it('shows normal empty state when no articles and no filters', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/v1/categories') return Promise.resolve([]);
      if (url.includes('/v1/articles')) return Promise.resolve({ data: [], total: 0, page: 1, limit: 20 });
      return Promise.resolve({});
    });

    await renderComponent();
    expect(screen.getByText('Get started by creating your first article.')).toBeInTheDocument();
  });

  it('shows filtered empty state when filters are applied', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/v1/categories') return Promise.resolve([]);
      if (url.includes('/v1/articles')) return Promise.resolve({ data: [], total: 0, page: 1, limit: 20 });
      return Promise.resolve({});
    });

    await renderComponent();

    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: ArticleStatus.PUBLISHED } });
    });

    expect(screen.getByText('Try adjusting your filters to find what you are looking for.')).toBeInTheDocument();
  });

  it('respects fixedStatusFilter and hides filter bar', async () => {
    await renderComponent({ title: 'Review Queue', fixedStatusFilter: [ArticleStatus.SUBMITTED_FOR_REVIEW] });

    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('status=SUBMITTED_FOR_REVIEW'));

    // Filter controls should not be in the document
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument();
  });
});
