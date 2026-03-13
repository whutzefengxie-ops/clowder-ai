/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}', '../shared/src/**/*.{js,ts}'],
  theme: {
    extend: {
      colors: {
        opus: {
          primary: 'var(--color-opus-primary)',
          light: 'var(--color-opus-light)',
          dark: 'var(--color-opus-dark)',
          bg: 'var(--color-opus-bg)',
        },
        codex: {
          primary: 'var(--color-codex-primary)',
          light: 'var(--color-codex-light)',
          dark: 'var(--color-codex-dark)',
          bg: 'var(--color-codex-bg)',
        },
        gemini: {
          primary: 'var(--color-gemini-primary)',
          light: 'var(--color-gemini-light)',
          dark: 'var(--color-gemini-dark)',
          bg: 'var(--color-gemini-bg)',
        },
        dare: {
          primary: 'var(--color-dare-primary)',
          light: 'var(--color-dare-light)',
          dark: 'var(--color-dare-dark)',
          bg: 'var(--color-dare-bg)',
        },
        owner: {
          primary: 'var(--color-owner-primary)',
          light: 'var(--color-owner-light)',
          dark: 'var(--color-owner-dark)',
          bg: 'var(--color-owner-bg)',
        },
        cafe: {
          white: 'var(--color-base-white)',
          black: 'var(--color-base-black)',
        },
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'cat-bounce': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
        'cat-shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-2px)' },
          '40%': { transform: 'translateX(2px)' },
          '60%': { transform: 'translateX(-1px)' },
          '80%': { transform: 'translateX(1px)' },
        },
        'toast-in': {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'toast-out': {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(20px)' },
        },
        'token-pulse': {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.05)', opacity: '0.8' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'cost-glow': {
          '0%': { opacity: '0', filter: 'brightness(1)' },
          '50%': { opacity: '1', filter: 'brightness(1.3)' },
          '100%': { opacity: '1', filter: 'brightness(1)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'tree-expand': {
          '0%': { opacity: '0', height: '0' },
          '100%': { opacity: '1', height: 'var(--radix-collapsible-content-height, auto)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'cat-bounce': 'cat-bounce 0.8s ease-in-out infinite',
        'cat-shake': 'cat-shake 0.4s ease-in-out',
        'toast-in': 'toast-in 0.3s ease-out',
        'toast-out': 'toast-out 0.3s ease-in forwards',
        'token-pulse': 'token-pulse 0.3s ease-out',
        'cost-glow': 'cost-glow 0.4s ease-out',
        'slide-in-right': 'slide-in-right 0.2s ease-out',
        'tree-expand': 'tree-expand 0.15s ease-out',
        shimmer: 'shimmer 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
