/**
 * Phase 23 — Design tokens.
 *
 * Single source of truth for colors, spacing, motion, radii. Pages should
 * compose from this — avoid one-off hex codes inline.
 *
 * Token philosophy:
 *   • paper / ink / lime  — brand
 *   • semantic colors     — success / warn / danger / info
 *   • shadows             — soft / pop / float
 *   • motion              — fast / base / slow + cubic-bezier easings
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F4F1E8",
        ink:   "#17160E",
        lime:  "#C8F23A",
        // Semantic tokens. Use these in components for status / state.
        success: { 50: "#ECFDF5", 600: "#059669", 700: "#047857" },
        warn:    { 50: "#FFFBEB", 600: "#D97706", 700: "#B45309" },
        danger:  { 50: "#FEF2F2", 600: "#DC2626", 700: "#B91C1C" },
        info:    { 50: "#EFF6FF", 600: "#2563EB", 700: "#1D4ED8" },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', "system-ui", "sans-serif"],
        sans: ['Inter', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl:  "0.875rem",
        '2xl': "1.125rem",
      },
      boxShadow: {
        soft:  "0 1px 2px 0 rgba(23,22,14,0.04), 0 1px 1px 0 rgba(23,22,14,0.02)",
        pop:   "0 4px 12px -2px rgba(23,22,14,0.08), 0 2px 4px -1px rgba(23,22,14,0.04)",
        float: "0 12px 32px -8px rgba(23,22,14,0.16), 0 4px 12px -2px rgba(23,22,14,0.06)",
      },
      transitionTimingFunction: {
        snap:   "cubic-bezier(0.22, 1, 0.36, 1)",
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "320ms",
      },
      keyframes: {
        "fade-in":     { "0%": { opacity: 0 },        "100%": { opacity: 1 } },
        "slide-up":    { "0%": { opacity: 0, transform: "translateY(8px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
        "pulse-soft":  { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.6 } },
      },
      animation: {
        "fade-in":    "fade-in 200ms cubic-bezier(0.22, 1, 0.36, 1)",
        "slide-up":   "slide-up 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
