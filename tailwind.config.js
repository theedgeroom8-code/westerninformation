/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#1e3a8a",
        secondary: "#fbbf24",
        success: "#10b981",
        danger: "#ef4444",
        dark: "#0f172a",
      },
    },
  },
  plugins: [],
};
