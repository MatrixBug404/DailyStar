import React from 'react';
import { SessionProvider } from './session-provider';

/**
 * Non-gating CMS layout (D6 placeholder).
 * Mounts SessionProvider but does not redirect.
 * Must NOT render <html> or <body> tags.
 */
export default function CmsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cms-root-layout">
      <SessionProvider>{children}</SessionProvider>
    </div>
  );
}
