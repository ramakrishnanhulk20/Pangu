import path from "node:path";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

// The app reads packages/scripts/sales.json, one folder up, so both the
// bundler and the file tracer have to be pointed at the repository root
// rather than this package.
const repositoryRoot = path.join(__dirname, "..", "..");

const nextConfig: NextConfig = {
  // A verification build writes somewhere else so it never disturbs the .next
  // the dev server is holding open.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  outputFileTracingRoot: repositoryRoot,
  turbopack: {
    root: repositoryRoot,
  },
};

// The docs route reads MDX out of content/docs, compiled by Fumadocs.
const withMDX = createMDX();

export default withMDX(nextConfig);
