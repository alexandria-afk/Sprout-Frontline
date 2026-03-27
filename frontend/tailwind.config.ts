import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Sprout Solutions brand palette
        sprout: {
          green: "#22C55E",        // Primary green — logo, CTAs, active states
          "green-dark": "#16A34A", // Hover state for primary green
          navy: "#0D3B2E",         // Sidebar / nav bar background
          purple: "#7C3AED",       // Feature accent / highlight labels
          cyan: "#02AFCE",         // CTA button gradient start
          "cyan-light": "#80D8DE", // CTA button gradient end
        },
        dark: {
          DEFAULT: "#1E293B",      // Primary headings / dark text
          secondary: "#334155",    // Body text
        },
        surface: {
          page: "#F8FAFC",         // Page scaffold background
          card: "#FFFFFF",         // Card / panel background
          border: "#E2E8F0",       // Border / divider
        },
      },
      backgroundImage: {
        "sprout-cta": "linear-gradient(135deg, #02AFCE, #80D8DE)",
        "sprout-cta-hover": "linear-gradient(135deg, #0099B8, #6BCCD2)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
