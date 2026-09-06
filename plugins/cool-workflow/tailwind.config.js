// Tailwind 3.4 + daisyUI 4 (the Developer-wide pair). The brand is one
// daisyUI theme per scheme; no CSS rules live anywhere else.
const light = {
  "base-100": "#f7f4ee", "base-200": "#ffffff", "base-300": "#e2dcd0", "base-content": "#1e1b17",
  primary: "#c9540f", "primary-content": "#ffffff", secondary: "#7a7368", accent: "#c9540f",
  neutral: "#efeae0", "neutral-content": "#1e1b17",
  info: "#c9540f", success: "#1f8a3b", warning: "#9a6700", error: "#c8321f",
};
const dark = {
  "base-100": "#14120f", "base-200": "#1b1815", "base-300": "#33302a", "base-content": "#f2ede4",
  primary: "#ef6c1f", "primary-content": "#14120f", secondary: "#9a938a", accent: "#ef6c1f",
  neutral: "#23201b", "neutral-content": "#f2ede4",
  info: "#ef6c1f", success: "#58b86a", warning: "#d9a441", error: "#e5533f",
};
module.exports = {
  content: ["./ui/workbench/index.html", "./ui/workbench/app.js", "./src/core/format/report-html.ts"],
  theme: {
    fontFamily: {
      sans: ["-apple-system", "system-ui", "Segoe UI", "sans-serif"],
      mono: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
    },
  },
  plugins: [require("@tailwindcss/typography"), require("daisyui")],
  daisyui: { themes: [{ cw: light }, { cwdark: dark }], darkTheme: "cwdark", logs: false },
};
