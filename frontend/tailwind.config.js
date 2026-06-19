/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // shadcn CSS variable tokens — required for shadcn Button/Badge/etc.
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        // DocForge design system tokens (fixed hex — used in all custom components)
        surface: { DEFAULT: "#F9F9F7", dark: "#1A1A1A" },
        "text-primary": { DEFAULT: "#111111", dark: "#F0F0EE" },
        "text-muted": { DEFAULT: "#6B6B65", dark: "#888880" },
        accent: { DEFAULT: "#1D9E75", dark: "#25C292" },
        danger: { DEFAULT: "#DC2626", dark: "#EF4444" },
        success: { DEFAULT: "#16A34A", dark: "#22C55E" },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "sans-serif"],
      },
      maxWidth: {
        content: "860px",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};
