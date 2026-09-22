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
  // Anchor's ESM entry does `exports.workspace = require(...)` unless it
  // believes it is in a browser, which throws "exports is not defined" when
  // Next renders a client component on the server. The app never uses the
  // node-only workspace or Wallet, so Anchor is told it is in a browser
  // everywhere.
  env: {
    ANCHOR_BROWSER: "true",
  },
};

// The docs route reads MDX out of content/docs, compiled by Fumadocs.
const withMDX = createMDX();

export default withMDX(nextConfig);
