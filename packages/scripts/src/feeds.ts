/**
 * The production AAPL feeds a banded sale reads on devnet.
 *
 * All three values are public and fixed. A feed id is a hash of the whole job
 * definition in `packages/program/feeds/jobs.ts`, and the quote account's
 * address is derived from the queue and the two feed ids, so these numbers
 * change only when the feeds themselves are redefined. They were printed by
 * `scripts/wsl/feeds.sh ids` and are recorded in docs/measurements/price-band.md.
 */

import { PublicKey } from "@solana/web3.js";
import { canonicalQuoteAddress } from "pangu-sdk";

export const DEVNET_QUEUE = new PublicKey(
  "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7"
);

export const AAPL_PRICE_FEED_ID =
  "db4fa77aa3c4e909923c4767ae01f5d2a3d0c7138c953db372639122bdeceb3d";

export const AAPL_CLOCK_FEED_ID =
  "15ff868ad9e4b29e63e75b68a527df7d8f2fa83782938b233d03ea5e259d08c5";

/** The quorum the feeds themselves ask for, from jobs.ts MIN_ORACLE_SAMPLES. */
export const MIN_ORACLES = 1;

/** A quote at most this old, in slots. The program's own ceiling is 400. */
export const MAX_PRICE_AGE_SLOTS = 400;

/**
 * How long after the last real trade a banded sale stays open, in seconds.
 * One hour: long enough to ride out a quiet minute in the market, short enough
 * that the sale shuts overnight and at weekends.
 */
export const MAX_MARKET_AGE_SECS = 3_600;

export const AAPL_FEEDS = {
  queue: DEVNET_QUEUE,
  priceFeedId: AAPL_PRICE_FEED_ID,
  clockFeedId: AAPL_CLOCK_FEED_ID,
  minOracles: MIN_ORACLES,
} as const;

/** The one account these two feeds can ever write to. */
export function aaplQuoteAccount(): PublicKey {
  return canonicalQuoteAddress(DEVNET_QUEUE, [
    AAPL_PRICE_FEED_ID,
    AAPL_CLOCK_FEED_ID,
  ]);
}

/** The band a `--band <bps>` launch writes into the sale's rules. */
export function aaplBand(bps: number) {
  return {
    bps,
    priceQueue: DEVNET_QUEUE,
    priceFeedId: AAPL_PRICE_FEED_ID,
    clockFeedId: AAPL_CLOCK_FEED_ID,
    maxPriceAgeSlots: MAX_PRICE_AGE_SLOTS,
    maxMarketAgeSecs: MAX_MARKET_AGE_SECS,
    minOracles: MIN_ORACLES,
  };
}
