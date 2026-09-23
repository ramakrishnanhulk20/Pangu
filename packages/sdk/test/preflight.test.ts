// The order preflightBuy judges a buy in, against chain state that is handed to
// it rather than read. handle_execute checks the price band before the cap, so a
// buy that breaks both has to be told PriceOutsideBand and not OverCap.
//
// Does NOT cover: the reads themselves. Every account this stands in for here is
// decoded from real devnet bytes elsewhere, and the whole path is run against
// Meteora's and Pyth's live programs by fork-test/life.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, type Connection } from "@solana/web3.js";
import type { PoolView } from "../src/dbc/state.js";
import type { Sale, BuyerRecord } from "../src/accounts.js";
import type { PriceReading } from "../src/feed.js";

vi.mock("../src/dbc/state.js", () => ({ loadPool: vi.fn() }));
vi.mock("../src/accounts.js", () => ({ getBuyerRecord: vi.fn() }));
vi.mock("../src/feed.js", () => ({ readPrice: vi.fn() }));
vi.mock("../src/dbc/quote.js", () => ({ quoteExactOut: vi.fn() }));

const { loadPool } = await import("../src/dbc/state.js");
const { getBuyerRecord } = await import("../src/accounts.js");
const { readPrice } = await import("../src/feed.js");
const { quoteExactOut } = await import("../src/dbc/quote.js");
const { preflightBuy } = await import("../src/dbc/preflight.js");

const mint = Keypair.generate().publicKey;
const buyer = Keypair.generate().publicKey;
const NO_CHAIN = {} as Connection;

/** A whole dollar scaled the way every price in the package is, by 1e18. */
const DOLLAR = 10n ** 18n;

const sale = {
  mint,
  cap: 1_000_000n,
  accessMode: 0,
  bandBps: 500,
  baseDecimals: 6,
  quoteDecimals: 6,
  hasBand: true,
} as unknown as Sale;

const record = {
  mint,
  wallet: buyer,
  approved: true,
  netBought: 0n,
  bump: 255,
} as BuyerRecord;

const price = {
  address: Keypair.generate().publicKey,
  price: 100n * DOLLAR,
  priceDollars: 100,
  publishTime: 1_700_000_000,
  ageSecs: 2,
  confBps: 5,
  fullyVerified: true,
  usable: true,
  error: null,
  reason: null,
} as PriceReading;

beforeEach(() => {
  vi.mocked(loadPool).mockResolvedValue({ sale } as unknown as PoolView);
  vi.mocked(getBuyerRecord).mockResolvedValue(record);
  vi.mocked(readPrice).mockResolvedValue(price);
  // A Q64.64 square root price of 14 is a curve price of 196 dollars a share,
  // well past the 105 the band allows over a 100 dollar stock.
  vi.mocked(quoteExactOut).mockReturnValue({
    outputAmount: 0n,
    nextSqrtPrice: 14n << 64n,
  });
});

describe("a buy that breaks two rules at once", () => {
  it("names the band, the refusal the hook would give, and still reports cap room", async () => {
    const answer = await preflightBuy({
      connection: NO_CHAIN,
      buyer,
      mint,
      amountOut: 5_000_000n,
    });

    expect(answer.ok).toBe(false);
    expect(answer.error).toBe("PriceOutsideBand");
    expect(answer.capRoom).toBe(1_000_000n);
    expect(answer.curvePrice).toBe(196n * DOLLAR);
    expect(answer.ceiling).toBe(105n * DOLLAR);
  });
});

describe("a first buy, with no record yet", () => {
  beforeEach(() => {
    vi.mocked(getBuyerRecord).mockResolvedValue(null);
  });

  it("is refused for the missing record when the caller does not open one", async () => {
    const answer = await preflightBuy({ connection: NO_CHAIN, buyer, mint, amountOut: 1_000n });

    expect(answer.error).toBe("BuyerRecordMissing");
    expect(answer.recordOpensInThisBuy).toBe(false);
    expect(answer.curvePrice).toBeNull();
  });

  it("gets the band answer when the buy opens the record itself", async () => {
    const answer = await preflightBuy({
      connection: NO_CHAIN,
      buyer,
      mint,
      amountOut: 1_000n,
      openingRecord: true,
    });

    expect(answer.error).toBe("PriceOutsideBand");
    expect(answer.recordOpensInThisBuy).toBe(true);
    expect(answer.capRoom).toBe(1_000_000n);
    expect(answer.ceiling).toBe(105n * DOLLAR);
  });

  it("passes inside the band with the whole cap as room, and says the record opens here", async () => {
    // A square root price of 10 is 100 dollars a share, under the 105 ceiling.
    vi.mocked(quoteExactOut).mockReturnValue({
      outputAmount: 0n,
      nextSqrtPrice: 10n << 64n,
    });
    const answer = await preflightBuy({
      connection: NO_CHAIN,
      buyer,
      mint,
      amountOut: 1_000n,
      openingRecord: true,
    });

    expect(answer.ok).toBe(true);
    expect(answer.capRoom).toBe(1_000_000n);
    expect(answer.recordOpensInThisBuy).toBe(true);
    expect(
      (await preflightBuy({
        connection: NO_CHAIN,
        buyer,
        mint,
        amountOut: 1_000_001n,
        openingRecord: true,
      })).error
    ).toBe("OverCap");
  });
});
