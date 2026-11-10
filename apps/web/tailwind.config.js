/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070b14',
          900: '#0c1222',
          850: '#10182b',
          800: '#162033',
          700: '#243044',
        },
        mist: '#93a0b8',
        line: 'rgba(214, 224, 244, 0.12)',
        mint: {
          200: '#ccfbf1',
          300: '#99f6e4',
          400: '#5eead4',
          500: '#14b8a6',
        },
      },
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        panel: '0 24px 60px rgba(0, 0, 0, 0.28)',
      },
    },
  },
  plugins: [],
};
