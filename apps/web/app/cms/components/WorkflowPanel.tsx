'use client';

import React, { useState } from 'react';
import { useCmsApi, CmsApiError } from '../../../lib/cms-api';
import { Article, ArticleStatus } from '@dailystar/types';
import { Button } from './ui/Button';
import { useSession } from '../session-provider';
import { Modal } from './ui/Modal';

interface WorkflowPanelProps {
  article: Article;
  onSuccess: () => void;
}

export function WorkflowPanel({ article, onSuccess }: WorkflowPanelProps) {
  const { post } = useCmsApi();
  const { permissions, user } = useSession();

  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [actionWithComment, setActionWithComment] = useState<string>('');
  const [commentText, setCommentText] = useState('');

  const handleAction = async (action: string, payload: any = {}) => {
    try {
      await post(`/v1/articles/${article.id}/${action}`, { expectedVersion: article.version, ...payload });
      onSuccess();
    } catch (err: any) {
      if (err instanceof CmsApiError) {
        if (err.code === 'FOUR_EYES_VIOLATION' || err.message === 'FOUR_EYES_VIOLATION') {
          alert('You cannot approve your own article (INV6-03).');
        } else if (err.code === 'VERSION_MISMATCH' || err.message === 'VERSION_MISMATCH') {
          alert('Article changed elsewhere — reload to see latest version (INV6-04).');
        } else if (err.code === 'UNAUTHORIZED_WORKFLOW_ACTION' || err.message === 'UNAUTHORIZED_WORKFLOW_ACTION') {
          alert('You do not have permission for this workflow action.');
        } else {
          alert(`Workflow error: ${err.message}`);
        }
      } else {
        alert(err.message || 'Workflow action failed');
      }
    }
  };

  const actions = [];

  if (article.status === ArticleStatus.DRAFT) {
    actions.push(
      <Button key="submit" onClick={() => handleAction('submit-review')} className="mr-2">
        Submit for Review
      </Button>
    );
  }

  if (article.status === ArticleStatus.SUBMITTED_FOR_REVIEW) {
    if (permissions.includes('article.start-review')) {
      actions.push(
        <Button key="start_review" onClick={() => handleAction('start-review')} className="mr-2">
          Start Review
        </Button>
      );
    }
  }

  if (article.status === ArticleStatus.UNDER_REVIEW) {
    if (permissions.includes('article.approve') && user?.id !== article.primaryAuthorId) {
      actions.push(
        <Button key="approve" onClick={() => handleAction('approve')} className="mr-2" variant="primary">
          Approve
        </Button>
      );
    }
    
    if (permissions.includes('article.request-changes')) {
      actions.push(
        <Button key="request-changes" onClick={() => {
          setActionWithComment('request-changes');
          setCommentText('');
          setCommentModalOpen(true);
        }} className="mr-2" variant="secondary">
          Request Changes
        </Button>
      );
    }

    if (permissions.includes('article.reject')) {
      actions.push(
        <Button key="reject" onClick={() => {
          setActionWithComment('reject');
          setCommentText('');
          setCommentModalOpen(true);
        }} className="mr-2" variant="danger">
          Reject
        </Button>
      );
    }
  }

  if (article.status === ArticleStatus.APPROVED) {
    if (permissions.includes('article.publish')) {
      actions.push(
        <Button key="publish" onClick={() => handleAction('publish')} className="mr-2" variant="primary">
          Publish Now
        </Button>
      );
    }
  }

  if (article.status === ArticleStatus.SCHEDULED) {
    if (permissions.includes('article.cancel-schedule')) {
      actions.push(
        <Button key="cancel-schedule" onClick={() => handleAction('cancel-schedule')} className="mr-2" variant="danger">
          Cancel Schedule
        </Button>
      );
    }
  }

  if (article.status === ArticleStatus.PUBLISHED) {
    if (permissions.includes('article.archive')) {
      actions.push(
        <Button key="archive" onClick={() => handleAction('archive')} variant="danger">
          Archive
        </Button>
      );
    }
  }

  if (article.status === ArticleStatus.ARCHIVED) {
    // There is no restore endpoint in workflow.controller.ts, maybe it's just a placeholder or requires different setup
    // But let's leave it out since it's not defined in the backend API provided.
  }

  if (actions.length === 0) {
    return null;
  }

  return (
    <>
      <div className="bg-gray-50 border rounded p-4 mb-6 flex flex-wrap gap-2 items-center">
        <span className="font-semibold text-sm text-gray-700 mr-2">Workflow Actions:</span>
        {actions}
      </div>

      <Modal isOpen={commentModalOpen} onClose={() => setCommentModalOpen(false)} title={`Provide Comment for ${actionWithComment.replace('-', ' ')}`}>
        <div className="py-4">
          <textarea
            className="w-full border rounded px-4 py-2"
            rows={4}
            maxLength={1000}
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            placeholder="Why are you making this decision?"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCommentModalOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={!commentText.trim()} onClick={() => {
            const trimmed = commentText.trim();
            if (!trimmed) {
              alert('Comment is required and cannot be empty.');
              return;
            }
            setCommentModalOpen(false);
            handleAction(actionWithComment, { comment: trimmed });
          }}>
            Confirm
          </Button>
        </div>
      </Modal>
    </>
  );
}
