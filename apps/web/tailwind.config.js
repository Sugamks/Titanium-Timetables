/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
