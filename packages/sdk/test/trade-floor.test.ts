// The floor a buy or a sell carries on chain when the caller sets it.
//
// The app shows a quote, the buyer reads it and clicks, and the transaction is
// built seconds later. The floor has to be the one the buyer agreed to, taken
// from what they were shown, not 99 percent of whatever the market says at
// build time. When the market has already moved below that floor, building
// stops before a wallet is asked.
//
// Does NOT cover: whether DBC honours the floor on chain, which is proven by
// the undercut buy on devnet (lab-evidence/review-fixes-trade.mjs), or
// Meteora's quote maths, stood in for here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BN, BorshCoder } from "@anchor-lang/core";
import {
  Keypair,
  PublicKey,
  type AccountInfo,
  type Connection,
  type Transaction,
} from "@solana/web3.js";
import { DBC_PROGRAM_ID, PANGU_IDL, PANGU_PROGRAM_ID, saleRulesAddress } from "../src/index.js";

vi.mock("../src/dbc/quote.js", () => ({
  quoteExactIn: vi.fn(),
  quoteExactOut: vi.fn(),
  quotePartialFill: vi.fn(),
}));
vi.mock("../src/dbc/hook.js", async (original) => ({
  ...(await original<typeof import("../src/dbc/hook.js")>()),
  hookAccounts: vi.fn(),
}));

const { quoteExactIn, quotePartialFill } = await import("../src/dbc/quote.js");
const { hookAccounts } = await import("../src/dbc/hook.js");
const { buyTransaction, sellTransaction } = await import("../src/dbc/trade.js");

const here = dirname(fileURLToPath(import.meta.url));
const LIVE_CONFIG = readFileSync(join(here, "..", "..", "program", "feeds", "live-config.bin"));

const HOOK_POOL_DISCRIMINATOR = Buffer.from([237, 219, 184, 23, 42, 189, 169, 35]);
const HOOK_POOL_LEN = 424;

const coder = new BorshCoder(PANGU_IDL);
const key = () => Keypair.generate().publicKey;

const mint = key();
const wallet = key();
const config = key();
const pool = key();
const baseVault = key();
const quoteVault = key();

interface Stored {
  data: Buffer;
  owner: PublicKey;
}

function hookPool(): Buffer {
  const data = Buffer.alloc(HOOK_POOL_LEN);
  HOOK_POOL_DISCRIMINATOR.copy(data, 0);
  config.toBuffer().copy(data, 72);
  key().toBuffer().copy(data, 104);
  mint.toBuffer().copy(data, 136);
  baseVault.toBuffer().copy(data, 168);
  quoteVault.toBuffer().copy(data, 200);
  return data;
}

async function rules(): Promise<Buffer> {
  return coder.accounts.encode("SaleRules", {
    mint,
    pool,
    base_vault: baseVault,
    issuer: key(),
    cap: new BN(1_000_000),
    access_mode: 0,
    credential: PublicKey.default,
    schema: PublicKey.default,
    price_account: PublicKey.default,
    price_feed_id: Array<number>(32).fill(0),
    price_shard: 0,
    band_bps: 0,
    max_price_age_secs: 0,
    max_conf_bps: 0,
    base_decimals: 6,
    quote_decimals: 6,
    buyers: 0,
    total_net_bought: new BN(0),
    bump: 255,
    layout_version: 2,
    quote_mint: PublicKey.default,
    ends_at: new BN(0),
    reserved: Array<number>(23).fill(0),
  });
}

async function chain(): Promise<Connection> {
  const accounts = new Map<string, Stored>([
    [saleRulesAddress(mint).toBase58(), { data: await rules(), owner: PANGU_PROGRAM_ID }],
    [pool.toBase58(), { data: hookPool(), owner: DBC_PROGRAM_ID }],
    [config.toBase58(), { data: LIVE_CONFIG, owner: DBC_PROGRAM_ID }],
  ]);
  const read = (address: PublicKey): AccountInfo<Buffer> | null => {
    const found = accounts.get(address.toBase58());
    return found === undefined
      ? null
      : { ...found, executable: false, lamports: 1_000_000, rentEpoch: 0 };
  };
  return {
    getAccountInfo: async (address: PublicKey) => read(address),
    getAccountInfoAndContext: async (address: PublicKey) => ({
      context: { slot: 400_000_000 },
      value: read(address),
    }),
    getProgramAccounts: async () => [],
    getSlot: async () => 400_000_000,
    getBlockTime: async () => 1_790_000_000,
    getLatestBlockhash: async () => ({ blockhash: key().toBase58(), lastValidBlockHeight: 1 }),
  } as unknown as Connection;
}

/** The floor the swap instruction itself carries: amount1, after the discriminator and amount0. */
function floorOnChain(transaction: Transaction): bigint {
  const swap = transaction.instructions.at(-1)!;
  expect(swap.programId.equals(DBC_PROGRAM_ID)).toBe(true);
  return swap.data.readBigUInt64LE(16);
}

