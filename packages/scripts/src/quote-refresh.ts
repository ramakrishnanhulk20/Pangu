/**
 * One refresh of the production AAPL quote on devnet, and the numbers it wrote.
 *
 * Both feeds ride in one transaction, which is what lets a banded sale check
 * the price and whether the market is open from the same signed moment. The
 * transaction is built by `pangu-sdk/price` and sent past the node's dry run,
 * the way the measured runs in docs/measurements/price-band.md were sent.
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { DOLLAR_SCALE, decodeQuote } from "pangu-sdk";
import { refreshPriceTransaction } from "pangu-sdk/price";
import { AAPL_CLOCK_FEED_ID, AAPL_FEEDS, AAPL_PRICE_FEED_ID } from "./feeds.js";
import { send } from "./chain.js";
import { addressLink, transactionLink } from "./environment.js";

export interface QuoteRefresh {
  signature: string;
  link: string;
  quoteAccount: PublicKey;
  accountLink: string;
  /** The stock price in dollars. */
  price: number;
  /** Unix seconds of the last real market trade. */
  lastTradeUnix: number;
  secondsSinceTrade: number;
  ageSlots: number;
  signatures: number;
  bytes: number;
  fee: number;
  computeUnits: number;
}

/**
 * Writes a fresh AAPL price and market clock into the one account the banded
 * sales read, then reads the account back and returns what is in it.
 *
 * Throws when the account is missing after the write, or does not carry both
 * feeds, because either would mean the sale has nothing to price against.
 */
export async function refreshAaplQuote(
  connection: Connection,
  payer: Keypair
): Promise<QuoteRefresh> {
  const built = await refreshPriceTransaction({
    connection,
    payer: payer.publicKey,
    feeds: {
      queue: AAPL_FEEDS.queue,
      priceFeedId: AAPL_FEEDS.priceFeedId,
      clockFeedId: AAPL_FEEDS.clockFeedId,
      minOracles: AAPL_FEEDS.minOracles,
    },
  });

  const landed = await send(connection, "the price refresh", built.transaction, [payer], {
    skipPreflight: true,
  });

  const account = await connection.getAccountInfo(built.quoteAccount, "confirmed");
  if (account === null) {
    throw new Error("the quote account does not exist after the refresh");
  }
  const quote = decodeQuote(account.data);
  const price = quote.feeds.find((feed) => feed.id === AAPL_PRICE_FEED_ID);
  const clock = quote.feeds.find((feed) => feed.id === AAPL_CLOCK_FEED_ID);
  if (price === undefined || clock === undefined) {
    throw new Error("the refreshed quote does not carry both of the sale's feeds");
  }

  const currentSlot = await connection.getSlot("confirmed");
  const lastTradeUnix = Number(clock.value / DOLLAR_SCALE);
  return {
    signature: landed.signature,
    link: transactionLink(landed.signature),
    quoteAccount: built.quoteAccount,
    accountLink: addressLink(built.quoteAccount),
    price: Number(price.value) / Number(DOLLAR_SCALE),
    lastTradeUnix,
    secondsSinceTrade: Math.floor(Date.now() / 1000) - lastTradeUnix,
    ageSlots: currentSlot - Number(quote.slot),
    signatures: quote.signatures,
    bytes: built.bytes,
    fee: landed.fee,
    computeUnits: landed.computeUnits,
  };
}
