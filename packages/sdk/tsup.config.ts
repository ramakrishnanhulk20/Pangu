import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    dbc: "src/dbc/index.ts",
    price: "src/price.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "neutral",
  // Each entry carries its own copy of the core code it uses. A shared chunk
  // would let one entry's imports show up in another's file, and the core
  // bundle has to stay free of the Meteora and Pyth packages so a browser never
  // downloads them, and never sees the Hermes key that the Pyth one needs.
  splitting: false,
  // The web app imports this from a server component and from the browser, so
  // nothing here may assume either environment. `neutral` makes esbuild refuse
  // to shim a Node built-in instead of failing silently in a browser.
  external: [
    "@solana/web3.js",
    "@solana/spl-token",
    "@anchor-lang/core",
    "buffer",
    "@meteora-ag/dynamic-bonding-curve-sdk",
    "@pythnetwork/pyth-solana-receiver",
  ],
});
