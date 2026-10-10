/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#19251f',
        muted: '#7e8983',
        canvas: '#f7f8f6',
        brand: { DEFAULT: '#177a55', dark: '#116344', soft: '#e7f3ed' },
      },
      boxShadow: { card: '0 8px 30px rgba(23, 45, 34, 0.045)' },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
