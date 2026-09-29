/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff', 100: '#dce7fe', 200: '#c0d4fe', 300: '#94b8fc',
          400: '#6193f8', 500: '#3d6ef3', 600: '#274de8', 700: '#1f3bd5',
          800: '#2032ac', 900: '#1f2f88', 950: '#171f53',
        },
        bubble: {
          out: 'var(--bubble-out)',
          in: 'var(--bubble-in)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Noto Sans Bengali', 'sans-serif'],
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
        'pop-in': { '0%': { transform: 'scale(.92) translateY(8px)', opacity: '0' }, '100%': { transform: 'scale(1) translateY(0)', opacity: '1' } },
      },
      animation: {
        'pop-in': 'pop-in .18s cubic-bezier(.2,.9,.3,1.4)',
      },
    },
  },
  plugins: [],
}
