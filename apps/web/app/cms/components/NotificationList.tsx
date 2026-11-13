'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { NotificationListResponse, NotificationSummary, NotificationType } from '@dailystar/types';
import { useCmsApi } from '../../../lib/cms-api';
import { useSession } from '../session-provider';
import { Button } from './ui/Button';

/**
 * Event dispatched after notification read-state changes so the navigation
 * badge can refresh without polling, WebSockets, or a second HTTP client.
 */
export const NOTIFICATIONS_CHANGED_EVENT = 'cms:notifications-changed';

function notifyNotificationsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
  }
}

const TYPE_LABELS: Record<string, string> = {
  [NotificationType.ARTICLE_SUBMITTED_FOR_REVIEW]: 'Submitted for review',
  [NotificationType.ARTICLE_APPROVED]: 'Approved',
  [NotificationType.ARTICLE_REJECTED]: 'Rejected',
  [NotificationType.ARTICLE_FAILED_TO_PUBLISH]: 'Scheduled publish failed',
};

function typeLabel(type: NotificationType | string): string {
  return TYPE_LABELS[type] || String(type);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * In-app notification list (Phase 8 spec §11).
 * Loads the caller's newest notifications on mount; read actions update local
 * state and notify the navigation badge. Text-only rendering.
 */
export function NotificationList() {
  const api = useCmsApi();
  const [data, setData] = useState<NotificationListResponse | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const loadUnreadCount = useCallback(async () => {
    try {
      const result = await api.get<{ unread: number }>('/v1/notifications/unread-count');
      if (result && typeof result.unread === 'number') {
        setUnreadCount(result.unread);
      }
    } catch {
      // A failing count must not block the list itself.
    }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<NotificationListResponse>('/v1/notifications?page=1&limit=20');
      setData(result);
      setUnreadCount(result.data.filter((notification) => !notification.readAt).length);
      notifyNotificationsChanged();
      // Authoritative total (the page may hold fewer than all unread rows).
      void loadUnreadCount();
    } catch (err) {
      setData(null);
      setError(errorMessage(err, 'Failed to load notifications'));
    } finally {
      setLoading(false);
    }
  }, [api, loadUnreadCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMarkRead = async (notification: NotificationSummary) => {
    if (notification.readAt || pendingId !== null) {
      return;
    }

    setActionError('');
    setPendingId(notification.id);
    setData((previous) =>
      previous && {
        ...previous,
        data: previous.data.map((item) =>
          item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      },
    );
    setUnreadCount((count) => Math.max(0, count - 1));

    try {
      await api.patch(`/v1/notifications/${notification.id}/read`);
      notifyNotificationsChanged();
    } catch (err) {
      setData((previous) =>
        previous && {
          ...previous,
          data: previous.data.map((item) =>
            item.id === notification.id ? { ...item, readAt: null } : item,
          ),
        },
      );
      setActionError(errorMessage(err, 'Could not mark the notification as read.'));
      void loadUnreadCount();
    } finally {
      setPendingId(null);
    }
  };

  const handleMarkAll = async () => {
    if (markingAll || unreadCount === 0) {
      return;
    }

    setActionError('');
    setMarkingAll(true);
    const readAt = new Date().toISOString();
    setData((previous) =>
      previous && {
        ...previous,
        data: previous.data.map((item) => (item.readAt ? item : { ...item, readAt })),
      },
    );
    setUnreadCount(0);

    try {
      await api.post('/v1/notifications/read-all');
      notifyNotificationsChanged();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not mark all notifications as read.'));
      void load();
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="notifications-heading">
      <div className="flex justify-between items-center gap-4">
        <h1 id="notifications-heading" className="text-2xl font-bold">
          Notifications
        </h1>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleMarkAll()}
          disabled={markingAll || unreadCount === 0}
        >
          {markingAll ? 'Marking all as read...' : 'Mark all as read'}
        </Button>
      </div>

      <p className="text-sm text-gray-600" data-testid="unread-count">
        {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
      </p>

      {actionError && (
        <div role="alert" className="bg-red-50 text-red-700 p-3 rounded">
          {actionError}
        </div>
      )}

      {loading && !data ? (
        <p role="status" className="text-gray-600">
          Loading notifications...
        </p>
      ) : error ? (
        <div role="alert" className="bg-red-50 text-red-700 p-3 rounded space-y-2">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : !data || data.data.length === 0 ? (
        <p className="text-gray-600">No notifications yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200 border rounded bg-white">
          {data.data.map((notification) => {
            const unread = !notification.readAt;
            return (
              <li
                key={notification.id}
                data-testid={`notification-${notification.id}`}
                className={`p-4 flex justify-between items-start gap-4 ${unread ? 'bg-blue-50' : ''}`}
              >
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {typeLabel(notification.type)}
                  </p>
                  <p className="font-medium text-gray-900">{notification.title}</p>
                  <p className="text-sm text-gray-700">{notification.body}</p>
                  <p className="text-xs text-gray-500">
                    <time dateTime={notification.createdAt}>{formatTimestamp(notification.createdAt)}</time>
                  </p>
                  {notification.articleId && (
                    <Link
                      href={`/cms/articles/${notification.articleId}`}
                      className="inline-block text-sm text-blue-600 hover:text-blue-900"
                    >
                      View article
                    </Link>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {unread ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-blue-600" />
                      Unread
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500">Read</span>
                  )}
                  {unread && (
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Mark "${notification.title}" as read`}
                      disabled={pendingId === notification.id}
                      onClick={() => void handleMarkRead(notification)}
                    >
                      Mark read
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Protected-layout navigation entry with a live unread badge.
 * Refreshes on mount and whenever the list announces a read-state change.
 * If the count request fails the link renders without a badge.
 */
export function NotificationBadge() {
  const api = useCmsApi();
  const { status, accessToken } = useSession();
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !accessToken) {
      setUnread(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const result = await api.get<{ unread: number }>('/v1/notifications/unread-count');
        if (!cancelled && result && typeof result.unread === 'number') {
          setUnread(result.unread);
        }
      } catch {
        if (!cancelled) {
          setUnread(null);
        }
      }
    };

    void load();
    const onChange = () => {
      void load();
    };
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);

    return () => {
      cancelled = true;
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);
    };
  }, [api, status, accessToken]);

  return (
    <Link
      href="/cms/notifications"
      className="inline-flex items-center gap-2 text-sm text-gray-700 hover:text-black"
    >
      Notifications
      {unread !== null && unread > 0 && (
        <span
          data-testid="notification-badge"
          aria-label={`${unread} unread notification${unread === 1 ? '' : 's'}`}
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 py-0.5 text-xs font-semibold text-white"
        >
          {unread}
        </span>
      )}
    </Link>
  );
}
