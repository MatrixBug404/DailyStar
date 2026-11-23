import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Georgia', 'serif'],
      },
      colors: {
        // DailyStar brand colours — to be refined in the CMS/public site phases
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        // Public newsroom editorial palette (Phase 8 public redesign).
        ink: '#1a1714',
        charcoal: '#3a342d',
        paper: {
          DEFAULT: '#faf8f3',
          dark: '#f0ebe1',
        },
        rule: '#ddd5c6',
        muted: '#6f665b',
        crimson: {
          DEFAULT: '#9c1c1c',
          dark: '#7a1414',
          light: '#e8a0a0',
        },
      },
    },
  },
  plugins: [],
};

export default config;
