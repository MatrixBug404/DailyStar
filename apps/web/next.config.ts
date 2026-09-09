import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable strict mode for better development experience
  reactStrictMode: true,

  // TypeScript is checked separately via tsc --noEmit
  typescript: {
    // We run typecheck in a separate CI step; build should not block on it here
    ignoreBuildErrors: false,
  },

  // ESLint is run separately in CI
  eslint: {
    ignoreDuringBuilds: false,
  },

  // Environment variables made available to the browser (public)
  // Add non-secret config here as needed
  // env: {},
};

export default nextConfig;