beforeEach(() => {
  // A fresh quote of 9,000 with Meteora's own 1 percent floor at 8,910.
  vi.mocked(quoteExactIn).mockReset().mockReturnValue({
    outputAmount: 9_000n,
    minimumAmountOut: 8_910n,
    nextSqrtPrice: 1n << 64n,
  });
  vi.mocked(quotePartialFill).mockReset().mockReturnValue({
    outputAmount: 9_000n,
    amountLeft: 0n,
    nextSqrtPrice: 1n << 64n,
  });
  vi.mocked(hookAccounts).mockReset().mockResolvedValue([]);
});

describe("a buy with the floor the buyer was shown", () => {
  it("carries the fresh quote's own floor when the caller sets none", async () => {
    const buy = await buyTransaction({ connection: await chain(), buyer: wallet, mint, amountIn: 1_000n });
    expect(buy.minimumAmountOut).toBe(8_910n);
    expect(floorOnChain(buy.transaction)).toBe(8_910n);
  });

  it("carries the caller's floor instead of the fresh quote's", async () => {
    // The page showed 9,050 shares, so the buyer agreed to 1 percent under that.
    const buy = await buyTransaction({
      connection: await chain(),
      buyer: wallet,
      mint,
      amountIn: 1_000n,
      minimumAmountOut: 8_959n,
    });
    expect(buy.minimumAmountOut).toBe(8_959n);
    expect(buy.expectedAmountOut).toBe(9_000n);
    expect(floorOnChain(buy.transaction)).toBe(8_959n);
  });

  it("refuses to build when the fresh quote is already under the caller's floor", async () => {
    await expect(
      buyTransaction({
        connection: await chain(),
        buyer: wallet,
        mint,
        amountIn: 1_000n,
        minimumAmountOut: 9_001n,
      })
    ).rejects.toThrow(/the market moved: the buy now returns 9000 raw units, below the floor of 9001/);
  });

  it("builds at exactly the floor", async () => {
    const buy = await buyTransaction({
      connection: await chain(),
      buyer: wallet,
      mint,
      amountIn: 1_000n,
      minimumAmountOut: 9_000n,
    });
    expect(floorOnChain(buy.transaction)).toBe(9_000n);
  });

  it("carries the caller's floor on a partial fill, which otherwise has none", async () => {
    const connection = await chain();
    const open = await buyTransaction({ connection, buyer: wallet, mint, amountIn: 1_000n, fill: "partial" });
    expect(floorOnChain(open.transaction)).toBe(0n);
    const floored = await buyTransaction({
      connection,
      buyer: wallet,
      mint,
      amountIn: 1_000n,
      fill: "partial",
      minimumAmountOut: 8_900n,
    });
    expect(floorOnChain(floored.transaction)).toBe(8_900n);
  });

  it("refuses a floor below zero or of the wrong type", async () => {
    const connection = await chain();
    await expect(
      buyTransaction({ connection, buyer: wallet, mint, amountIn: 1_000n, minimumAmountOut: -1n })
    ).rejects.toThrow(/minimumAmountOut must not be below zero/);
    await expect(
      buyTransaction({
        connection,
        buyer: wallet,
        mint,
        amountIn: 1_000n,
        minimumAmountOut: "9000" as unknown as bigint,
      })
    ).rejects.toThrow(/minimumAmountOut must be a bigint/);
  });
});

describe("a sell with the floor the seller was shown", () => {
  it("carries the fresh quote's own floor when the caller sets none", async () => {
    const sell = await sellTransaction({ connection: await chain(), seller: wallet, mint, amountIn: 1_000n });
    expect(floorOnChain(sell.transaction)).toBe(8_910n);
  });

  it("carries the caller's floor instead of the fresh quote's", async () => {
    const sell = await sellTransaction({
      connection: await chain(),
      seller: wallet,
      mint,
      amountIn: 1_000n,
      minimumQuoteOut: 8_990n,
    });
    expect(sell.minimumAmountOut).toBe(8_990n);
    expect(floorOnChain(sell.transaction)).toBe(8_990n);
  });

  it("refuses to build when the fresh quote is already under the caller's floor", async () => {
    await expect(
      sellTransaction({
        connection: await chain(),
        seller: wallet,
        mint,
        amountIn: 1_000n,
        minimumQuoteOut: 9_500n,
      })
    ).rejects.toThrow(/the market moved: the sell now returns 9000 raw units, below the floor of 9500/);
  });

  it("refuses a floor below zero", async () => {
    await expect(
      sellTransaction({ connection: await chain(), seller: wallet, mint, amountIn: 1_000n, minimumQuoteOut: -5n })
    ).rejects.toThrow(/minimumQuoteOut must not be below zero/);
  });
});
