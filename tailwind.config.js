/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#4A90E2', dark: '#3B7BC9' },
        gain: '#22c55e',
        loss: '#ef4444',
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#ef4444',
        accent: '#a855f7',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
