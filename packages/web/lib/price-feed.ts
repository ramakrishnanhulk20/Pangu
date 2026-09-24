"use server";

import { SYSVAR_CLOCK_PUBKEY, type AccountInfo } from "@solana/web3.js";
import {
  LIMITS,
  PANGU_SHARD_ID,
  PYTH_RECEIVER_PROGRAM_ID,
  decodePriceUpdate,
  dollars,
  priceFeedAddress,
  stockPriceDollars,
} from "pangu-sdk";

import { AAPLX_FEED, APPLE_EXCHANGE_FEED } from "./feeds";
import type { FeedChoice, StockReading } from "./launch";
import { CHAIN } from "./network";
import { chainConnection } from "./solana";

/*
 * The launch preview's stock price, read straight from Pyth's price accounts
 * on the server, so it works on a network where this app has opened no banded
 * sale yet, mainnet included. A server function is a public endpoint, so the
 * answer is shared for ten seconds however many visitors ask, and it takes no
 * input but the feed's name.
 */

export interface FeedAnswer {
  reading: StockReading | null;
  reason: string | null;
}

export type FeedPrices = Record<FeedChoice, FeedAnswer>;

const FEEDS: Record<FeedChoice, string> = { apple: APPLE_EXCHANGE_FEED, aaplx: AAPLX_FEED };

// Pangu's own shard is what a sale's band reads, so it is asked first. Pyth's
// sponsored shard 0 carries the same feed and is there on a network where
// Pangu's refresher has never posted.
const SHARDS = [PANGU_SHARD_ID, 0] as const;

/** Bytes 32 to 40 of the Clock sysvar: the chain's unix time. */
const CLOCK_UNIX_TIMESTAMP_OFFSET = 32;

const FRESH_MS = 10_000;

let held: { at: number; answer: Promise<FeedPrices> } | null = null;

interface Candidate {
  price: number;
  publishTime: number;
}

function candidateOf(info: AccountInfo<Buffer> | null, feedId: string): Candidate | null {
  if (info === null || !info.owner.equals(PYTH_RECEIVER_PROGRAM_ID)) {
    return null;
  }
  try {
    const update = decodePriceUpdate(info.data);
    if (!update.fullyVerified || update.feedId !== feedId || update.price <= 0n) {
      return null;
    }
    return { price: dollars(stockPriceDollars(update.price, update.exponent)), publishTime: update.publishTime };
  } catch {
    return null;
  }
}

async function readAll(): Promise<FeedPrices> {
  const choices = Object.keys(FEEDS) as FeedChoice[];
  const addresses = choices.flatMap((choice) => SHARDS.map((shard) => priceFeedAddress(FEEDS[choice], shard)));
  let infos: (AccountInfo<Buffer> | null)[];
  try {
    infos = await chainConnection().getMultipleAccountsInfo([...addresses, SYSVAR_CLOCK_PUBKEY], "confirmed");
  } catch {
    // The error can carry the server's keyed RPC address, so it never leaves here.
    const failed = { reading: null, reason: `${CHAIN.atStart} did not answer the price read. It is asked again in a few seconds.` };
    return { apple: failed, aaplx: failed };
  }
  const clock = infos.at(-1) ?? null;
  const now =
    clock !== null && clock.data.length >= CLOCK_UNIX_TIMESTAMP_OFFSET + 8
      ? Number(clock.data.readBigInt64LE(CLOCK_UNIX_TIMESTAMP_OFFSET))
      : Math.floor(Date.now() / 1000);

  const prices = {} as FeedPrices;
  choices.forEach((choice, place) => {
    const found = SHARDS.map((_, shard) => candidateOf(infos[place * SHARDS.length + shard] ?? null, FEEDS[choice]))
      .filter((candidate): candidate is Candidate => candidate !== null)
      .sort((left, right) => right.publishTime - left.publishTime)[0];
    prices[choice] =
      found === undefined
        ? { reading: null, reason: `Pyth has no price account for this feed on ${CHAIN.inSentence} yet.` }
        : {
            reading: {
              price: found.price,
              publishTime: found.publishTime,
              stale: now - found.publishTime > LIMITS.maxPriceAgeSecs,
            },
            reason: null,
          };
  });
  return prices;
}

/** Every feed the launch form offers, each from the freshest Pyth account that carries it. */
export async function readFeedPrices(): Promise<FeedPrices> {
  const now = Date.now();
  if (held === null || now - held.at >= FRESH_MS) {
    const entry = { at: now, answer: readAll() };
    held = entry;
    void entry.answer.then((prices) => {
      // A failed read is not kept, so the next ask tries the chain again.
      if (prices.apple.reading === null && prices.aaplx.reading === null && held === entry) {
        held = null;
      }
    });
  }
  return held.answer;
}
