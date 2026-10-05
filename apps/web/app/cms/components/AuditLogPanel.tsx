'use client';

import React, { useState, useEffect } from 'react';
import { useCmsApi } from '../../../lib/cms-api';
import { useSession } from '../session-provider';

export function AuditLogPanel({ articleId }: { articleId: string }) {
  const { get } = useCmsApi();
  const { permissions } = useSession();
  const canReadAudit = permissions.includes('article.read.any');

  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canReadAudit) return;

    let isMounted = true;
    setLoading(true);
    get<any[]>(`/v1/articles/${articleId}/audit`)
      .then(data => {
        if (isMounted) setLogs(data);
      })
      .catch(err => {
        if (isMounted) setError(err.message || 'Failed to load audit logs');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [articleId, canReadAudit, get]);

  if (!canReadAudit) {
    return (
      <div className="p-4 bg-gray-50 border rounded text-gray-600">
        You do not have permission to view the audit log for this article.
      </div>
    );
  }

  if (loading) return <p>Loading audit logs...</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (logs.length === 0) return <p className="text-gray-500">No audit logs found.</p>;

  return (
    <div className="bg-white border rounded shadow-sm overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase">Timestamp</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase">Actor</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase">Action</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase">Metadata</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {logs.map(log => (
            <tr key={log.id}>
              <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                {new Date(log.createdAt).toLocaleString()}
              </td>
              <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-gray-600">
                {log.actorId || 'System'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="px-2 py-1 rounded bg-blue-50 text-blue-700 font-medium">
                  {log.action}
                </span>
              </td>
              <td className="px-6 py-4 text-xs font-mono text-gray-500 max-w-md truncate">
                {log.metadata ? JSON.stringify(log.metadata) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
