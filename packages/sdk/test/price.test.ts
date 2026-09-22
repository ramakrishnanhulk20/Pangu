// The band maths and the Pyth price reader, checked against the two things that
// can settle them: the vectors in the program's own Rust tests
// (programs/pangu/src/price.rs) and the real bytes Pyth's receiver program wrote
// on devnet, saved at packages/program/feeds/live-price.bin.
//
// Does NOT cover: the Wormhole guardian signatures behind those bytes. Nothing
// off chain can redo them, and Pangu does not either: it relies on the account
// being a program address of Pyth's price feed program owned by the receiver
// program that checks them. It also does not cover a real RPC. The connection
// here is a stand-in that answers with bytes.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey, SYSVAR_CLOCK_PUBKEY, type Connection } from "@solana/web3.js";
import {
  DOLLAR_SCALE,
  confidenceBps,
  curvePriceDollars,
  decodePriceUpdate,
  priceCeiling,
  priceFeedAddress,
  readPrice,
  stockPriceDollars,
  PANGU_SHARD_ID,
  PYTH_RECEIVER_PROGRAM_ID,
  type Sale,
} from "../src/index.js";
import { PanguInputError } from "../src/inputs.js";

/** DBC's own square root price for a one to one raw ratio. */
const SQRT_ONE = 1n << 64n;
const ONE_DOLLAR = DOLLAR_SCALE;

const here = dirname(fileURLToPath(import.meta.url));
const LIVE_PRICE = new Uint8Array(
  readFileSync(join(here, "..", "..", "program", "feeds", "live-price.bin"))
);

// The same constants price.rs pins its live test to.
const LIVE_FEED_ID =
  "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
const LIVE_PRICE_ACCOUNT = "9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb";
/** The second Pyth's publishers agreed this price, out of the account itself. */
const LIVE_PUBLISH_TIME = 1_790_078_987;

function bandedSale(over: Partial<Sale> = {}): Sale {
  return {
    mint: PublicKey.default,
    pool: PublicKey.default,
    baseVault: PublicKey.default,
    issuer: PublicKey.default,
    cap: 1_000n,
    accessMode: 0,
    credential: PublicKey.default,
    schema: PublicKey.default,
    priceAccount: priceFeedAddress(LIVE_FEED_ID, PANGU_SHARD_ID),
    bandBps: 1_000,
    priceFeedId: LIVE_FEED_ID,
    priceShard: PANGU_SHARD_ID,
    maxPriceAgeSecs: 60,
    maxConfBps: 100,
    baseDecimals: 6,
    quoteDecimals: 6,
    buyers: 0,
    totalNetBought: 0n,
    bump: 255,
    reserved: new Uint8Array(63),
    hasBand: true,
    ...over,
  };
}

/** A chain that answers with these bytes for the price account and this clock. */
function chainWith(
  data: Uint8Array | null,
  owner: PublicKey,
  now: number,
  address: PublicKey
): Connection {
  const clock = Buffer.alloc(40);
  clock.writeBigInt64LE(BigInt(now), 32);
  return {
    getMultipleAccountsInfo: async (keys: PublicKey[]) =>
      keys.map((wanted) => {
        if (wanted.equals(SYSVAR_CLOCK_PUBKEY)) {
          return { data: clock, owner: SYSVAR_CLOCK_PUBKEY, executable: false, lamports: 1, rentEpoch: 0 };
        }
        if (wanted.equals(address) && data !== null) {
          return {
            data: Buffer.from(data),
            owner,
            executable: false,
            lamports: 1,
            rentEpoch: 0,
          };
        }
        return null;
      }),
  } as unknown as Connection;
}

const live = (sale: Sale, now: number, data: Uint8Array = LIVE_PRICE) =>
  readPrice(chainWith(data, PYTH_RECEIVER_PROGRAM_ID, now, sale.priceAccount), sale);

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

describe("Pyth's own numbers on Pangu's scale", () => {
  it("reads an equity exponent and a tokenised one as the same dollars", () => {
    // 30592000 at 10^-5 is 305.92 dollars, and so is 30592000000 at 10^-8.
    expect(stockPriceDollars(30_592_000n, -5)).toBe((30_592n * ONE_DOLLAR) / 100n);
    expect(stockPriceDollars(30_592_000_000n, -8)).toBe(
      stockPriceDollars(30_592_000n, -5)
    );
  });

  it("refuses a price or an exponent no dollar price can carry", () => {
    expect(() => stockPriceDollars(0n, -5)).toThrow(PanguInputError);
    expect(() => stockPriceDollars(-1n, -5)).toThrow(PanguInputError);
    expect(() => stockPriceDollars(1n, 1)).toThrow(PanguInputError);
    expect(() => stockPriceDollars(1n, -19)).toThrow(PanguInputError);
  });

  it("counts the confidence interval in basis points and rounds it up", () => {
    // AAPL at 305.92 with a two cent interval is under one basis point, and
    // rounding up makes that one rather than none.
    expect(confidenceBps(30_592_000n, 2_000n)).toBe(1n);
    expect(confidenceBps(10_000n, 100n)).toBe(100n);
    expect(confidenceBps(10_000n, 101n)).toBe(101n);
    expect(confidenceBps(30_592_000n, 0n)).toBe(0n);
  });
});

