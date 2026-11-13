import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  NotificationBadge,
  NotificationList,
} from '../components/NotificationList';
import { useCmsApi } from '../../../lib/cms-api';
import { useSession } from '../session-provider';
import { NotificationListResponse, NotificationSummary, NotificationType } from '@dailystar/types';

jest.mock('../../../lib/cms-api', () => ({
  ...jest.requireActual('../../../lib/cms-api'),
  useCmsApi: jest.fn(),
}));
jest.mock('../session-provider', () => ({
  useSession: jest.fn(),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

const makeNotification = (overrides: Partial<NotificationSummary> = {}): NotificationSummary => ({
  id: 'n1',
  type: NotificationType.ARTICLE_SUBMITTED_FOR_REVIEW,
  title: 'Article submitted for review',
  body: 'Jane submitted "Budget 2026" for review.',
  articleId: 'article-1',
  readAt: null,
  createdAt: '2026-11-12T10:00:00.000Z',
  ...overrides,
});

const makePage = (data: NotificationSummary[]): NotificationListResponse => ({
  data,
  total: data.length,
  page: 1,
  limit: 20,
});

describe('NotificationList', () => {
  const mockGet = jest.fn();
  const mockPatch = jest.fn();
  const mockPost = jest.fn();

  let listResponse: NotificationListResponse;
  let unreadResponse: number;
  let listError: Error | null;
  let countError: Error | null;

  beforeEach(() => {
    jest.clearAllMocks();
    listResponse = makePage([makeNotification()]);
    unreadResponse = 1;
    listError = null;
    countError = null;

    (useCmsApi as jest.Mock).mockReturnValue({
      get: mockGet,
      patch: mockPatch,
      post: mockPost,
    });
    (useSession as jest.Mock).mockReturnValue({
      status: 'authenticated',
      accessToken: 'test-token',
    });

    mockGet.mockImplementation((url: string) => {
      if (url.includes('unread-count')) {
        return countError ? Promise.reject(countError) : Promise.resolve({ unread: unreadResponse });
      }
      if (url.startsWith('/v1/notifications?')) {
        return listError ? Promise.reject(listError) : Promise.resolve(listResponse);
      }
      return Promise.resolve(null);
    });
    mockPatch.mockResolvedValue(undefined);
    mockPost.mockResolvedValue({ updated: 1 });
  });

  const renderList = async () => {
    await act(async () => {
      render(<NotificationList />);
    });
  };

  it('shows a loading state while the list request is in flight', async () => {
    mockGet.mockImplementation(() => new Promise(() => {}));

    await renderList();

    expect(screen.getByText('Loading notifications...')).toBeInTheDocument();
  });

  it('loads notifications and requests the unread count', async () => {
    listResponse = makePage([
      makeNotification(),
      makeNotification({
        id: 'n2',
        type: NotificationType.ARTICLE_APPROVED,
        title: 'Article approved',
        body: 'Your article "Budget 2026" was approved.',
        articleId: null,
        readAt: '2026-11-12T11:00:00.000Z',
      }),
    ]);

    await renderList();

    expect(mockGet).toHaveBeenCalledWith('/v1/notifications?page=1&limit=20');
    expect(mockGet).toHaveBeenCalledWith('/v1/notifications/unread-count');

    expect(screen.getByText('Submitted for review')).toBeInTheDocument();
    expect(screen.getByText('Article submitted for review')).toBeInTheDocument();
    expect(screen.getByText('Jane submitted "Budget 2026" for review.')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();

    const unreadItem = screen.getByTestId('notification-n1');
    expect(within(unreadItem).getByText('Unread')).toBeInTheDocument();
    const readItem = screen.getByTestId('notification-n2');
    expect(within(readItem).getByText('Read')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'View article' });
    expect(link).toHaveAttribute('href', '/cms/articles/article-1');
    expect(screen.getAllByRole('link', { name: 'View article' })).toHaveLength(1);

    const time = document.querySelector('time');
    expect(time).toHaveAttribute('datetime', '2026-11-12T10:00:00.000Z');
  });

  it('marks a single notification as read and updates the unread count', async () => {
    listResponse = makePage([
      makeNotification(),
      makeNotification({
        id: 'n2',
        title: 'Article rejected',
        type: NotificationType.ARTICLE_REJECTED,
      }),
    ]);
    unreadResponse = 2;

    await renderList();
    expect(screen.getByTestId('unread-count')).toHaveTextContent('2 unread');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark "Article submitted for review" as read' }));
    });

    expect(mockPatch).toHaveBeenCalledWith('/v1/notifications/n1/read');
    await waitFor(() => {
      expect(within(screen.getByTestId('notification-n1')).queryByText('Unread')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('unread-count')).toHaveTextContent('1 unread');
  });

  it('rolls back the optimistic read state when marking read fails', async () => {
    mockPatch.mockRejectedValue(new Error('Request failed'));

    await renderList();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark "Article submitted for review" as read' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Request failed');
    });
    expect(within(screen.getByTestId('notification-n1')).getByText('Unread')).toBeInTheDocument();
    expect(screen.getByTestId('unread-count')).toHaveTextContent('1 unread');
  });

  it('marks all notifications as read', async () => {
    listResponse = makePage([
      makeNotification(),
      makeNotification({ id: 'n2', title: 'Second notification' }),
      makeNotification({
        id: 'n3',
        title: 'Third notification',
        readAt: '2026-11-12T11:00:00.000Z',
      }),
    ]);
    unreadResponse = 2;

    await renderList();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    });

    expect(mockPost).toHaveBeenCalledWith('/v1/notifications/read-all');
    await waitFor(() => {
      expect(screen.getByTestId('unread-count')).toHaveTextContent('All caught up');
    });
    expect(screen.getAllByText('Read')).toHaveLength(3);
    expect(screen.queryByText('Unread')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('shows the empty state and disables mark-all', async () => {
    listResponse = makePage([]);
    unreadResponse = 0;

    await renderList();

    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
    expect(screen.getByTestId('unread-count')).toHaveTextContent('All caught up');
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('shows an inline error and retries the request', async () => {
    listError = new Error('Network error');
    unreadResponse = 0;

    await renderList();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    });

    listError = null;
    listResponse = makePage([makeNotification({ title: 'Recovered notification' })]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });

    await waitFor(() => {
      expect(screen.getByText('Recovered notification')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('NotificationBadge', () => {
  const mockGet = jest.fn();
  const mockPatch = jest.fn();

  let unreadResponse: number;
  let countError: Error | null;

  beforeEach(() => {
    jest.clearAllMocks();
    unreadResponse = 0;
    countError = null;

    (useCmsApi as jest.Mock).mockReturnValue({
      get: mockGet,
      patch: mockPatch,
      post: jest.fn().mockResolvedValue({ updated: 1 }),
    });
    (useSession as jest.Mock).mockReturnValue({
      status: 'authenticated',
      accessToken: 'test-token',
    });

    mockGet.mockImplementation((url: string) => {
      if (url.includes('unread-count')) {
        return countError ? Promise.reject(countError) : Promise.resolve({ unread: unreadResponse });
      }
      if (url.startsWith('/v1/notifications?')) {
        return Promise.resolve({
          data: [makeNotification()],
          total: 1,
          page: 1,
          limit: 20,
        });
      }
      return Promise.resolve(null);
    });
    mockPatch.mockResolvedValue(undefined);
  });

  it('renders the navigation link with the unread count', async () => {
    unreadResponse = 3;

    await act(async () => {
      render(<NotificationBadge />);
    });

    const link = screen.getByRole('link', { name: /Notifications/ });
    expect(link).toHaveAttribute('href', '/cms/notifications');

    const badge = await screen.findByTestId('notification-badge');
    expect(badge).toHaveTextContent('3');
    expect(badge).toHaveAttribute('aria-label', '3 unread notifications');
  });

  it('renders the link without a badge when the count request fails', async () => {
    countError = new Error('Network error');

    await act(async () => {
      render(<NotificationBadge />);
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/v1/notifications/unread-count');
    });
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('does not request the count before the session is authenticated', async () => {
    (useSession as jest.Mock).mockReturnValue({ status: 'loading', accessToken: null });

    await act(async () => {
      render(<NotificationBadge />);
    });

    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('updates the badge after a notification is marked read', async () => {
    unreadResponse = 1;

    await act(async () => {
      render(
        <>
          <NotificationBadge />
          <NotificationList />
        </>,
      );
    });

    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('1');

    unreadResponse = 0;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark "Article submitted for review" as read' }));
    });

    expect(mockPatch).toHaveBeenCalledWith('/v1/notifications/n1/read');
    await waitFor(() => {
      expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    });
  });
});
