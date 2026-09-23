/**
 * The record of every sale these scripts opened on devnet.
 *
 * `sales.json` is committed on purpose: it is public devnet addresses and
 * nothing else, and it is what lets `prove`, `seed` and `graduate` be run with
 * no arguments at all. Nothing secret is ever written here.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
  /**
   * Raw units, as the chain holds it. Null when the launch stopped between the
   * sale landing and its rules being read back; `status` says so.
   */
  cap: string | null;
  thresholdSol: number;
  bandBps: number | null;
  /** The Pyth feed the band is measured against. Missing on sales opened before. */
  feed?: string | null;
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
  /** When `npm run retire` took this sale out of the demo. No command picks it after that. */
  retiredAt?: string;
}

export function readSales(file: string = SALES_FILE): SaleRecord[] {
  if (!existsSync(file)) {
    return [];
  }
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? (parsed as SaleRecord[]) : [];
}

/**
 * Writes the whole list to a file beside this one and then swaps it in, so a
 * run killed partway through a write leaves the old list rather than half of
 * a new one.
 */
function writeSales(all: readonly SaleRecord[], file: string): void {
  const next = `${file}.next`;
  writeFileSync(next, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  renameSync(next, file);
}

/** The entries still in the demo: everything not marked retired. */
export function liveSales(all: readonly SaleRecord[]): SaleRecord[] {
  return all.filter((sale) => sale.retiredAt === undefined);
}

/**
 * Adds a sale the moment its transaction has landed, before anything else is
 * read, so a failed read afterwards can never lose a sale that is live on
 * chain.
 *
 * Throws when the file already holds this mint, because two entries for one
 * sale would leave every command guessing which one is right.
 */
export function recordSale(record: SaleRecord, file: string = SALES_FILE): void {
  const all = readSales(file);
  if (all.some((sale) => sale.mint === record.mint)) {
    throw new Error(`${record.mint} is already in ${file}, so it was not added twice`);
  }
  writeSales([...all, record], file);
}

/**
 * Fills in what was read back after the sale landed. Only the fields given
 * change.
 *
 * Throws when the file has no entry for this mint.
 */
export function enrichSale(
  mint: string,
  found: Partial<Omit<SaleRecord, "mint">>,
  file: string = SALES_FILE
): void {
  const all = readSales(file);
  const index = all.findIndex((sale) => sale.mint === mint);
  if (index === -1) {
    throw new Error(`${mint} is not a sale in ${file}`);
  }
  all[index] = { ...(all[index] as SaleRecord), ...found };
  writeSales(all, file);
}

/**
 * Marks a sale retired, so no command picks it again. The entry stays: it is
 * the record that the sale was opened, and its addresses stay public on chain.
 *
 * Returns the time it was retired at, which is the earlier time when it
 * already was. Throws when the file has no entry for this mint.
 */
export function retireSale(mint: string, at: Date, file: string = SALES_FILE): string {
  const wanted = new PublicKey(mint).toBase58();
  const all = readSales(file);
  const found = all.find((sale) => sale.mint === wanted);
  if (found === undefined) {
    throw new Error(`${wanted} is not a sale in ${file}`);
  }
  if (found.retiredAt !== undefined) {
    return found.retiredAt;
  }
  const retiredAt = at.toISOString();
  enrichSale(wanted, { retiredAt }, file);
  return retiredAt;
}

/**
 * The sale a command should work on: the one named by `--mint`, or the one
 * opened most recently by its `openedAt` time, never counting a retired one.
 *
 * Newest is read from the time and not from the order in the file, because an
 * entry added out of order must not quietly change which sale every command
 * spends on.
 *
 * Throws when a mint was asked for that this file has never seen or has
 * retired, rather than falling back to another sale, because spending on the
 * wrong sale is not something to guess at.
 */
export function chooseSale(mint: string | undefined, file: string = SALES_FILE): SaleRecord {
  const all = readSales(file);
  const live = liveSales(all);
  if (mint !== undefined) {
    const wanted = new PublicKey(mint).toBase58();
    const found = all.find((sale) => sale.mint === wanted);
    if (found === undefined) {
      throw new Error(`${wanted} is not a sale in ${file}`);
    }
    if (found.retiredAt !== undefined) {
      throw new Error(
        `${wanted} was retired from ${file} at ${found.retiredAt}, so no command works on it`
      );
    }
    return found;
  }
  if (live.length === 0) {
    throw new Error(
      `no sale in ${file} is still in the demo. Run "npm run launch" first, or pass --mint.`
    );
  }
  return live.reduce((newest, sale) =>
    Date.parse(sale.openedAt) > Date.parse(newest.openedAt) ? sale : newest
  );
}