describe("the live devnet price account", () => {
  it("reads through this package's own decoder", () => {
    const update = decodePriceUpdate(LIVE_PRICE);
    expect(LIVE_PRICE.length).toBe(134);
    expect(update.feedId).toBe(LIVE_FEED_ID);
    expect(update.fullyVerified).toBe(true);
    expect(update.exponent).toBe(-5);
    expect(update.publishTime).toBe(LIVE_PUBLISH_TIME);
    expect(update.postedSlot > 0n).toBe(true);

    // A three figure stock, not a three trillion figure one.
    const price = stockPriceDollars(update.price, update.exponent);
    expect(price > 100n * ONE_DOLLAR && price < 10_000n * ONE_DOLLAR).toBe(true);
    expect(priceCeiling({ bandBps: 1_000 }, price) > price).toBe(true);
  });

  it("sits at the one address Pangu's shard and this feed can produce", () => {
    expect(priceFeedAddress(LIVE_FEED_ID, PANGU_SHARD_ID).toBase58()).toBe(
      LIVE_PRICE_ACCOUNT
    );
  });

  it("refuses bytes that are cut short, or are not a price update", () => {
    // 133 is not in the list on purpose: the account's last byte is padding,
    // nothing reads it, and a 133 byte account really is readable.
    for (const length of [0, 7, 8, 40, 41, 72, 124, 132]) {
      expect(() => decodePriceUpdate(LIVE_PRICE.slice(0, length))).toThrow(
        PanguInputError
      );
    }
    const flipped = Uint8Array.from(LIVE_PRICE);
    flipped.set([(LIVE_PRICE[0] ?? 0) ^ 0x01], 0);
    expect(() => decodePriceUpdate(flipped)).toThrow(/not a Pyth price feed account/);
  });

  it("refuses a verification level Pyth does not write", () => {
    const strange = Uint8Array.from(LIVE_PRICE);
    strange[40] = 2;
    expect(() => decodePriceUpdate(strange)).toThrow(/verification level/);
  });
});

describe("reading the price the way the hook reads it", () => {
  it("calls the live price usable while it is inside the sale's age", async () => {
    const sale = bandedSale();
    const reading = await live(sale, LIVE_PUBLISH_TIME + 30);
    expect(reading.usable).toBe(true);
    expect(reading.error).toBeNull();
    expect(reading.ageSecs).toBe(30);
    expect(reading.confBps).toBe(3);
    expect(reading.priceDollars).toBeCloseTo(339.96, 2);
    expect(reading.address.toBase58()).toBe(LIVE_PRICE_ACCOUNT);
  });

  it("goes stale on its own when nobody refreshes it, which is a shut market", async () => {
    const sale = bandedSale();
    expect((await live(sale, LIVE_PUBLISH_TIME + 60)).usable).toBe(true);
    const old = await live(sale, LIVE_PUBLISH_TIME + 61);
    expect(old.usable).toBe(false);
    expect(old.error).toBe("PriceStale");
    expect(old.reason).toMatch(/too old/);
  });

  it("refuses a price published further ahead than the clocks can differ", async () => {
    const sale = bandedSale();
    expect((await live(sale, LIVE_PUBLISH_TIME - 60)).usable).toBe(true);
    expect((await live(sale, LIVE_PUBLISH_TIME - 61)).error).toBe("PriceStale");
  });

  it("refuses a confidence interval wider than this sale accepts", async () => {
    const tight = bandedSale({ maxConfBps: 2 });
    const reading = await live(tight, LIVE_PUBLISH_TIME);
    expect(reading.error).toBe("PriceTooUncertain");
    // The price itself is fine and still readable, which is what the reason says.
    expect(reading.price > 0n).toBe(true);
  });

  it("refuses a partly verified update even with every other byte off the chain", async () => {
    const downgraded = Uint8Array.from(LIVE_PRICE);
    downgraded[40] = 0;
    const reading = await live(bandedSale(), LIVE_PUBLISH_TIME, downgraded);
    expect(reading.error).toBe("PriceNotFullyVerified");
    expect(reading.usable).toBe(false);
  });

  it("refuses an account for another feed, or one nobody has written yet", async () => {
    const stranger = bandedSale({
      priceFeedId: `${"11".repeat(31)}22`,
      priceAccount: priceFeedAddress(`${"11".repeat(31)}22`, PANGU_SHARD_ID),
    });
    const chain = chainWith(
      LIVE_PRICE,
      PYTH_RECEIVER_PROGRAM_ID,
      LIVE_PUBLISH_TIME,
      stranger.priceAccount
    );
    expect((await readPrice(chain, stranger)).error).toBe("WrongPriceAccount");

    const sale = bandedSale();
    const empty = chainWith(null, PYTH_RECEIVER_PROGRAM_ID, LIVE_PUBLISH_TIME, sale.priceAccount);
    expect((await readPrice(empty, sale)).error).toBe("PriceStale");
  });

  it("refuses an account at the right address that Pyth's receiver does not own", async () => {
    const sale = bandedSale();
    const chain = chainWith(
      LIVE_PRICE,
      PublicKey.default,
      LIVE_PUBLISH_TIME,
      sale.priceAccount
    );
    expect((await readPrice(chain, sale)).error).toBe("WrongPriceAccount");
  });

  it("refuses rules whose address and feed id do not agree", async () => {
    // The rules carry both, and the program derived one from the other when the
    // sale opened. If they ever disagree here, the bytes at that address are not
    // this sale's price.
    const crooked = bandedSale({ priceShard: PANGU_SHARD_ID + 1 });
    const chain = chainWith(
      LIVE_PRICE,
      PYTH_RECEIVER_PROGRAM_ID,
      LIVE_PUBLISH_TIME,
      crooked.priceAccount
    );
    expect((await readPrice(chain, crooked)).error).toBe("WrongPriceAccount");
  });

  it("refuses to read a sale that has no band at all", async () => {
    const plain = bandedSale({ hasBand: false, bandBps: 0 });
    const chain = chainWith(null, PYTH_RECEIVER_PROGRAM_ID, LIVE_PUBLISH_TIME, plain.priceAccount);
    await expect(readPrice(chain, plain)).rejects.toThrow(/no price band/);
  });
});
