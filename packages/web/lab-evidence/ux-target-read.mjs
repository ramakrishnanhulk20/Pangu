/**
 * Times the server's reading of the ledger's sale, paced and unpaced, and
 * counts the calls it makes to the node.
 *
 *   node lab-evidence/ux-target-read.mjs
 */
import { Connection } from "@solana/web3.js";

import { breakConnection, readTarget } from "../lib/break.ts";
import sales from "../../scripts/sales.json" with { type: "json" };

// The keyed devnet endpoint lives in the repository root .env. The public one
// stands in when there is none.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No root .env: the public endpoint is used.
}
const endpoint = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const candidates = sales
  .filter((sale) => sale.network === "devnet" && sale.retiredAt === undefined)
  .map(({ mint, name, symbol, mode }) => ({ mint, name, symbol, mode }));

let calls = 0;
const counted = (input, init) => {
  calls += 1;
  return fetch(input, init);
};

for (const [label, make] of [
  ["unpaced", () => new Connection(endpoint, { commitment: "confirmed", fetch: counted })],
  ["paced", () => breakConnection(endpoint)],
]) {
  calls = 0;
  const started = performance.now();
  const target = await readTarget(make(), candidates);
  const ms = Math.round(performance.now() - started);
  console.log(`${label}: ${ms} ms, ${label === "unpaced" ? `${calls} calls, ` : ""}sale ${target?.name ?? "none"}`);
}
