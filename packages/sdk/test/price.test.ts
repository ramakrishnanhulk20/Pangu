// The band maths and the quote reader, checked against the two things that can
// settle them: the vectors in the program's own Rust tests
// (programs/pangu/src/price.rs) and the real devnet quote bytes a Switchboard
// oracle signed, saved at packages/program/feeds/live-quote.bin.
//
// Does NOT cover: the oracle signature check and the slot hash check. Both live
// in the hook and neither can be redone from the account's bytes alone. It also
// does not cover readPrice's network path, which the fork and devnet runs prove.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import {
  DOLLAR_SCALE,
  canonicalQuoteAddress,
  curvePriceDollars,
  decodeQuote,
  priceCeiling,
} from "../src/index.js";
import { PanguInputError } from "../src/inputs.js";

/** DBC's own square root price for a one to one raw ratio. */
const SQRT_ONE = 1n << 64n;
const ONE_DOLLAR = DOLLAR_SCALE;

const here = dirname(fileURLToPath(import.meta.url));
const LIVE_QUOTE = new Uint8Array(
  readFileSync(join(here, "..", "..", "program", "feeds", "live-quote.bin"))
);

// The same four constants price.rs pins its live test to.
const LIVE_QUEUE = "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7";
const LIVE_QUOTE_ACCOUNT = "7uPLLyB29H9sATzjKi1DKWgqD2YXrjp8YS8QpEZi5b1Z";
const LIVE_PRICE_FEED =
  "db4fa77aa3c4e909923c4767ae01f5d2a3d0c7138c953db372639122bdeceb3d";
const LIVE_CLOCK_FEED =
  "15ff868ad9e4b29e63e75b68a527df7d8f2fa83782938b233d03ea5e259d08c5";

describe("the curve price", () => {
  it("is one dollar for a one to one curve with equal decimals", () => {
    expect(curvePriceDollars(SQRT_ONE, 6, 6)).toBe(ONE_DOLLAR);
  });

  it("rises with extra base decimals and falls with extra quote decimals", () => {
    expect(curvePriceDollars(SQRT_ONE, 9, 6)).toBe(1_000n * ONE_DOLLAR);
    expect(curvePriceDollars(SQRT_ONE, 6, 9)).toBe(ONE_DOLLAR / 1_000n);
  });

  it("always rounds a fraction of a unit up", () => {
    expect(curvePriceDollars(SQRT_ONE - 1n, 6, 6)).toBe(ONE_DOLLAR);
  });

  it("holds the widest square root price DBC allows", () => {
    const widest = 79_226_673_521_066_979_257_578_248_091n;
    expect(curvePriceDollars(widest, 18, 0) > 0n).toBe(true);
  });

  it("refuses decimals past the program's limit", () => {
    expect(() => curvePriceDollars(SQRT_ONE, 19, 6)).toThrow(PanguInputError);
    expect(() => curvePriceDollars(SQRT_ONE, 6, 19)).toThrow(PanguInputError);
  });
});

describe("the band ceiling", () => {
  it("widens by the band and rounds down", () => {
    expect(priceCeiling({ bandBps: 500 }, 100n * ONE_DOLLAR)).toBe(105n * ONE_DOLLAR);
    // 3 times 10001 is 30003, and a ten thousandth of that rounds down to 3.
    expect(priceCeiling({ bandBps: 1 }, 3n)).toBe(3n);
  });

  it("refuses a price of zero or less, and a sale with no band", () => {
    expect(() => priceCeiling({ bandBps: 100 }, 0n)).toThrow(PanguInputError);
    expect(() => priceCeiling({ bandBps: 100 }, -1n)).toThrow(PanguInputError);
    expect(() => priceCeiling({ bandBps: 0 }, ONE_DOLLAR)).toThrow(PanguInputError);
  });
});

describe("the live devnet quote", () => {
  it("reads through this package's own decoder", () => {
    const quote = decodeQuote(LIVE_QUOTE);
    expect(quote.queue.toBase58()).toBe(LIVE_QUEUE);
    expect(quote.signatures >= 1).toBe(true);

    const price = quote.feeds.find((feed) => feed.id === LIVE_PRICE_FEED);
    const clock = quote.feeds.find((feed) => feed.id === LIVE_CLOCK_FEED);
    expect(price).toBeDefined();
    expect(clock).toBeDefined();

    // A three figure stock, not a three trillion figure one.
    expect(price!.value > 0n && price!.value < 10_000n * DOLLAR_SCALE).toBe(true);

    const tradedAt = Number(clock!.value / DOLLAR_SCALE);
    expect(tradedAt > 1_780_000_000 && tradedAt < 2_000_000_000).toBe(true);
  });

  it("sits at the one address its queue and feeds can produce", () => {
    expect(
      canonicalQuoteAddress(new PublicKey(LIVE_QUEUE), [
        LIVE_PRICE_FEED,
        LIVE_CLOCK_FEED,
      ]).toBase58()
    ).toBe(LIVE_QUOTE_ACCOUNT);
  });

  it("prices the ceiling above the stock price it carries", () => {
    const quote = decodeQuote(LIVE_QUOTE);
    const price = quote.feeds.find((feed) => feed.id === LIVE_PRICE_FEED)!;
    expect(priceCeiling({ bandBps: 1_000 }, price.value) > price.value).toBe(true);
  });

  it("refuses bytes that are cut short or are not a quote", () => {
    for (const length of [0, 8, 41, 42, 100]) {
      expect(() => decodeQuote(LIVE_QUOTE.slice(0, length))).toThrow(PanguInputError);
    }
    expect(() => decodeQuote(new Uint8Array(200))).toThrow(PanguInputError);
  });
});
