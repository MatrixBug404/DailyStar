import React from 'react';

/**
 * Protected Layout placeholder for D6.
 * D7 will add the actual client-side redirect-if-unauthenticated logic.
 */
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cms-protected-layout">
      {/* Navigation scaffolding could go here */}
      <nav className="p-4 bg-gray-100 border-b">
        <span className="font-semibold">DailyStar CMS (Protected)</span>
      </nav>
      <div className="p-8">{children}</div>
    </div>
  );
}
