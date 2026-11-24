import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        canvas: '#0c0c0e',
        surface: {
          DEFAULT: '#131317',
          light: '#1a1a20',
          lighter: '#23232b',
        },
        accent: {
          DEFAULT: '#e4e4e7',
          hover: '#f4f4f5',
          muted: 'rgba(228, 228, 231, 0.12)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
