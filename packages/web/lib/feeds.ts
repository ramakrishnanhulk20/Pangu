/**
 * The Pyth feeds a banded sale on this page can follow, in the words a visitor
 * reads them in.
 *
 * The ids are copied from packages/scripts/src/feeds.ts rather than imported,
 * because that file pulls in the scripts package and a browser component reads
 * this one. A feed id is public and fixed, so a copy cannot drift.
 */

/** Apple's own share price. Pyth only publishes it while the US market is open. */
export const APPLE_EXCHANGE_FEED = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";

/** AAPLx, the tokenized Apple. It trades, and Pyth publishes it, all week. */
export const AAPLX_FEED = "978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675";

export interface FeedWords {
  /** The plain name: what the ceiling follows. */
  name: string;
  /** The short label on a number. */
  label: string;
  /** The price in a sentence, as in "5 percent over AAPLx's price". */
  price: string;
  /** The price with "a fresh" in front of it, as in "no fresh AAPLx price". */
  fresh: string;
  /** The sale, called by the price it follows. */
  sale: string;
}

const KNOWN: Record<string, FeedWords> = {
  [APPLE_EXCHANGE_FEED]: {
    name: "Apple's exchange price",
    label: "Apple, exchange price",
    price: "Apple's exchange price",
    fresh: "Apple exchange price",
    sale: "the exchange-price sale",
  },
  [AAPLX_FEED]: {
    name: "AAPLx, the tokenized Apple that trades all week",
    label: "AAPLx, trades all week",
    price: "AAPLx's price",
    fresh: "AAPLx price",
    sale: "the round-the-clock sale",
  },
};

const UNKNOWN: FeedWords = {
  name: "the stock's price, from Pyth",
  label: "the stock's price, from Pyth",
  price: "the stock's price",
  fresh: "stock price",
  sale: "this sale",
};

/** Accepts the id with or without a leading 0x, in either case. */
function normal(feedId: string): string {
  const lower = feedId.trim().toLowerCase();
  return lower.startsWith("0x") ? lower.slice(2) : lower;
}

/** The words for this feed. An id this page does not know gets neutral ones, never a guess. */
export function feedWords(feedId: string | null | undefined): FeedWords {
  if (feedId === null || feedId === undefined) {
    return UNKNOWN;
  }
  return KNOWN[normal(feedId)] ?? UNKNOWN;
}

export function isAppleExchange(feedId: string | null | undefined): boolean {
  return feedId !== null && feedId !== undefined && normal(feedId) === APPLE_EXCHANGE_FEED;
}

export function isAaplx(feedId: string | null | undefined): boolean {
  return feedId !== null && feedId !== undefined && normal(feedId) === AAPLX_FEED;
}
