import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WorkflowPanel } from '../components/WorkflowPanel';
import { useCmsApi, CmsApiError } from '../../../lib/cms-api';
import { useSession } from '../session-provider';
import { ArticleStatus } from '@dailystar/types';

jest.mock('../../../lib/cms-api', () => ({
  ...jest.requireActual('../../../lib/cms-api'),
  useCmsApi: jest.fn(),
}));
jest.mock('../session-provider');

describe('WorkflowPanel', () => {
  const mockPost = jest.fn();
  const alertMock = jest.spyOn(window, 'alert').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
    (useCmsApi as jest.Mock).mockReturnValue({
      post: mockPost,
    });
    (useSession as jest.Mock).mockReturnValue({
      permissions: [
        'article.start-review',
        'article.approve',
        'article.publish',
        'article.reject',
        'article.request-changes',
        'article.cancel-schedule',
        'article.schedule',
        'article.archive',
      ],
      user: { id: 'reviewer-1' },
    });
  });

  afterAll(() => {
    alertMock.mockRestore();
  });

  const renderPanel = (status: ArticleStatus, authorId = 'author-1') => {
    const article: any = {
      id: '123',
      status,
      version: 5,
      primaryAuthorId: authorId,
    };
    let res: any;
    act(() => {
      res = render(<WorkflowPanel article={article} onSuccess={jest.fn()} />);
    });
    return res;
  };

  it('DRAFT shows Submit for Review', async () => {
    renderPanel(ArticleStatus.DRAFT);
    await act(async () => {
      fireEvent.click(screen.getByText('Submit for Review'));
    });
    expect(mockPost).toHaveBeenCalledWith('/v1/articles/123/submit-review', { expectedVersion: 5 });
  });

  it('SUBMITTED_FOR_REVIEW shows Start Review', async () => {
    renderPanel(ArticleStatus.SUBMITTED_FOR_REVIEW);
    await act(async () => {
      fireEvent.click(screen.getByText('Start Review'));
    });
    expect(mockPost).toHaveBeenCalledWith('/v1/articles/123/start-review', { expectedVersion: 5 });
  });

  it('UNDER_REVIEW shows Approve, Request Changes, Reject', async () => {
    renderPanel(ArticleStatus.UNDER_REVIEW);

    // Approve
    await act(async () => {
      fireEvent.click(screen.getByText('Approve'));
    });
    expect(mockPost).toHaveBeenCalledWith('/v1/articles/123/approve', { expectedVersion: 5 });
  });

  it('hides approve button for authors (Four-Eyes)', () => {
    (useSession as jest.Mock).mockReturnValue({
      permissions: ['article.approve'],
      user: { id: 'author-1' }, // Same as primaryAuthorId
    });
    renderPanel(ArticleStatus.UNDER_REVIEW, 'author-1');
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('APPROVED shows Publish Now', async () => {
    renderPanel(ArticleStatus.APPROVED);
    await act(async () => {
      fireEvent.click(screen.getByText('Publish Now'));
    });
    expect(mockPost).toHaveBeenCalledWith('/v1/articles/123/publish', { expectedVersion: 5 });
  });

  it('SCHEDULED shows Cancel Schedule and no schedule creation', async () => {
    renderPanel(ArticleStatus.SCHEDULED);
    expect(screen.queryByText('Schedule Publication')).not.toBeInTheDocument(); // No schedule creation UI
    expect(screen.getByText('Cancel Schedule')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Cancel Schedule'));
    });
    expect(mockPost).toHaveBeenCalledWith('/v1/articles/123/cancel-schedule', {
      expectedVersion: 5,
    });
  });

  it('PUBLISHED shows Archive', async () => {
    renderPanel(ArticleStatus.PUBLISHED);
    await act(async () => {
      fireEvent.click(screen.getByText('Archive'));
    });
    expect(mockPost).toHaveBeenCalledWith('/v1/articles/123/archive', { expectedVersion: 5 });
  });

  it('ARCHIVED shows no Restore', () => {
    renderPanel(ArticleStatus.ARCHIVED);
    expect(screen.queryByText(/restore/i)).not.toBeInTheDocument();
  });

  it('request-changes comment modal enforces validation', async () => {
    renderPanel(ArticleStatus.UNDER_REVIEW);

    await act(async () => {
      fireEvent.click(screen.getByText('Request Changes'));
    });

    const input = screen.getByPlaceholderText(
      'Why are you making this decision?',
    ) as HTMLTextAreaElement;
    expect(input).toHaveAttribute('maxLength', '1000');

    const confirmBtn = screen.getByText('Confirm');

    // Empty comment disables button
    expect(confirmBtn).toBeDisabled();

    // Whitespace comment disables button
    await act(async () => {
      fireEvent.change(input, { target: { value: '   ' } });
    });
    expect(confirmBtn).toBeDisabled();

    // Valid comment enables button, sends trimmed payload
    await act(async () => {
      fireEvent.change(input, { target: { value: '  Needs more detail  ' } });
    });
    expect(confirmBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(mockPost).toHaveBeenCalledWith('/v1/articles/123/request-changes', {
      expectedVersion: 5,
      comment: 'Needs more detail',
    });
  });

  it('reject comment modal enforces validation', async () => {
    renderPanel(ArticleStatus.UNDER_REVIEW);

    await act(async () => {
      fireEvent.click(screen.getByText('Reject'));
    });

    const input = screen.getByPlaceholderText(
      'Why are you making this decision?',
    ) as HTMLTextAreaElement;
    const confirmBtn = screen.getByText('Confirm');

    // Whitespace comment disables button
    await act(async () => {
      fireEvent.change(input, { target: { value: '   ' } });
    });
    expect(confirmBtn).toBeDisabled();

    // Valid comment
    await act(async () => {
      fireEvent.change(input, { target: { value: '  Too controversial  ' } });
    });

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(mockPost).toHaveBeenCalledWith('/v1/articles/123/reject', {
      expectedVersion: 5,
      comment: 'Too controversial',
    });
  });

  describe('API error handling', () => {
    it('handles FOUR_EYES_VIOLATION', async () => {
      renderPanel(ArticleStatus.DRAFT);
      const error = new CmsApiError(400, 'FOUR_EYES_VIOLATION', 'FOUR_EYES_VIOLATION');
      mockPost.mockRejectedValueOnce(error);

      await act(async () => {
        fireEvent.click(screen.getByText('Submit for Review'));
      });

      expect(alertMock).toHaveBeenCalledWith('You cannot approve your own article (INV6-03).');
    });

    it('handles VERSION_MISMATCH', async () => {
      renderPanel(ArticleStatus.DRAFT);
      const error = new CmsApiError(409, 'VERSION_MISMATCH', 'VERSION_MISMATCH');
      mockPost.mockRejectedValueOnce(error);

      await act(async () => {
        fireEvent.click(screen.getByText('Submit for Review'));
      });

      expect(alertMock).toHaveBeenCalledWith(
        'Article changed elsewhere — reload to see latest version (INV6-04).',
      );
    });

    it('handles UNAUTHORIZED_WORKFLOW_ACTION', async () => {
      renderPanel(ArticleStatus.DRAFT);
      const error = new CmsApiError(
        403,
        'UNAUTHORIZED_WORKFLOW_ACTION',
        'UNAUTHORIZED_WORKFLOW_ACTION',
      );
      mockPost.mockRejectedValueOnce(error);

      await act(async () => {
        fireEvent.click(screen.getByText('Submit for Review'));
      });

      expect(alertMock).toHaveBeenCalledWith(
        'You do not have permission for this workflow action.',
      );
    });

    it('handles generic CmsApiError', async () => {
      renderPanel(ArticleStatus.DRAFT);
      const error = new CmsApiError(400, 'Some random error message', 'UNKNOWN_ERROR');
      mockPost.mockRejectedValueOnce(error);

      await act(async () => {
        fireEvent.click(screen.getByText('Submit for Review'));
      });

      expect(alertMock).toHaveBeenCalledWith('Workflow error: Some random error message');
    });
  });

  describe('Scheduling (Phase 7)', () => {
    const toLocalDateTimeInputValue = (date: Date) => {
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 16);
    };

    const openScheduleModal = async (container: HTMLElement) => {
      await act(async () => {
        fireEvent.click(screen.getByText('Schedule...'));
      });
      const input = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      expect(input).not.toBeNull();
      return input;
    };

    it('APPROVED shows Schedule... for a user with article.schedule', () => {
      renderPanel(ArticleStatus.APPROVED);
      expect(screen.getByText('Schedule...')).toBeInTheDocument();
    });

    it('APPROVED hides Schedule... without article.schedule permission', () => {
      (useSession as jest.Mock).mockReturnValue({
        permissions: ['article.publish'],
        user: { id: 'reviewer-1' },
      });
      renderPanel(ArticleStatus.APPROVED);
      expect(screen.queryByText('Schedule...')).not.toBeInTheDocument();
    });

    it('opens the schedule modal and submits a valid future date', async () => {
      const future = new Date(Date.now() + 10 * 60000);
      future.setSeconds(0, 0);

      const { container } = renderPanel(ArticleStatus.APPROVED);
      const input = await openScheduleModal(container);

      await act(async () => {
        fireEvent.change(input, { target: { value: toLocalDateTimeInputValue(future) } });
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Confirm Schedule'));
      });

      expect(mockPost).toHaveBeenCalledWith('/v1/articles/123/schedule', {
        expectedVersion: 5,
        scheduledFor: future.toISOString(),
      });
    });

    it('rejects a non-future date client-side without calling the API', async () => {
      const past = new Date(Date.now() - 10 * 60000);

      const { container } = renderPanel(ArticleStatus.APPROVED);
      const input = await openScheduleModal(container);

      await act(async () => {
        fireEvent.change(input, { target: { value: toLocalDateTimeInputValue(past) } });
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Confirm Schedule'));
      });

      expect(alertMock).toHaveBeenCalledWith('Please select a valid future date/time.');
      expect(mockPost).not.toHaveBeenCalled();
      expect(screen.getByText('Confirm Schedule')).toBeInTheDocument();
    });

    it('surfaces backend validation errors for a schedule the server rejects', async () => {
      const future = new Date(Date.now() + 2 * 60000);
      future.setSeconds(0, 0);

      const { container } = renderPanel(ArticleStatus.APPROVED);
      const input = await openScheduleModal(container);

      mockPost.mockRejectedValueOnce(
        new CmsApiError(
          400,
          'scheduledFor must be at least 5 minutes in the future',
          'BAD_REQUEST',
        ),
      );

      await act(async () => {
        fireEvent.change(input, { target: { value: toLocalDateTimeInputValue(future) } });
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Confirm Schedule'));
      });

      expect(alertMock).toHaveBeenCalledWith(
        'Workflow error: scheduledFor must be at least 5 minutes in the future',
      );
    });

    it('FAILED_TO_PUBLISH shows Reopen as Draft and invokes the reopen workflow', async () => {
      renderPanel(ArticleStatus.FAILED_TO_PUBLISH);
      expect(screen.getByText('Reopen as Draft')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByText('Reopen as Draft'));
      });

      expect(mockPost).toHaveBeenCalledWith('/v1/articles/123/reopen', {
        expectedVersion: 5,
      });
    });
  });
});
