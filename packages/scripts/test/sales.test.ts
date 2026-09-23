// The record of opened sales: written the moment a sale lands, filled in
// afterwards, never twice for one mint, retired rather than deleted, and the
// newest sale chosen by its time rather than its place in the file.
//
// Does NOT cover: the launch itself, which is what calls these on devnet. Each
// test works on its own file in the temp folder, never on the real sales.json.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
  chooseSale,
  enrichSale,
  liveSales,
  readSales,
  recordSale,
  retireSale,
  type SaleRecord,
} from "../src/sales.js";

const folder = mkdtempSync(join(tmpdir(), "pangu-sales-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

let files = 0;
function freshFile(): string {
  files += 1;
  return join(folder, `sales-${files}.json`);
}

function sale(openedAt: string, symbol: string): SaleRecord {
  const address = (): string => Keypair.generate().publicKey.toBase58();
  return {
    network: "devnet",
    program: address(),
    openedAt,
    name: `Pangu ${symbol}`,
    symbol,
    mode: "list",
    accessMode: 1,
    capShareBps: 1_000,
    cap: null,
    thresholdSol: 0.1,
    bandBps: null,
    feed: null,
    config: address(),
    mint: address(),
    pool: address(),
    rules: address(),
    extraAccountList: address(),
    quoteMint: address(),
    issuer: address(),
    priceAccount: null,
    templateSignature: "template",
    saleSignature: "sale",
  };
}

describe("recording a sale", () => {
  it("keeps the entry written on landing even when the read back never happens", () => {
    const file = freshFile();
    const opened = sale("2026-09-23T06:56:27.629Z", "PLIST");
    recordSale(opened, file);
    expect(readSales(file)).toEqual([opened]);
    expect(existsSync(`${file}.next`)).toBe(false);
  });

  it("fills in the cap once the rules are read back, and changes nothing else", () => {
    const file = freshFile();
    const opened = sale("2026-09-23T06:56:27.629Z", "PLIST");
    recordSale(opened, file);
    enrichSale(opened.mint, { cap: "79999967072171" }, file);
    expect(readSales(file)).toEqual([{ ...opened, cap: "79999967072171" }]);
  });

  it("refuses a second entry for the same mint", () => {
    const file = freshFile();
    const opened = sale("2026-09-23T06:56:27.629Z", "PLIST");
    recordSale(opened, file);
    expect(() => recordSale({ ...opened, symbol: "AGAIN" }, file)).toThrow(/already in/);
    expect(readSales(file)).toHaveLength(1);
  });
});

describe("choosing a sale", () => {
  it("takes the latest openedAt, not the last entry in the file", () => {
    const file = freshFile();
    const newest = sale("2026-09-23T06:56:27.629Z", "PLIST");
    recordSale(sale("2026-09-22T14:56:29.520Z", "OLD"), file);
    recordSale(newest, file);
    recordSale(sale("2026-09-22T16:31:03.083Z", "PBAND"), file);
    expect(chooseSale(undefined, file).mint).toBe(newest.mint);
  });

  it("skips a retired sale, and refuses it by name", () => {
    const file = freshFile();
    const older = sale("2026-09-22T14:56:29.520Z", "OLD");
    const newest = sale("2026-09-23T06:56:27.629Z", "PLIST");
    recordSale(older, file);
    recordSale(newest, file);
    retireSale(newest.mint, new Date("2026-09-23T10:00:00Z"), file);

    expect(chooseSale(undefined, file).mint).toBe(older.mint);
    expect(() => chooseSale(newest.mint, file)).toThrow(/retired .* at 2026-09-23T10:00:00.000Z/);
    expect(liveSales(readSales(file)).map((each) => each.mint)).toEqual([older.mint]);
  });

  it("says so when every sale has been retired", () => {
    const file = freshFile();
    const only = sale("2026-09-22T14:56:29.520Z", "OLD");
    recordSale(only, file);
    retireSale(only.mint, new Date("2026-09-23T10:00:00Z"), file);
    expect(() => chooseSale(undefined, file)).toThrow(/still in the demo/);
  });
});

describe("retiring a sale", () => {
  it("keeps the first retirement time when asked twice", () => {
    const file = freshFile();
    const only = sale("2026-09-22T14:56:29.520Z", "OLD");
    recordSale(only, file);
    const first = retireSale(only.mint, new Date("2026-09-23T10:00:00Z"), file);
    const second = retireSale(only.mint, new Date("2026-09-24T10:00:00Z"), file);
    expect(second).toBe(first);
    expect(readSales(file)[0]?.retiredAt).toBe("2026-09-23T10:00:00.000Z");
  });

  it("refuses a mint the file has never seen", () => {
    const file = freshFile();
    recordSale(sale("2026-09-22T14:56:29.520Z", "OLD"), file);
    expect(() => retireSale(Keypair.generate().publicKey.toBase58(), new Date(), file)).toThrow(
      /is not a sale/
    );
  });
});
