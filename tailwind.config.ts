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
          DEFAULT: '#ff5a26',
          hover: '#ff7043',
          muted: 'rgba(255, 90, 38, 0.14)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
