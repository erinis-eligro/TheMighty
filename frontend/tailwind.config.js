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
        },
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.5rem',
      },
    },
  },
  plugins: [],
};
