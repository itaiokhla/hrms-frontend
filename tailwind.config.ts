import type { Config } from "tailwindcss";

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--brand-font-sans, var(--font-sans))", "var(--font-noto-devanagari)", "var(--font-noto-arabic)",
          "ui-sans-serif", "system-ui", "sans-serif",
        ],
        display: [
          "var(--brand-font-display, var(--font-display))", "var(--brand-font-sans, var(--font-sans))",
          "var(--font-noto-devanagari)", "var(--font-noto-arabic)", "ui-sans-serif", "sans-serif",
        ],
      },
      colors: {
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
        background: token("background"),
        foreground: token("foreground"),
        surface: { DEFAULT: token("surface"), muted: token("surface-muted"), raised: token("surface-raised") },
        primary: { DEFAULT: token("primary"), foreground: token("primary-foreground"), soft: token("primary-soft") },
        muted: { DEFAULT: token("muted"), foreground: token("muted-foreground") },
        accent: { DEFAULT: token("accent"), foreground: token("accent-foreground") },
        success: { DEFAULT: token("success"), soft: token("success-soft") },
        warning: { DEFAULT: token("warning"), soft: token("warning-soft") },
        danger: { DEFAULT: token("danger"), soft: token("danger-soft") },
        info: { DEFAULT: token("info"), soft: token("info-soft") },
        sidebar: {
          DEFAULT: token("sidebar"),
          foreground: token("sidebar-foreground"),
          muted: token("sidebar-muted"),
          active: token("sidebar-active"),
          "active-foreground": token("sidebar-active-foreground"),
        },
      },
      // Brand corner style (SHARP / ROUNDED / PILL) sets these variables; defaults in globals.css.
      borderRadius: {
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        "3xl": "var(--radius-3xl)",
      },
      boxShadow: {
        card: "0 1px 2px hsl(var(--shadow) / 0.06), 0 4px 16px -4px hsl(var(--shadow) / 0.08)",
        lift: "0 8px 30px -8px hsl(var(--shadow) / 0.25)",
        glow: "0 0 0 1px hsl(var(--primary) / 0.2), 0 10px 40px -10px hsl(var(--primary) / 0.45)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "float-slow": {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(0,-14px,0) scale(1.04)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 hsl(var(--primary) / 0.45)" },
          "100%": { boxShadow: "0 0 0 14px hsl(var(--primary) / 0)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        "float-slow": "float-slow 9s ease-in-out infinite",
        "pulse-ring": "pulse-ring 1.8s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
