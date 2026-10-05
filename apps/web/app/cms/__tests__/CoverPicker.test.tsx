import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CoverPicker } from '../components/CoverPicker';
import { useCmsApi } from '../../../lib/cms-api';
import { ArticleStatus } from '@dailystar/types';

jest.mock('../../../lib/cms-api');

describe('CoverPicker', () => {
  const mockGet = jest.fn();
  const mockPatch = jest.fn();
  const mockPost = jest.fn();
  const onCoverChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useCmsApi as jest.Mock).mockReturnValue({
      get: mockGet,
      patch: mockPatch,
      post: mockPost,
    });
    mockGet.mockResolvedValue({ data: [] });
  });

  const renderComponent = async (props: any) => {
    let result;
    await act(async () => {
      result = render(<CoverPicker articleId="123" expectedVersion={1} currentCoverId={null} onCoverChange={onCoverChange} {...props} />);
    });
    return result;
  };

  it('blocks author during SUBMITTED_FOR_REVIEW', async () => {
    await renderComponent({ status: ArticleStatus.SUBMITTED_FOR_REVIEW, userPermissions: [], showEditWarning: false });
    expect(screen.getByText('Set Cover')).toBeDisabled();
  });

  it('blocks author during UNDER_REVIEW', async () => {
    await renderComponent({ status: ArticleStatus.UNDER_REVIEW, userPermissions: [], showEditWarning: false });
    expect(screen.getByText('Set Cover')).toBeDisabled();
  });

  it('allows article.update.any user during review', async () => {
    await renderComponent({ status: ArticleStatus.UNDER_REVIEW, userPermissions: ['article.update.any'], showEditWarning: false });
    expect(screen.getByText('Set Cover')).not.toBeDisabled();
  });

  it('triggers warning before mutation for APPROVED', async () => {
    await renderComponent({ status: ArticleStatus.APPROVED, userPermissions: [], showEditWarning: true });
    
    await act(async () => {
      fireEvent.click(screen.getByText('Set Cover'));
    });
    
    // Simulate setting cover
    mockGet.mockResolvedValue({ data: [{ id: 'media-1', originalFilename: 'test.jpg' }] });
    await act(async () => {
      // open modal
    });
    // This is tested via the mock implementation and the warning trigger
    // Instead of full integration, we'll verify the component responds to showEditWarning
    
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    
    mockPost.mockResolvedValue({ id: 'new-media-1' });

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText('Confirm Changes')).toBeInTheDocument();
      expect(screen.getByText(/Changing the cover will revert this article/)).toBeInTheDocument();
    });
  });

  it('triggers warning before mutation for SCHEDULED', async () => {
    await renderComponent({ status: ArticleStatus.SCHEDULED, userPermissions: [], showEditWarning: true });
    
    await act(async () => {
      fireEvent.click(screen.getByText('Set Cover'));
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    
    mockPost.mockResolvedValue({ id: 'new-media-1' });

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText('Confirm Changes')).toBeInTheDocument();
      expect(screen.getByText(/scheduled publication will be cancelled/)).toBeInTheDocument();
    });
  });

  it('disables for PUBLISHED', async () => {
    await renderComponent({ status: ArticleStatus.PUBLISHED, userPermissions: ['article.update.any'], showEditWarning: false });
    expect(screen.getByText('Set Cover')).toBeDisabled();
  });

  it('disables for ARCHIVED', async () => {
    await renderComponent({ status: ArticleStatus.ARCHIVED, userPermissions: ['article.update.any'], showEditWarning: false });
    expect(screen.getByText('Set Cover')).toBeDisabled();
  });

  it('sends expectedVersion on mutation', async () => {
    await renderComponent({ status: ArticleStatus.DRAFT, userPermissions: [], showEditWarning: false });
    
    await act(async () => {
      fireEvent.click(screen.getByText('Set Cover'));
    });
    
    mockGet.mockResolvedValueOnce({ data: [{ id: 'media-1', originalFilename: 'test.jpg' }] });
    
    // Simulate picking an existing media
    // Mock the fetchMedia resolution
    await act(async () => {
      // Just simulate clicking the select button on media-1 when it appears
    });
    
    // Test direct upload flow for simplicity of asserting patch
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    mockPost.mockResolvedValue({ id: 'new-media-1' });

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/v1/media', expect.any(FormData));
    });

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/v1/articles/123/cover', {
        mediaId: 'new-media-1',
        expectedVersion: 1
      });
    });
  });

  it('handles error gracefully', async () => {
    const alertMock = jest.spyOn(window, 'alert').mockImplementation(() => {});
    
    await renderComponent({ status: ArticleStatus.DRAFT, userPermissions: [], showEditWarning: false });
    
    await act(async () => {
      fireEvent.click(screen.getByText('Set Cover'));
    });
    
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    mockPost.mockRejectedValue(new Error('Upload failed'));

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('Upload failed');
    });

    alertMock.mockRestore();
  });
});
