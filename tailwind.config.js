/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./popup.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        twitch: {
          purple: 'oklch(0.66 0.24 302)',
          'purple-dark': 'oklch(0.56 0.25 302)',
          'purple-darker': 'oklch(0.45 0.24 302)',
          dark: 'oklch(0.18 0.014 292)',
          'dark-light': 'oklch(0.22 0.018 292)',
          'dark-lighter': 'oklch(0.27 0.022 292)',
        }
      }
    },
  },
  plugins: [],
}
