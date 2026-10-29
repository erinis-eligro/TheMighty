/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        pastel: {
          bg: '#F7F5FA',
          card: '#FFFFFF',
          accent: '#A78BFA',
          accentHover: '#8B5CF6',
          accentDeep: '#7C3AED',
          pink: '#F472B6',
          sky: '#3B82F6',
          cardBack: '#CBD5E1',
          cardBackBorder: '#94A3B8',
          danger: '#FEE2E2',
          dangerText: '#991B1B',
          text: '#1F2937',
          muted: '#6B7280',
          border: '#E5E7EB',
          warn: '#FEF3C7',
          warnText: '#92400E',
          ok: '#D1FAE5',
          okText: '#047857',
        },
        suit: {
          red: '#E53E3E',
          black: '#1F2937',
          joker: '#6366F1',
        },
      },
      // Card dimensions: mobile (portrait) -> tablet/PC. Used by Card, hand and trick board.
      spacing: {
        'card-w': '5rem',
        'card-h': '7rem',
        'card-w-sm': '3.5rem',
        'card-h-sm': '5rem',
        'card-w-xs': '3rem',
        'card-h-xs': '4.25rem',
        'card-w-lg': '6rem',
        'card-h-lg': '8.5rem',
        'board-h': '30rem',
        'fan-overlap': '1.75rem',
        'fan-overlap-md': '0.5rem',
        'fan-overlap-lg': '0.25rem',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.5rem',
      },
    },
  },
  plugins: [],
};
