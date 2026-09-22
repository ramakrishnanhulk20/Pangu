// The built bundles have to be safe to load anywhere: a Next.js server render, a
// worker, a plain Node script, a browser. Aruvi's published package once crashed
// every Next.js user because its entry touched the DOM at import time, so this
// file loads the real build in a process where touching the DOM throws.
//
// Not covered: a real browser. It proves nothing is touched at import and that
// the words are not in the bundle, not that every code path is browser safe.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const commonjs = join(root, "dist", "index.js");
const esmodule = join(root, "dist", "index.mjs");
const types = join(root, "dist", "index.d.ts");

const entries = ["index", "dbc", "price"] as const;
const built = (entry: string, extension: string): string =>
  join(root, "dist", `${entry}.${extension}`);

/**
 * A plain Node process has no DOM globals, which is exactly what a Next.js
 * server render looks like. They are checked rather than trapped: a trap would
 * also fire on `typeof window === "undefined"`, the safe guard the Solana and
 * Anchor libraries use at import.
 */
const guard = `
for (const name of ["window", "document", "localStorage"]) {
  if (typeof globalThis[name] !== "undefined") throw new Error(name + " exists in this process");
}
`;

const checks = `
if (typeof sdk.saleRulesAddress !== "function") throw new Error("no saleRulesAddress");
if (typeof sdk.createSaleInstruction !== "function") throw new Error("no createSaleInstruction");
if (typeof sdk.panguErrorFromLogs !== "function") throw new Error("no panguErrorFromLogs");
const mint = new PublicKey("So11111111111111111111111111111111111111112");
if (sdk.saleRulesAddress(mint).toBase58().length < 32) throw new Error("bad address");
if (sdk.panguErrorFromLogs(["custom program error: 0x1779"]).name !== "OverCap") {
  throw new Error("bad error mapping");
}
console.log("ok");
`;

function runNode(source: string): string {
  return execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the built package", () => {
  it("was built before the tests ran, all three entry points", () => {
    for (const entry of entries) {
      for (const extension of ["js", "mjs", "d.ts", "d.mts"]) {
        const file = built(entry, extension);
        expect(existsSync(file), `${file} is missing, run npm run build`).toBe(true);
      }
    }
    expect(existsSync(types)).toBe(true);
  });

  it("keeps the Meteora and Switchboard packages out of the core bundle", () => {
    // The core is what a page that only reads a sale imports. Naming either
    // heavy package there would drag it into every browser bundle, which is the
    // whole reason `pangu-sdk/dbc` and `pangu-sdk/price` exist.
    for (const extension of ["js", "mjs"]) {
      const code = readFileSync(built("index", extension), "utf8");
      for (const banned of ["@switchboard-xyz", "@meteora-ag"]) {
        expect(code.includes(banned), `${banned} is in the core ${extension} bundle`).toBe(
          false
        );
      }
    }
  });

  it("names the package each extra entry point needs, and nothing it does not", () => {
    const dbc = readFileSync(built("dbc", "mjs"), "utf8");
    expect(dbc.includes("@meteora-ag/dynamic-bonding-curve-sdk")).toBe(true);
    expect(dbc.includes("@switchboard-xyz")).toBe(false);

    const price = readFileSync(built("price", "mjs"), "utf8");
    expect(price.includes("@switchboard-xyz/on-demand")).toBe(true);
  });

  it("loads every entry point in a process with no browser globals", () => {
    for (const entry of entries) {
      const output = runNode(`
        ${guard}
        const loaded = await import(${JSON.stringify(
          pathToFileURL(built(entry, "mjs")).href
        )});
        if (Object.keys(loaded).length === 0) throw new Error("${entry} exports nothing");
        console.log("ok");
      `);
      expect(output, `${entry} did not load`).toBe("ok");
    }
  });

  it("loads as CommonJS with no browser globals in sight", () => {
    const output = runNode(`
      import { createRequire } from "node:module";
      import { PublicKey } from "@solana/web3.js";
      ${guard}
      const require = createRequire(${JSON.stringify(pathToFileURL(commonjs).href)});
      const sdk = require(${JSON.stringify(commonjs.replace(/\\/g, "/"))});
      ${checks}
    `);
    expect(output).toBe("ok");
  });

  it("loads as an ES module with no browser globals in sight", () => {
    const output = runNode(`
      import { PublicKey } from "@solana/web3.js";
      ${guard}
      const sdk = await import(${JSON.stringify(pathToFileURL(esmodule).href)});
      ${checks}
    `);
    expect(output).toBe("ok");
  });

  it("never names window, document or localStorage", () => {
    for (const file of [commonjs, esmodule]) {
      const code = withoutComments(readFileSync(file, "utf8"));
      for (const banned of ["window", "document", "localStorage"]) {
        expect(code.includes(banned), `${banned} is in ${file}`).toBe(false);
      }
    }
  });
});
