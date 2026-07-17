import type { Config } from "tailwindcss";

// Tokens resolve to the CSS variables declared in app/globals.css, which flip
// with prefers-color-scheme. Per D-14 the accent is ink (black in light, white
// in dark); green and red are the only hues, and only where state has meaning.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "var(--color-page)",
        card: "var(--color-card)",
        elevated: "var(--color-elevated)",
        ink: "var(--color-ink)",
        secondary: "var(--color-secondary)",
        hairline: "var(--color-hairline)",
        accent: "var(--color-accent)",
        "accent-ink": "var(--color-accent-ink)",
        severe: "#FF3B30",
        medium: "#FF9500",
        good: "#34C759",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"Segoe UI"',
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "18px",
        control: "12px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)",
      },
    },
  },
  plugins: [],
};

export default config;
