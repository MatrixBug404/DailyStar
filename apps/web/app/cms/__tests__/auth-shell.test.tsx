import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import ProtectedLayout from '../(protected)/layout';
import CmsLoginPage from '../login/page';
import { SessionProvider, useSession } from '../session-provider';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    replace: jest.fn(),
  })),
}));

// Mock the API calls in the session provider tests if needed, but for layout tests 
// we will just mock useSession.
jest.mock('../session-provider', () => {
  const original = jest.requireActual('../session-provider');
  return {
    ...original,
    useSession: jest.fn(),
  };
});

describe('D7 Auth Shell - Gating and Redirect Rules', () => {
  let mockReplace: jest.Mock;

  beforeEach(() => {
    mockReplace = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ replace: mockReplace });
    jest.clearAllMocks();
  });

  describe('ProtectedLayout', () => {
    it('renders loading state and NEVER redirects while loading', () => {
      (useSession as jest.Mock).mockReturnValue({ status: 'loading', logout: jest.fn() });
      render(<ProtectedLayout><div>Protected</div></ProtectedLayout>);
      
      expect(screen.getByText('Loading CMS...')).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(screen.queryByText('Protected')).not.toBeInTheDocument();
    });

    it('redirects exactly once to /cms/login when unauthenticated', () => {
      (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated', logout: jest.fn() });
      render(<ProtectedLayout><div>Protected</div></ProtectedLayout>);
      
      expect(screen.getByText('Loading CMS...')).toBeInTheDocument();
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/cms/login');
      expect(screen.queryByText('Protected')).not.toBeInTheDocument();
    });

    it('renders children and does NOT redirect when authenticated', () => {
      (useSession as jest.Mock).mockReturnValue({ status: 'authenticated', logout: jest.fn() });
      render(<ProtectedLayout><div>Protected Content</div></ProtectedLayout>);
      
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
      expect(screen.getByText('DailyStar CMS (Protected)')).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('CmsLoginPage', () => {
    it('renders loading state (form hidden) and NEVER redirects while loading', () => {
      (useSession as jest.Mock).mockReturnValue({ status: 'loading', login: jest.fn() });
      render(<CmsLoginPage />);
      
      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(screen.queryByText('CMS Login')).not.toBeInTheDocument(); // Form hidden
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('renders the login form and does NOT redirect when unauthenticated', () => {
      (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated', login: jest.fn() });
      render(<CmsLoginPage />);
      
      expect(screen.getByText('CMS Login')).toBeInTheDocument();
      expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('redirects to /cms when authenticated', () => {
      (useSession as jest.Mock).mockReturnValue({ status: 'authenticated', login: jest.fn() });
      render(<CmsLoginPage />);
      
      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/cms');
    });
  });

  describe('SessionProvider Lifecycle', () => {
    let originalFetch: typeof global.fetch;
    let actualUseSession: any;

    beforeEach(() => {
      originalFetch = global.fetch;
      global.fetch = jest.fn();
      actualUseSession = jest.requireActual('../session-provider').useSession;
      (useSession as jest.Mock).mockImplementation(actualUseSession);
    });

    afterEach(() => {
      global.fetch = originalFetch;
      (useSession as jest.Mock).mockReset();
    });

    const TestConsumer = ({ onContext }: { onContext: (ctx: any) => void }) => {
      const ctx = useSession();
      React.useEffect(() => {
        onContext(ctx);
      }, [ctx, onContext]);
      return <div data-testid="status">{ctx.status}</div>;
    };

    it('A. Initial refresh success', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/auth/refresh')) {
          return { ok: true, json: async () => ({ accessToken: 'test-token' }) };
        }
        if (url.includes('/users/me')) {
          return { ok: true, json: async () => ({ id: 'u1', roles: ['admin'], permissions: ['read'] }) };
        }
        return { ok: false };
      });

      let ctx: any;
      await act(async () => {
        render(
          <SessionProvider>
            <TestConsumer onContext={(c) => { ctx = c; }} />
          </SessionProvider>
        );
      });

      expect(ctx.status).toBe('authenticated');
      expect(ctx.accessToken).toBe('test-token');
      expect(ctx.roles).toEqual(['admin']);
      expect(ctx.permissions).toEqual(['read']);
    });

    it('B. Initial refresh failure', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/auth/refresh')) {
          return { ok: false };
        }
        return { ok: false };
      });

      let ctx: any;
      await act(async () => {
        render(
          <SessionProvider>
            <TestConsumer onContext={(c) => { ctx = c; }} />
          </SessionProvider>
        );
      });

      expect(ctx.status).toBe('unauthenticated');
      expect(ctx.accessToken).toBeNull();
    });

    it('C. Refresh succeeds but /users/me fails', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/auth/refresh')) {
          return { ok: true, json: async () => ({ accessToken: 'temp-token' }) };
        }
        if (url.includes('/users/me')) {
          return { ok: false }; // 401
        }
        return { ok: false };
      });

      let ctx: any;
      await act(async () => {
        render(
          <SessionProvider>
            <TestConsumer onContext={(c) => { ctx = c; }} />
          </SessionProvider>
        );
      });

      expect(ctx.status).toBe('unauthenticated');
      expect(ctx.accessToken).toBeNull();
    });

    it('D. Login success', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/auth/refresh')) return { ok: false }; // mount
        if (url.includes('/auth/login')) {
          return { ok: true, json: async () => ({ accessToken: 'login-token' }) };
        }
        if (url.includes('/users/me')) {
          return { ok: true, json: async () => ({ id: 'u2' }) };
        }
        return { ok: false };
      });

      let ctx: any;
      await act(async () => {
        render(
          <SessionProvider>
            <TestConsumer onContext={(c) => { ctx = c; }} />
          </SessionProvider>
        );
      });

      expect(ctx.status).toBe('unauthenticated');

      await act(async () => {
        await ctx.login('test@test.com', 'password');
      });

      expect(ctx.status).toBe('authenticated');
      expect(ctx.accessToken).toBe('login-token');
      expect(ctx.user.id).toBe('u2');
    });

    it('E. Login verification failure', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/auth/refresh')) return { ok: false };
        if (url.includes('/auth/login')) {
          return { ok: true, json: async () => ({ accessToken: 'bad-token' }) };
        }
        if (url.includes('/users/me')) {
          return { ok: false }; // me fails
        }
        return { ok: false };
      });

      let ctx: any;
      await act(async () => {
        render(
          <SessionProvider>
            <TestConsumer onContext={(c) => { ctx = c; }} />
          </SessionProvider>
        );
      });

      await act(async () => {
        await expect(ctx.login('test', 'pass')).rejects.toThrow('Failed to verify user profile');
      });

      expect(ctx.status).toBe('unauthenticated');
      expect(ctx.accessToken).toBeNull();
    });

    it('F. Logout clears state even if request fails', async () => {
      // setup to authenticate first
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/auth/refresh')) return { ok: true, json: async () => ({ accessToken: 'tok' }) };
        if (url.includes('/users/me')) return { ok: true, json: async () => ({ id: 'u3' }) };
        if (url.includes('/auth/logout')) return { ok: false }; // network or 500 failure
        return { ok: false };
      });

      let ctx: any;
      await act(async () => {
        render(
          <SessionProvider>
            <TestConsumer onContext={(c) => { ctx = c; }} />
          </SessionProvider>
        );
      });

      expect(ctx.status).toBe('authenticated');

      await act(async () => {
        await ctx.logout();
      });

      expect(ctx.status).toBe('unauthenticated');
      expect(ctx.accessToken).toBeNull();
      expect(ctx.user).toBeNull();
    });

    it('G. refresh() manual invocation', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/auth/refresh')) return { ok: false }; // initial fail
        return { ok: false };
      });

      let ctx: any;
      await act(async () => {
        render(
          <SessionProvider>
            <TestConsumer onContext={(c) => { ctx = c; }} />
          </SessionProvider>
        );
      });

      expect(ctx.status).toBe('unauthenticated');

      // Now mock success for manual refresh
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/auth/refresh')) return { ok: true, json: async () => ({ accessToken: 'manual' }) };
        if (url.includes('/users/me')) return { ok: true, json: async () => ({ id: 'u4' }) };
        return { ok: false };
      });

      let token: any;
      await act(async () => {
        token = await ctx.refresh();
      });

      expect(token).toBe('manual');
      expect(ctx.status).toBe('authenticated');
      expect(ctx.accessToken).toBe('manual');

      // Now mock failure
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        return { ok: false };
      });

      await act(async () => {
        token = await ctx.refresh();
      });

      expect(token).toBeNull();
      expect(ctx.status).toBe('unauthenticated');
      expect(ctx.accessToken).toBeNull();
    });
  });
});
