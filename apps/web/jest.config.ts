import type { Config } from 'jest';

/**
 * Jest configuration for @dailystar/web.
 *
 * Uses ts-jest with jsdom environment for React component testing.
 * The next/jest preset is intentionally NOT used here because it requires
 * a full Next.js build context and causes slow startup in CI.
 * Next.js-specific features (server components, App Router routing) are
 * tested via E2E tests (Playwright) added in a later phase.
 */
const config: Config = {
  displayName: '@dailystar/web',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}', '**/*.test.{ts,tsx}'],
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      require.resolve('ts-jest'),
      {
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          module: 'commonjs',
          types: ['jest', '@testing-library/jest-dom'],
        },
      },
    ],
  },
  moduleNameMapper: {
    // Handle CSS imports
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.js',
    // Handle path alias
    '^@/(.*)$': '<rootDir>/$1',
    // Handle Next.js image imports
    '\\.(jpg|jpeg|png|gif|webp|svg)$': '<rootDir>/__mocks__/fileMock.js',
  },
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
};

export default config;
