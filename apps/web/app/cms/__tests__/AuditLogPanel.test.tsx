import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuditLogPanel } from '../components/AuditLogPanel';
import { useCmsApi } from '../../../lib/cms-api';
import { useSession } from '../session-provider';

jest.mock('../../../lib/cms-api');
jest.mock('../session-provider');

describe('AuditLogPanel', () => {
  const mockGet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useCmsApi as jest.Mock).mockReturnValue({
      get: mockGet,
    });
  });

  it('prevents GET and UI rendering without article.read.any', async () => {
    (useSession as jest.Mock).mockReturnValue({
      permissions: [],
    });

    await act(async () => {
      render(<AuditLogPanel articleId="123" />);
    });

    expect(screen.getByText('You do not have permission to view the audit log for this article.')).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('makes request and renders entries with article.read.any', async () => {
    (useSession as jest.Mock).mockReturnValue({
      permissions: ['article.read.any'],
    });

    mockGet.mockResolvedValueOnce([
      { id: 'log-1', createdAt: new Date().toISOString(), actorId: 'user-1', action: 'UPDATE_ARTICLE', metadata: { foo: 'bar' } }
    ]);

    await act(async () => {
      render(<AuditLogPanel articleId="123" />);
    });

    expect(mockGet).toHaveBeenCalledWith('/v1/articles/123/audit');
    expect(screen.getByText('UPDATE_ARTICLE')).toBeInTheDocument();
    expect(screen.getByText('user-1')).toBeInTheDocument();
    expect(screen.getByText('{"foo":"bar"}')).toBeInTheDocument();
  });
});
