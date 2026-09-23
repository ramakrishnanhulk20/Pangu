/**
 * The Pyth feeds a banded devnet sale can be opened against.
 *
 * A feed id is public and fixed, and the price account's address comes from it
 * and the shard id, so an issuer can write the address into a sale's rules
 * before anybody has ever refreshed it. The ids were read from Pyth's own
 * keyless feed search endpoint and are recorded in
 * packages/program/feeds/pyth-feeds.ts.
 */

import { PublicKey } from "@solana/web3.js";
import { PANGU_SHARD_ID, priceFeedAddress } from "pangu-sdk";

export interface PythFeed {
  /** What Pyth calls it. */
  symbol: string;
  /** What a person calls it. */
  name: string;
  /** 32 bytes as hex, no leading 0x. */
  id: string;
}

/**
 * The feeds a sale can use today.
 *
 * The `Equity.US.*` ones are the real share prices and only publish during the
 * US market's sessions, which is what makes a banded sale shut overnight: the
 * account stops moving and ages out. The `Crypto.*X` ones track the tokenised
 * versions of the same shares and publish around the clock, so a sale banded
 * against one of those stays open at weekends. They are a different instrument
 * and carry their own basis risk.
 */
export const FEEDS: PythFeed[] = [
  {
    symbol: "Equity.US.AAPL/USD",
    name: "Apple",
    id: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  },
  {
    symbol: "Equity.US.TSLA/USD",
    name: "Tesla",
    id: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  },
  {
    symbol: "Equity.US.NVDA/USD",
    name: "Nvidia",
    id: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
  },
  {
    symbol: "Equity.US.SPY/USD",
    name: "S and P 500 tracker",
    id: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
  },
  {
    symbol: "Crypto.AAPLX/USD",
    name: "Apple, tokenised",
    id: "978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675",
  },
  {
    symbol: "Crypto.TSLAX/USD",
    name: "Tesla, tokenised",
    id: "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362",
  },
];

/** The feed a command uses when none is named. */
export const DEFAULT_FEED = "Equity.US.AAPL/USD";

/**
 * How old a published price may be on a buy, in seconds. One hour, which is the
 * most the program allows.
 *
 * It is the demo's own limit, not a limit of the band: a tighter one is safer
 * and is what a real sale would set, but a whole `prove` run has to fit inside
 * one refresh, and that run sends dozens of transactions to a public devnet
 * node. The freshness rule is the market clock as well, so an hour is also how
 * long after the closing bell a banded sale keeps taking buys.
 */
export const MAX_PRICE_AGE_SECS = 3_600;

/**
 * The widest confidence interval a banded demo sale buys against: one percent.
 * Wide for a liquid stock and tight enough to be a real rule.
 */
export const MAX_CONF_BPS = 100;

/** The feed for a symbol, or a readable failure naming what is on offer. */
export function feedFor(symbol: string): PythFeed {
  const found = FEEDS.find(
    (feed) => feed.symbol.toLowerCase() === symbol.toLowerCase()
  );
  if (found === undefined) {
    throw new Error(
      `no feed called ${symbol}. Try one of: ${FEEDS.map((each) => each.symbol).join(", ")}`
    );
  }
  return found;
}

/** The one account this feed's price lives at on Pangu's own shard. */
export function feedPriceAccount(feed: PythFeed): PublicKey {
  return priceFeedAddress(feed.id, PANGU_SHARD_ID);
}

/** The band a `--band <bps>` launch writes into the sale's rules. */
export function bandFor(feed: PythFeed, bps: number) {
  return {
    bps,
    priceFeedId: feed.id,
    shard: PANGU_SHARD_ID,
    maxPriceAgeSecs: MAX_PRICE_AGE_SECS,
    maxConfBps: MAX_CONF_BPS,
  };
}
