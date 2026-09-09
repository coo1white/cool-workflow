import path from "node:path";
import type { NextConfig } from "next";

// Static files only: the Workbench host has no page server, it reads out/
// off disk. basePath /ui matches the host's asset route.
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/ui",
  // GitHub Pages serves the site under /cool-workflow/, so its build sets
  // WORKBENCH_ASSET_PREFIX=/cool-workflow/ui; the local host leaves it unset.
  assetPrefix: process.env.WORKBENCH_ASSET_PREFIX || undefined,
  images: { unoptimized: true },
  trailingSlash: false,
  // A fixed build id keeps chunk names stable between builds.
  generateBuildId: () => Promise.resolve("workbench"),
  // Chunk names hash module paths from this root. Pinned to the plugin dir
  // (globals.css scans ../../src/core/format/report-html.ts, which must sit
  // inside the root); left to Next, the root is inferred from lockfiles and
  // out/ drifts between machines.
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
};

export default nextConfig;
