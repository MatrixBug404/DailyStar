'use client';

import React, { useState, useEffect } from 'react';
import { useCmsApi } from '../../../lib/cms-api';

export function RevisionHistory({ articleId }: { articleId: string }) {
  const { get } = useCmsApi();
  const [revisions, setRevisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    get<any[]>(`/v1/articles/${articleId}/revisions`)
      .then(data => {
        if (isMounted) setRevisions(data);
      })
      .catch(err => {
        if (isMounted) setError(err.message || 'Failed to load revisions');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
      
    return () => { isMounted = false; };
  }, [articleId, get]);

  if (loading) return <p>Loading revisions...</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (revisions.length === 0) return <p className="text-gray-500">No revisions found.</p>;

  return (
    <div className="bg-white border rounded shadow-sm overflow-hidden mt-4">
      <h3 className="px-6 py-4 font-semibold text-lg border-b">Revision History</h3>
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase">Version</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase">Timestamp</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase">Author</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {revisions.map(rev => (
            <tr key={rev.id}>
              <td className="px-6 py-4 whitespace-nowrap font-medium">v{rev.revisionNumber}</td>
              <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                {new Date(rev.createdAt).toLocaleString()}
              </td>
              <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-gray-600">
                {rev.authorId}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
