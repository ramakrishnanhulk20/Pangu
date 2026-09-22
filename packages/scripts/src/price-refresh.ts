/**
 * One refresh of a Pyth price on Pangu's own shard on devnet, and the numbers
 * it wrote.
 *
 * The transactions are built by `pangu-sdk/price`, which reads the Hermes key
 * out of the environment, and sent past the node's dry run. It takes two of
 * them: the guardian-signed update is posted into a holding account first and
 * the price account is written from it second. The last one closes the holding
 * account again, which is the difference between a refresh costing about 35
 * thousand lamports and about 2.4 million.
 */

import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  confidenceBps,
  decodePriceUpdate,
  stockPriceDollars,
  DOLLAR_SCALE,
  PYTH_RECEIVER_PROGRAM_ID,
} from "pangu-sdk";
import { refreshPriceTransaction } from "pangu-sdk/price";
import { send } from "./chain.js";
import { addressLink, transactionLink } from "./environment.js";
import { feedFor, type PythFeed } from "./feeds.js";

export interface PriceRefresh {
  feed: PythFeed;
  signatures: string[];
  links: string[];
  priceAccount: PublicKey;
  accountLink: string;
  /** The stock price in dollars. */
  price: number;
  /** Unix seconds Pyth's publishers agreed it. */
  publishTime: number;
  secondsOld: number;
  /** Pyth's confidence interval, in basis points of the price. */
  confBps: number;
  fullyVerified: boolean;
  bytes: number;
  /** Lamports the payer is down by, net of the rent this reclaimed. */
  spent: number;
  computeUnits: number;
}

/**
 * Writes a fresh stock price into the one account a banded sale reads, then
 * reads the account back and returns what is in it.
 *
 * Throws when the account is missing afterwards, is not owned by Pyth's
 * receiver program, or carries another feed, because each of those means the
 * sale has nothing to price against.
 */
export async function refreshFeedPrice(
  connection: Connection,
  payer: Keypair,
  symbol: string
): Promise<PriceRefresh> {
  const feed = feedFor(symbol);
  const started = await connection.getBalance(payer.publicKey, "confirmed");

  const built = await refreshPriceTransaction({
    connection,
    payer: payer.publicKey,
    feed: { priceFeedId: feed.id },
  });

  const signatures: string[] = [];
  let computeUnits = 0;
  for (const [index, entry] of built.transactions.entries()) {
    const landed = await send(
      connection,
      `the price refresh, transaction ${index + 1}`,
      entry.transaction,
      [payer, ...entry.signers],
      { skipPreflight: true }
    );
    signatures.push(landed.signature);
    computeUnits += landed.computeUnits;
  }

  const account = await connection.getAccountInfo(built.priceAccount, "confirmed");
  if (account === null) {
    throw new Error("the price account does not exist after the refresh");
  }
  if (!account.owner.equals(PYTH_RECEIVER_PROGRAM_ID)) {
    throw new Error(
      `the price account is owned by ${account.owner.toBase58()}, not by Pyth's receiver`
    );
  }
  const update = decodePriceUpdate(account.data);
  if (update.feedId !== feed.id) {
    throw new Error(`this account carries feed 0x${update.feedId}, not ${feed.symbol}`);
  }

  const price = stockPriceDollars(update.price, update.exponent);
  return {
    feed,
    signatures,
    links: signatures.map((signature) => transactionLink(signature)),
    priceAccount: built.priceAccount,
    accountLink: addressLink(built.priceAccount),
    price: Number(price) / Number(DOLLAR_SCALE),
    publishTime: update.publishTime,
    secondsOld: Math.floor(Date.now() / 1000) - update.publishTime,
    confBps: Number(confidenceBps(update.price, update.conf)),
    fullyVerified: update.fullyVerified,
    bytes: built.bytes,
    spent: started - (await connection.getBalance(payer.publicKey, "confirmed")),
    computeUnits,
  };
}
