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
          purple: '#9146FF',
          'purple-dark': '#772CE8',
          'purple-darker': '#5C16C5',
          dark: '#18181B',
          'dark-light': '#1F1F23',
          'dark-lighter': '#26262C',
        }
      }
    },
  },
  plugins: [],
}
