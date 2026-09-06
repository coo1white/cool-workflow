import "./globals.css";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";

// Three faces, one job each: Montserrat for the UI, Unbounded for the brand
// word only, Fira Mono for every number and id. The woff2 files are in
// app/fonts/, so the build never goes to the network.
const montserrat = localFont({ src: "./fonts/montserrat.woff2", weight: "400 700", variable: "--font-montserrat", display: "swap" });
const unbounded = localFont({ src: "./fonts/unbounded.woff2", weight: "500 600", variable: "--font-unbounded", display: "swap" });
const firaMono = localFont({
  src: [
    { path: "./fonts/fira-mono-400.woff2", weight: "400" },
    { path: "./fonts/fira-mono-500.woff2", weight: "500" },
    { path: "./fonts/fira-mono-700.woff2", weight: "700" },
  ],
  variable: "--font-fira-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Cool Workflow Workbench", template: "%s · Cool Workflow" },
  description: "Read-only view of the runs on this machine, re-derived from .cw/ on every refresh.",
  icons: { icon: "/ui/icon.svg" },
  robots: { index: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#161b22" };

// Puts the kept theme on <html> before the first paint, so the page never
// flashes the wrong colours. No key means the --default theme wins.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('cool-workflow-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t==='dark'?'cool-dark':'cool-light');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${montserrat.variable} ${unbounded.variable} ${firaMono.variable}`} suppressHydrationWarning>
      <body>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT }}
        />
        {children}
      </body>
    </html>
  );
}
