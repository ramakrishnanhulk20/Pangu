/**
 * The record of every sale these scripts opened on devnet.
 *
 * `sales.json` is committed on purpose: it is public devnet addresses and
 * nothing else, and it is what lets `prove`, `seed` and `graduate` be run with
 * no arguments at all. Nothing secret is ever written here.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { scriptsRoot } from "./environment.js";

export const SALES_FILE = join(scriptsRoot, "sales.json");

/** One opened sale, as the launch script saw it. */
export interface SaleRecord {
  network: "devnet";
  program: string;
  openedAt: string;
  name: string;
  symbol: string;
  mode: "open" | "list" | "credential";
  accessMode: number;
  capShareBps: number;
  cap: string;
  thresholdSol: number;
  bandBps: number | null;
  config: string;
  mint: string;
  pool: string;
  rules: string;
  extraAccountList: string;
  quoteMint: string;
  issuer: string;
  priceAccount: string | null;
  templateSignature: string;
  saleSignature: string;
}

export function readSales(): SaleRecord[] {
  if (!existsSync(SALES_FILE)) {
    return [];
  }
  const parsed: unknown = JSON.parse(readFileSync(SALES_FILE, "utf8"));
  return Array.isArray(parsed) ? (parsed as SaleRecord[]) : [];
}

export function appendSale(record: SaleRecord): void {
  const all = readSales();
  all.push(record);
  writeFileSync(SALES_FILE, `${JSON.stringify(all, null, 2)}\n`, "utf8");
}

/**
 * The sale a command should work on: the one named by `--mint`, or the last one
 * opened.
 *
 * Throws when a mint was asked for that this file has never seen, rather than
 * falling back to another sale, because spending on the wrong sale is not
 * something to guess at.
 */
export function chooseSale(mint: string | undefined): SaleRecord {
  const all = readSales();
  if (all.length === 0) {
    throw new Error(
      `no sale has been opened yet. Run "npm run launch" first, or pass --mint. (${SALES_FILE})`
    );
  }
  if (mint === undefined) {
    return all[all.length - 1] as SaleRecord;
  }
  const wanted = new PublicKey(mint).toBase58();
  const found = all.find((sale) => sale.mint === wanted);
  if (found === undefined) {
    throw new Error(`${wanted} is not a sale in ${SALES_FILE}`);
  }
  return found;
}
