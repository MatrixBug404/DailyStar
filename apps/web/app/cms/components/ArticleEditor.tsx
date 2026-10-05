'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCmsApi, CmsApiError } from '../../../lib/cms-api';
import { Article, ArticleStatus } from '@dailystar/types';
import { Button } from './ui/Button';
import { WorkflowPanel } from './WorkflowPanel';
import { CoverPicker } from './CoverPicker';
import { RevisionHistory } from './RevisionHistory';
import { AuditLogPanel } from './AuditLogPanel';
import { useSession } from '../session-provider';
import { Modal } from './ui/Modal';

export function ArticleEditor({ articleId }: { articleId: string }) {
  const isNew = articleId === 'new';
  const router = useRouter();
  const { get, post, patch } = useCmsApi();
  const { permissions, user } = useSession();

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  
  // Form state
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [categoryId, setCategoryId] = useState('');
  
  // Categories for select
  const [categories, setCategories] = useState<{id: string, name: string}[]>([]);

  const fetchArticle = useCallback(async () => {
    if (isNew) return;
    try {
      setLoading(true);
      const data = await get<Article>(`/v1/articles/${articleId}`);
      setArticle(data);
      setTitle(data.currentRevision?.title || '');
      setBody(data.currentRevision?.body || '');
      setExcerpt(data.currentRevision?.excerpt || '');
      setTagsInput(data.tags?.map((t: any) => t.tag.name).join(', ') || '');
      setCategoryId(data.categoryId || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load article');
    } finally {
      setLoading(false);
    }
  }, [articleId, isNew, get]);

  const fetchCategories = useCallback(async () => {
    try {
      // Just fetch all and flatten for simplicity
      const fetchFlattened = async (url: string): Promise<{id: string, name: string}[]> => {
        const cats = await get<any[]>(url);
        const flatten = (items: any[]): {id: string, name: string}[] => {
          return items.reduce((acc, c) => {
            acc.push({ id: c.id, name: c.name });
            if (c.children) acc.push(...flatten(c.children));
            return acc;
          }, [] as {id: string, name: string}[]);
        };
        return flatten(cats);
      };
      if (permissions.includes('category.read') || permissions.includes('category.manage')) {
        setCategories(await fetchFlattened('/v1/categories'));
      }
    } catch (e) {
      console.error('Failed to load categories', e);
    }
  }, [get]);

  useEffect(() => {
    fetchCategories();
    fetchArticle();
  }, [fetchCategories, fetchArticle]);

  const executeSave = async () => {
    try {
      setSaving(true);
      setError('');
      
      const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);

      if (isNew) {
        const payload = {
          title: title.trim(),
          body,
          excerpt: excerpt.trim() || undefined,
          categoryId: categoryId || undefined,
          tags: tags.length > 0 ? tags : undefined,
        };
        const created = await post<Article>('/v1/articles', payload);
        router.push(`/cms/articles/${created.id}`);
      } else {
        const payload = {
          title: title.trim(),
          body,
          excerpt: excerpt.trim() || undefined,
          categoryId: categoryId || undefined,
          tags: tags.length > 0 ? tags : undefined,
          expectedVersion: article?.version,
        };
        await patch(`/v1/articles/${articleId}`, payload);
        setConfirmModalOpen(false);
        await fetchArticle();
        alert('Article saved successfully');
      }
    } catch (err: any) {
      setConfirmModalOpen(false);
      if (err instanceof CmsApiError) {
        if (err.code === 'VERSION_MISMATCH' || err.code === 'CONCURRENCY_CONFLICT' || err.message === 'CONCURRENCY_CONFLICT') {
          setError('Article changed elsewhere — reload to see latest version (INV6-04).');
        } else if (err.code === 'VERSION_REQUIRED' || err.message === 'VERSION_REQUIRED') {
          setError('Version required to update this article.');
        } else {
          setError(`Error: ${err.message}`);
        }
      } else {
        setError(err.message || 'Failed to save article');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3 || title.trim().length > 150) {
      setError('Title must be between 3 and 150 characters.');
      return;
    }
    if (!body.trim()) {
      setError('Body cannot be empty.');
      return;
    }
    if (excerpt.length > 500) {
      setError('Excerpt must be at most 500 characters.');
      return;
    }
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    if (tags.length > 10) {
      setError('Maximum 10 tags allowed.');
      return;
    }

    if (showEditWarning) {
      setConfirmModalOpen(true);
    } else {
      executeSave();
    }
  };

  const isReview = !!(article && [
    ArticleStatus.SUBMITTED_FOR_REVIEW,
    ArticleStatus.UNDER_REVIEW
  ].includes(article.status));
  
  const isPublishedOrArchived = !!(article && [
    ArticleStatus.PUBLISHED,
    ArticleStatus.ARCHIVED
  ].includes(article.status));
  
  const showEditWarning = article && [ArticleStatus.APPROVED, ArticleStatus.SCHEDULED].includes(article.status);

  if (loading) return <div className="p-4">Loading article...</div>;

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{isNew ? 'New Article' : `Edit Article: ${title || article?.id}`}</h1>
        {!isNew && article && (
          <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
            article.status === ArticleStatus.PUBLISHED ? 'bg-green-100 text-green-800' :
            article.status === ArticleStatus.DRAFT ? 'bg-gray-100 text-gray-800' :
            'bg-blue-100 text-blue-800'
          }`}>
            {article.status} (v{article.version})
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded mb-6 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {!!showEditWarning && (
        <div className="bg-yellow-50 text-yellow-800 p-4 rounded mb-6">
          <strong>Warning:</strong> You are editing an {article?.status} article. Saving changes or updating the cover will revert this article to Draft status.
        </div>
      )}

      {!isNew && article && (
        <WorkflowPanel 
          article={article}
          onSuccess={fetchArticle}
        />
      )}

      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1">
          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label htmlFor="article-title" className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                id="article-title"
                required
                type="text"
                className="w-full border rounded px-4 py-2"
                value={title}
                onChange={e => setTitle(e.target.value)}
                disabled={isReview || isPublishedOrArchived}
              />
            </div>
            
            <div>
              <label htmlFor="article-excerpt" className="block text-sm font-medium text-gray-700 mb-1">Excerpt</label>
              <textarea
                id="article-excerpt"
                rows={3}
                className="w-full border rounded px-4 py-2 text-sm"
                value={excerpt}
                onChange={e => setExcerpt(e.target.value)}
                disabled={isReview || isPublishedOrArchived}
              />
            </div>

            <div>
              <label htmlFor="article-category" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                id="article-category"
                className="w-full border rounded px-4 py-2"
                value={categoryId}
                onChange={e => setCategoryId(e.target.value)}
                disabled={isReview || isPublishedOrArchived}
              >
                <option value="">No Category</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="article-tags" className="block text-sm font-medium text-gray-700 mb-1">Tags (comma-separated)</label>
              <input
                id="article-tags"
                type="text"
                className="w-full border rounded px-4 py-2 text-sm"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                disabled={isReview || isPublishedOrArchived}
              />
            </div>

            <div>
              <label htmlFor="article-body" className="block text-sm font-medium text-gray-700 mb-1">Body (Markdown)</label>
              <textarea
                id="article-body"
                required
                rows={15}
                className="w-full border rounded px-4 py-2 font-mono text-sm"
                value={body}
                onChange={e => setBody(e.target.value)}
                disabled={isReview || isPublishedOrArchived}
                placeholder="# Heading 1&#10;&#10;Write your markdown content here..."
              />
            </div>

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={saving || isReview || isPublishedOrArchived}>
                {saving ? 'Saving...' : 'Save Article'}
              </Button>
            </div>
          </form>
        </div>

        <div className="w-full md:w-80 space-y-6">
          {!isNew && article && (
            <CoverPicker 
              articleId={articleId}
              expectedVersion={article.version}
              currentCoverId={article.coverMediaId}
              onCoverChange={() => fetchArticle()}
              status={article.status}
              userPermissions={permissions}
              showEditWarning={!!showEditWarning}
            />
          )}

          {!isNew && (
            <>
              <RevisionHistory articleId={articleId} />
              {permissions.includes('article.read.any') && (
                <div className="mt-6">
                  <h3 className="font-semibold text-lg mb-2">Audit Log</h3>
                  <AuditLogPanel articleId={articleId} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Modal isOpen={confirmModalOpen} onClose={() => setConfirmModalOpen(false)} title="Confirm Changes">
        <div className="py-4">
          <p className="mb-4">Saving changes will revert this article to <strong>Draft</strong> status.</p>
          {article?.status === ArticleStatus.SCHEDULED && (
            <p className="mb-4 text-red-600 font-medium">Its scheduled publication will be cancelled.</p>
          )}
          <p>Are you sure you want to proceed?</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmModalOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={executeSave} disabled={saving}>
            {saving ? 'Saving...' : 'Yes, Save Changes'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
