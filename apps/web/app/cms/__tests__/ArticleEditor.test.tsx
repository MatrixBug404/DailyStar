import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ArticleEditor } from '../components/ArticleEditor';
import { useCmsApi } from '../../../lib/cms-api';
import { useSession } from '../session-provider';
import { ArticleStatus } from '@dailystar/types';
import { useRouter } from 'next/navigation';

jest.mock('../../../lib/cms-api');
jest.mock('../session-provider');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));
jest.mock('../components/WorkflowPanel', () => ({
  WorkflowPanel: () => <div data-testid="workflow-panel" />
}));
jest.mock('../components/CoverPicker', () => ({
  CoverPicker: () => <div data-testid="cover-picker" />
}));
jest.mock('../components/RevisionHistory', () => ({
  RevisionHistory: () => <div data-testid="revision-history" />
}));
jest.mock('../components/AuditLogPanel', () => ({
  AuditLogPanel: () => <div data-testid="audit-log-panel" />
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockPush = jest.fn();

describe('ArticleEditor', () => {
  const alertMock = jest.spyOn(window, 'alert').mockImplementation(() => {});

  afterAll(() => {
    alertMock.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (useCmsApi as jest.Mock).mockReturnValue({
      get: mockGet,
      post: mockPost,
      patch: mockPatch,
    });
    (useSession as jest.Mock).mockReturnValue({
      permissions: ['article.read.any', 'category.read'],
      user: { id: 'user-1' }
    });
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush
    });

    mockGet.mockImplementation((url: string) => {
      if (url === '/v1/categories') return Promise.resolve([]);
      if (url.endsWith('/revisions')) return Promise.resolve([]);
      if (url.endsWith('/audit')) return Promise.resolve([]);
      if (url.includes('/articles/123')) return Promise.resolve({
        id: '123',
        status: ArticleStatus.DRAFT,
        version: 1,
        currentRevision: { title: 'Test Title', body: 'Test Body', excerpt: 'Test Excerpt' }
      });
      return Promise.resolve({});
    });
  });

  const renderComponent = async (articleId = '123') => {
    let result;
    await act(async () => {
      result = render(<ArticleEditor articleId={articleId} />);
    });
    return result;
  };

  it('renders new article form', async () => {
    await renderComponent('new');
    expect(screen.getByText('New Article')).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    await renderComponent('new');
    const form = screen.getByText('Save Article').closest('form');

    // Trigger submit with empty fields
    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(screen.getByText(/Title must be between 3 and 150 characters/)).toBeInTheDocument();

    // Fix title, but empty body
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Valid Title' } });
    });

    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(screen.getByText(/Body cannot be empty/)).toBeInTheDocument();

    // Fix body, but long excerpt
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Body (Markdown)'), { target: { value: 'Valid body' } });
      fireEvent.change(screen.getByLabelText('Excerpt'), { target: { value: 'a'.repeat(501) } });
    });

    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(screen.getByText(/Excerpt must be at most 500 characters/)).toBeInTheDocument();

    // Fix excerpt, but too many tags
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Excerpt'), { target: { value: 'Valid excerpt' } });
      fireEvent.change(screen.getByLabelText('Tags (comma-separated)'), { target: { value: '1,2,3,4,5,6,7,8,9,10,11' } });
    });

    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(screen.getByText(/Maximum 10 tags allowed/)).toBeInTheDocument();
  });

  it('CREATE payload structure', async () => {
    await renderComponent('new');

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New Title' } });
      fireEvent.change(screen.getByLabelText('Body (Markdown)'), { target: { value: 'New Body' } });
      fireEvent.change(screen.getByLabelText('Excerpt'), { target: { value: 'New Excerpt' } });
      fireEvent.change(screen.getByLabelText('Tags (comma-separated)'), { target: { value: 'tag1, tag2' } });
    });

    mockPost.mockResolvedValueOnce({ id: '999' });

    const form = screen.getByText('Save Article').closest('form');
    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(mockPost).toHaveBeenCalledWith('/v1/articles', {
      title: 'New Title',
      body: 'New Body',
      excerpt: 'New Excerpt',
      tags: ['tag1', 'tag2'],
      categoryId: undefined
    });
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('slug');
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('expectedVersion');
    expect(mockPush).toHaveBeenCalledWith('/cms/articles/999');
  });

  it('UPDATE payload structure', async () => {
    await renderComponent('123');

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated Title' } });
      fireEvent.change(screen.getByLabelText('Body (Markdown)'), { target: { value: 'Updated Body' } });
    });

    mockPatch.mockResolvedValueOnce({});
    mockGet.mockResolvedValueOnce({
      id: '123', status: ArticleStatus.DRAFT, version: 2, currentRevision: { title: 'Updated Title', body: 'Updated Body' }
    });

    const form = screen.getByText('Save Article').closest('form');
    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(mockPatch).toHaveBeenCalledWith('/v1/articles/123', expect.objectContaining({
      title: 'Updated Title',
      body: 'Updated Body',
      expectedVersion: 1
    }));
    expect(mockPatch.mock.calls[0][1]).not.toHaveProperty('slug');
  });

  it('prevents double-submit', async () => {
    await renderComponent('new');

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New Title' } });
      fireEvent.change(screen.getByLabelText('Body (Markdown)'), { target: { value: 'New Body' } });
    });

    // Make post hang
    let resolvePost: any;
    mockPost.mockImplementation(() => new Promise(r => resolvePost = r));

    const form = screen.getByText('Save Article').closest('form');

    // First submit
    fireEvent.submit(form!);

    // Ensure saving state reflects
    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeInTheDocument();
      expect(screen.getByText('Saving...').closest('button')).toBeDisabled();
    });

    // Cleanup hanging promise to not leave test hanging
    await act(async () => {
      resolvePost({ id: '999' });
    });
  });

  it('shows warning modal if editing APPROVED article, cancel aborts', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/articles/123')) return Promise.resolve({
        id: '123', status: ArticleStatus.APPROVED, version: 1, currentRevision: { title: 'Valid Title', body: 'Valid Body' }
      });
      return Promise.resolve([]);
    });

    await renderComponent('123');

    const form = screen.getByText('Save Article').closest('form');
    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(screen.getByText(/Saving changes will revert this article to/)).toBeInTheDocument();

    // Cancel
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });

    expect(screen.queryByText(/Saving changes will revert this article to/)).not.toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('shows warning modal if editing SCHEDULED article, confirm proceeds', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/articles/123')) return Promise.resolve({
        id: '123', status: ArticleStatus.SCHEDULED, version: 1, currentRevision: { title: 'Valid Title', body: 'Valid Body' }
      });
      return Promise.resolve([]);
    });

    await renderComponent('123');

    const form = screen.getByText('Save Article').closest('form');
    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(screen.getByText(/scheduled publication will be cancelled/)).toBeInTheDocument();

    mockPatch.mockResolvedValueOnce({});
    mockGet.mockResolvedValueOnce({
      id: '123', status: ArticleStatus.DRAFT, version: 2, currentRevision: { title: 'Valid Title', body: 'Valid Body' }
    });

    // Confirm
    await act(async () => {
      fireEvent.click(screen.getByText('Yes, Save Changes'));
    });

    expect(mockPatch).toHaveBeenCalledWith('/v1/articles/123', expect.objectContaining({ expectedVersion: 1 }));
  });
});
