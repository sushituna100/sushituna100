import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f3f1ff",
          100: "#e9e5ff",
          200: "#d5cdff",
          300: "#b7a6ff",
          400: "#9575ff",
          500: "#7c5cfc",
          600: "#6d3ef4",
          700: "#5e2ce0",
          800: "#4e25bc",
          900: "#42219a",
        },
      },
    },
  },
  plugins: [],
};

export default config;
