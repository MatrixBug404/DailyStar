'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '../session-provider';

/**
 * Protected Layout (D7).
 * Implements the client-side redirect-if-unauthenticated logic.
 */
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status, logout } = useSession();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/cms/login');
    }
  }, [status, router]);

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <p>Loading CMS...</p>
      </div>
    );
  }

  return (
    <div className="cms-protected-layout">
      <nav className="p-4 bg-gray-100 border-b flex justify-between items-center">
        <span className="font-semibold">DailyStar CMS (Protected)</span>
        <button
          onClick={() => logout()}
          className="text-sm text-gray-600 hover:text-black"
        >
          Logout
        </button>
      </nav>
      <div className="p-8">{children}</div>
    </div>
  );
}
