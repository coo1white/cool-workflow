import type { NextConfig } from "next";

// Static files only: the Workbench host has no page server, it reads out/
// off disk. basePath /ui matches the host's asset route.
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/ui",
  images: { unoptimized: true },
  trailingSlash: false,
  // out/ is committed and CI fails on drift, so the build id must not be a
  // new random string on every build.
  generateBuildId: () => Promise.resolve("workbench"),
};

export default nextConfig;
