import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WorkflowPanel } from '../components/WorkflowPanel';
import { useCmsApi } from '../../../lib/cms-api';
import { useSession } from '../session-provider';
import { ArticleStatus } from '@dailystar/types';

jest.mock('../../../lib/cms-api');
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
        'article.archive'
      ],
      user: { id: 'reviewer-1' }
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
      primaryAuthorId: authorId
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
      user: { id: 'author-1' } // Same as primaryAuthorId
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
    expect(mockPost).toHaveBeenCalledWith('/v1/articles/123/cancel-schedule', { expectedVersion: 5 });
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

    const input = screen.getByPlaceholderText('Why are you making this decision?') as HTMLTextAreaElement;
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
      comment: 'Needs more detail'
    });
  });

  it('reject comment modal enforces validation', async () => {
    renderPanel(ArticleStatus.UNDER_REVIEW);

    await act(async () => {
      fireEvent.click(screen.getByText('Reject'));
    });

    const input = screen.getByPlaceholderText('Why are you making this decision?') as HTMLTextAreaElement;
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
      comment: 'Too controversial'
    });
  });
});
