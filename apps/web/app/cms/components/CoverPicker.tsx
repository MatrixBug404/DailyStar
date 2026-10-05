'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useCmsApi, CmsApiError } from '../../../lib/cms-api';
import { MediaSummary, ArticleStatus } from '@dailystar/types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

interface CoverPickerProps {
  articleId: string;
  expectedVersion: number;
  currentCoverId: string | null;
  onCoverChange: (newCoverId: string | null) => void;
  status: ArticleStatus;
  userPermissions: string[];
  showEditWarning: boolean | null | undefined;
}

export function CoverPicker({ articleId, expectedVersion, currentCoverId, onCoverChange, status, userPermissions, showEditWarning }: CoverPickerProps) {
  const { get, patch, post } = useCmsApi();
  const [modalOpen, setModalOpen] = useState(false);
  const [mediaList, setMediaList] = useState<MediaSummary[]>([]);
  const [currentCoverUrl, setCurrentCoverUrl] = useState<string | null>(null);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [pendingMediaId, setPendingMediaId] = useState<string | null | undefined>(undefined);
  
  const fetchCurrentCover = useCallback(async () => {
    if (!currentCoverId) {
      setCurrentCoverUrl(null);
      return;
    }
    try {
      const result = await get<{ signedUrl: string | null }>(`/v1/articles/${articleId}/cover`);
      setCurrentCoverUrl(result.signedUrl);
    } catch (err) {
      console.error('Failed to load current cover', err);
    }
  }, [articleId, currentCoverId, get]);

  useEffect(() => {
    fetchCurrentCover();
  }, [fetchCurrentCover]);

  const fetchMedia = async () => {
    try {
      setLoadingMedia(true);
      const result = await get<{ data: MediaSummary[] }>('/v1/media?limit=100');
      setMediaList(result.data);
    } catch (err) {
      alert('Failed to load media');
    } finally {
      setLoadingMedia(false);
    }
  };

  const handleOpenModal = () => {
    setModalOpen(true);
    fetchMedia();
  };

  const executeSetCover = async (mediaId: string | null) => {
    try {
      await patch(`/v1/articles/${articleId}/cover`, {
        mediaId,
        expectedVersion
      });
      onCoverChange(mediaId);
      setModalOpen(false);
    } catch (err: any) {
      if (err instanceof CmsApiError) {
        if (err.code === 'ARTICLE_COVER_IMMUTABLE') {
          alert('Cannot change cover: Article is published or archived.');
        } else if (err.code === 'COVER_MUTATION_NOT_PERMITTED') {
          alert('Cannot change cover while article is in review.');
        } else if (err.code === 'VERSION_MISMATCH') {
          alert('This article was changed elsewhere — reload to see latest version');
        } else {
          alert(`Error: ${err.message}`);
        }
      } else {
        alert(err.message || 'Failed to update cover');
      }
    }
  };

  const handleSetCover = (mediaId: string | null) => {
    if (showEditWarning) {
      setPendingMediaId(mediaId);
      setConfirmModalOpen(true);
    } else {
      executeSetCover(mediaId);
    }
  };

  const handleConfirmCover = () => {
    setConfirmModalOpen(false);
    if (pendingMediaId !== undefined) {
      executeSetCover(pendingMediaId);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const uploaded = await post<MediaSummary>('/v1/media', formData);
      if (showEditWarning) {
        setPendingMediaId(uploaded.id);
        setConfirmModalOpen(true);
      } else {
        await executeSetCover(uploaded.id);
      }
    } catch (err: any) {
      if (err instanceof CmsApiError && err.code === 'FILE_TOO_LARGE') {
        alert('File is too large.');
      } else {
        alert(err.message || 'Upload failed');
      }
    }
  };

  const isReview = [ArticleStatus.SUBMITTED_FOR_REVIEW, ArticleStatus.UNDER_REVIEW].includes(status);
  const isPublishedOrArchived = [ArticleStatus.PUBLISHED, ArticleStatus.ARCHIVED].includes(status);
  const isDisabled = isPublishedOrArchived || (isReview && !userPermissions.includes('article.update.any'));

  return (
    <div className="border p-4 rounded mb-6">
      <h3 className="font-semibold mb-4">Article Cover</h3>
      {currentCoverUrl ? (
        <div className="mb-4">
          <img src={currentCoverUrl} alt="Cover" className="w-full max-w-sm rounded object-cover h-48" />
        </div>
      ) : (
        <p className="text-gray-500 mb-4 text-sm">No cover image set.</p>
      )}
      
      <div className="flex gap-2">
        <Button onClick={handleOpenModal} disabled={isDisabled} size="sm">
          {currentCoverId ? 'Change Cover' : 'Set Cover'}
        </Button>
        {currentCoverId && (
          <Button onClick={() => handleSetCover(null)} variant="danger" disabled={isDisabled} size="sm">
            Remove Cover
          </Button>
        )}
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Select Cover Image">
        <div className="mb-6">
          <h4 className="text-sm font-medium mb-2">Upload New</h4>
          <input type="file" accept="image/*" onChange={handleUpload} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
        </div>
        
        <h4 className="text-sm font-medium mb-2">Or Choose from Your Uploaded Media</h4>
        {loadingMedia ? (
          <p>Loading...</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {mediaList.map(media => (
              <div key={media.id} className="border rounded p-2 flex flex-col items-center">
                <span className="text-xs text-gray-500 truncate w-full text-center mb-2">{media.originalFilename}</span>
                <Button size="sm" onClick={() => handleSetCover(media.id)}>Select</Button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal isOpen={confirmModalOpen} onClose={() => setConfirmModalOpen(false)} title="Confirm Changes">
        <div className="py-4">
          <p className="mb-4">Changing the cover will revert this article to <strong>Draft</strong> status.</p>
          {status === ArticleStatus.SCHEDULED && (
            <p className="mb-4 text-red-600 font-medium">Its scheduled publication will be cancelled.</p>
          )}
          <p>Are you sure you want to proceed?</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmModalOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleConfirmCover}>Yes, Change Cover</Button>
        </div>
      </Modal>
    </div>
  );
}
