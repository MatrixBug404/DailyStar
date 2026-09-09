/**
 * @dailystar/config
 * Shared ESLint base configuration for all DailyStar packages.
 * Each app/package extends this and adds framework-specific rules.
 *
 * Usage in ESLint flat config (eslint.config.mjs):
 *   import baseConfig from '@dailystar/config/eslint-base.mjs';
 *   export default [...baseConfig, { ... your overrides ... }];
 */
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

/** @type {import('eslint').Linter.FlatConfig[]} */
const baseConfig = [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Relax rules that are noisy during initial scaffolding
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Prefer const
      'prefer-const': 'error',
      // No var
      'no-var': 'error',
    },
  },
  // Must come last — disables all formatting rules handled by Prettier
  prettierConfig,
];

export default baseConfig;
