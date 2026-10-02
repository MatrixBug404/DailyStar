import React from 'react';

/**
 * Ungated CMS Login placeholder (D6).
 * Placed outside (protected) to prevent redirect loops.
 * Real auth functionality belongs to D7.
 */
export default function CmsLoginPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">CMS Login</h1>
      <p>Please log in to continue (Placeholder for D6).</p>
    </main>
  );
}
