/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#090B10",
          900: "#0E1118",
          800: "#161A24",
          700: "#222938"
        },
        ember: {
          400: "#FFB067",
          500: "#FF9152",
          600: "#F06C34"
        },
        ice: {
          300: "#86D8FF",
          400: "#58B7FF",
          500: "#2B8CFF"
        },
        lime: {
          400: "#B8F36B",
          500: "#8FD947"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.05), 0 18px 55px rgba(0,0,0,0.28)",
        card: "0 18px 50px rgba(0,0,0,0.24)"
      },
      fontFamily: {
        display: ['\"Space Grotesk\"', "sans-serif"],
        body: ['\"Manrope\"', "sans-serif"]
      },
      backgroundImage: {
        dashboard:
          "radial-gradient(circle at top left, rgba(88,183,255,0.18), transparent 28%), radial-gradient(circle at 85% 18%, rgba(255,145,82,0.16), transparent 22%), linear-gradient(180deg, rgba(255,255,255,0.02), transparent 30%)"
      }
    }
  },
  plugins: []
};
