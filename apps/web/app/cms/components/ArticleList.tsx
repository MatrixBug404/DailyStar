'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useCmsApi } from '../../../lib/cms-api';
import { PaginatedResponse, ArticleSummary, ArticleStatus } from '@dailystar/types';
import { Button } from './ui/Button';
import { useSession } from '../session-provider';

interface ArticleListProps {
  fixedStatusFilter?: ArticleStatus[];
  title: string;
}

export function ArticleList({ fixedStatusFilter, title }: ArticleListProps) {
  const { get } = useCmsApi();
  const { permissions } = useSession();
  const [data, setData] = useState<PaginatedResponse<ArticleSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters state
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [statusFilter, setStatusFilter] = useState<ArticleStatus[]>(fixedStatusFilter || []);
  const [categoryId, setCategoryId] = useState('');
  const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt' | 'title'>('updatedAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  // Categories
  const [categories, setCategories] = useState<{id: string, name: string}[]>([]);

  const fetchCategories = useCallback(async () => {
    try {
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
  }, [get, permissions]);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        sortBy,
        order,
      });
      if (statusFilter.length > 0) {
        params.set('status', statusFilter.join(','));
      }
      if (categoryId) {
        params.set('categoryId', categoryId);
      }
      const result = await get<PaginatedResponse<ArticleSummary>>(`/v1/articles?${params.toString()}`);
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load articles');
    } finally {
      setLoading(false);
    }
  }, [get, page, limit, statusFilter, categoryId, sortBy, order]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{title}</h1>
        {!fixedStatusFilter && (
          <Link href="/cms/articles/new">
            <Button>New Article</Button>
          </Link>
        )}
      </div>

      {!fixedStatusFilter && (
        <div className="bg-gray-50 p-4 rounded flex flex-wrap gap-4 items-end border">
          <div>
            <label htmlFor="statusFilter" className="block text-sm font-medium mb-1">Status</label>
            <select
              id="statusFilter"
              multiple
              className="border rounded px-2 py-1 h-20 w-48 text-sm"
              value={statusFilter}
              onChange={(e) => {
                const values = Array.from(e.target.selectedOptions, option => option.value as ArticleStatus);
                setStatusFilter(values);
                setPage(1);
              }}
            >
              {Object.values(ArticleStatus).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="categoryFilter" className="block text-sm font-medium mb-1">Category</label>
            <select
              id="categoryFilter"
              className="border rounded px-2 py-1 text-sm h-10 w-48"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Categories</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sortByFilter" className="block text-sm font-medium mb-1">Sort By</label>
            <select
              id="sortByFilter"
              className="border rounded px-2 py-1 text-sm"
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value as any); setPage(1); }}
            >
              <option value="updatedAt">Updated At</option>
              <option value="createdAt">Created At</option>
              <option value="title">Title</option>
            </select>
          </div>
          <div>
            <label htmlFor="orderFilter" className="block text-sm font-medium mb-1">Order</label>
            <select
              id="orderFilter"
              className="border rounded px-2 py-1 text-sm"
              value={order}
              onChange={(e) => { setOrder(e.target.value as any); setPage(1); }}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded">
          {error}
        </div>
      )}

      {loading && !data ? (
        <p>Loading articles...</p>
      ) : (
        <>
          <div className="bg-white border rounded shadow-sm overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Title</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Updated</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data?.data.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-500 bg-gray-50 rounded-b">
                      <div className="flex flex-col items-center">
                        <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9.5L18.5 6M13 6v4a1 1 0 001 1h4m-5 8h.01M10 17h.01M7 17h.01M10 13h.01M7 13h.01" />
                        </svg>
                        <p className="text-lg font-medium text-gray-900 mb-1">No articles found</p>
                        <p className="text-sm text-gray-500 max-w-sm text-center">
                          {statusFilter.length > 0 || categoryId ? 'Try adjusting your filters to find what you are looking for.' : 'Get started by creating your first article.'}
                        </p>
                        {(!statusFilter.length && !categoryId) && (
                          <Link href="/cms/articles/new" className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700">
                            Create Article
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  data?.data.map(article => (
                    <tr key={article.id}>
                      <td className="px-6 py-4 whitespace-nowrap overflow-hidden text-ellipsis max-w-md">
                        {article.currentRevision?.title || 'Untitled'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                          {article.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                        {new Date(article.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-medium">
                        <Link href={`/cms/articles/${article.id}`} className="text-blue-600 hover:text-blue-900">
                          View/Edit
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {data && data.total > 0 && (
            <div className="flex justify-between items-center mt-4">
              <p className="text-sm text-gray-700">
                Showing <span className="font-medium">{(data.page - 1) * data.limit + 1}</span> to <span className="font-medium">{Math.min(data.page * data.limit, data.total)}</span> of <span className="font-medium">{data.total}</span> results
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={data.page === 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={data.page * data.limit >= data.total}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
