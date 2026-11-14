/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-body)"],
      },
      borderColor: {
        DEFAULT: "var(--color-rule)",
      },
      colors: {
        paper: "var(--color-paper)",
        "paper-2": "var(--color-paper-2)",
        "paper-3": "var(--color-paper-3)",
        ink: "var(--color-ink)",
        "ink-2": "var(--color-ink-2)",
        muted: "var(--color-muted)",
        rule: "var(--color-rule)",
        accent: "var(--color-accent)",
        "accent-ink": "var(--color-accent-ink)",
        focus: "var(--color-focus)",
        error: "var(--color-error)",
        "error-well": "var(--color-error-well)",
        success: "var(--color-success)",
        "success-well": "var(--color-success-well)",
        warn: "var(--color-warn)",
        "warn-well": "var(--color-warn-well)",
      },
      borderRadius: {
        none: "0",
        sm: "var(--radius-card)",
        DEFAULT: "var(--radius-card)",
        md: "var(--radius-card)",
        lg: "var(--radius-card)",
        xl: "var(--radius-card)",
        "2xl": "var(--radius-card)",
        "3xl": "var(--radius-card)",
        full: "9999px",
      },
      boxShadow: {
        none: "none",
        sm: "none",
        DEFAULT: "none",
        md: "none",
        lg: "none",
        xl: "none",
        "2xl": "none",
      },
      opacity: {
        55: "0.55",
      },
    },
  },
  plugins: [],
};
