/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
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
