/**
 * Keeping a banded sale's price fresh.
 *
 * Node and server only. It reaches Pyth's Hermes service over the network with
 * an API key, and it pulls in `@pythnetwork/pyth-solana-receiver`, so the web
 * app calls it from a server route and never from the browser. The key would be
 * in every browser bundle otherwise, and every Hermes read has needed one since
 * 26 August 2026
 * (https://docs.pyth.network/price-feeds/core/upgrade/preparing). Reading a price back is
 * `readPrice` in the core entry point, which is browser safe.
 */

import type { Connection, PublicKey, Signer, VersionedTransaction } from "@solana/web3.js";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import type { Sale } from "./accounts.js";
import { feedIdHex, priceFeedAddress, type FeedId } from "./addresses.js";
import { LIMITS, PANGU_SHARD_ID } from "./constants.js";
import {
  PanguInputError,
  requireRealPublicKey,
  requireWholeNumber,
} from "./inputs.js";

const HERMES_URL = "https://hermes.pyth.network";

/** The environment variable the Hermes key is read from. Server side only. */
export const API_KEY_VARIABLE = "PYTH_API_KEY";

/**
 * A flat priority fee, never one taken from a trial simulation. A failed
 * simulation once poisoned a limit and every later run died for compute instead
 * of for the real reason.
 */
const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 20_000;

/** How long to wait on Hermes before giving up, in milliseconds. */
const HERMES_TIMEOUT_MS = 15_000;

/** The feed a refresh writes: taken off a sale, or given by hand. */
export interface FeedChoice {
  priceFeedId: FeedId;
  /** Defaults to Pangu's own shard, the one its refresher writes. */
  shard?: number;
}

export interface RefreshPriceInput {
  connection: Connection;
  /** Who pays the fee. Anyone can: the payer is not part of the address. */
  payer: PublicKey;
  /** A sale read from the chain, or the feed by hand. */
  sale?: Sale;
  feed?: FeedChoice;
  /**
   * The Hermes API key. Defaults to `PYTH_API_KEY` in the environment, which is
   * where it should live: it is never a value a browser or a caller passes in.
   */
  apiKey?: string;
  /** Another Hermes host, for a self-hosted one. */
  hermesUrl?: string;
}

/** One transaction of a refresh, unsigned, with the keys it needs besides the payer. */
export interface RefreshTransaction {
  transaction: VersionedTransaction;
  /** Ephemeral accounts the guardian-signed update is verified through. */
  signers: Signer[];
}

export interface RefreshPrice {
  /**
   * Unsigned, in order. The payer signs each one and sends them in this order:
   * the update is posted into an encoded VAA account first and the price feed
   * account is written from it second, and the pair does not fit in one
   * transaction.
   */
  transactions: RefreshTransaction[];
  /** The one account this feed and shard write to, for reading back afterwards. */
  priceAccount: PublicKey;
  shard: number;
  /** Lowercase hex, no prefix. */
  feedId: string;
  /** Every transaction's bytes added up, against a limit of 1232 each. */
  bytes: number;
}

function feedOf(input: RefreshPriceInput): { feedId: string; shard: number } {
  if (input.sale !== undefined && input.sale !== null) {
    if (!input.sale.hasBand) {
      throw new PanguInputError(
        "this sale has no price band, so it has no price to refresh"
      );
    }
    return { feedId: input.sale.priceFeedId, shard: input.sale.priceShard };
  }
  if (input.feed === undefined || input.feed === null) {
    throw new PanguInputError("a refresh needs either a sale or a feed id");
  }
  return {
    feedId: feedIdHex(input.feed.priceFeedId),
    shard:
      input.feed.shard === undefined
        ? PANGU_SHARD_ID
        : requireWholeNumber(input.feed.shard, "feed.shard", 0, LIMITS.maxShard),
  };
}

/**
 * The Hermes key, from the caller or from the environment.
 *
 * Throws PanguInputError naming the variable when there is none. The key itself
 * is never part of a message, a log line or a returned value.
 */
function apiKey(given: string | undefined): string {
  const key =
    given === undefined || given === ""
      ? (globalThis as { process?: { env?: Record<string, string | undefined> } })
          .process?.env?.[API_KEY_VARIABLE]
      : given;
  if (key === undefined || key === "") {
    throw new PanguInputError(
      `${API_KEY_VARIABLE} is not set. Every Hermes read has needed a key since 26 August 2026, and it belongs in the server's environment, never in a browser.`
    );
  }
  return key;
}

/** The latest guardian-signed update for one feed, base64, straight from Pyth. */
async function latestUpdate(
  host: string,
  feedId: string,
  key: string
): Promise<string[]> {
  const url = `${host}/v2/updates/price/latest?ids[]=${feedId}&encoding=base64`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(HERMES_TIMEOUT_MS),
  });
  if (!response.ok) {
    // The body, never the key: a 401 here means the key has run out. Whatever
    // Hermes says is scrubbed of the key before it is put in a message, because
    // an error text ends up in a log.
    const body = (await response.text()).slice(0, 200).split(key).join("[key]");
    throw new PanguInputError(`Hermes answered ${response.status}: ${body}`);
  }
  const body = (await response.json()) as { binary?: { data?: string[] } };
  const data = body?.binary?.data;
  if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== "string") {
    throw new PanguInputError("Hermes returned no price update for this feed");
  }
  return data;
}

/**
 * Builds the transactions that write a fresh stock price into the one account
 * this sale reads.
 *
 * Anybody can send them and the payer is not one of the account's seeds, so the
 * address never moves and a sale can name it before anyone has ever refreshed
 * it. It takes two transactions, not one: the guardian-signed update has to be
 * posted into an encoded VAA account before the price feed account can be
 * written from it, and the pair does not fit in 1232 bytes. So a refresh cannot
 * ride along with a buy; send it first and the buy straight after, inside the
 * age the sale allows.
 *
 * The encoded VAA account is closed by the last transaction, which is the
 * difference between a refresh costing about 35 thousand lamports and about
 * 2.4 million (docs/measurements/price-band-pyth.md). The price feed account
 * itself is a program address, it is not one of the accounts closed, and it
 * stays where it is.
 *
 * Node and server only. Signs and sends nothing.
 *
 * Throws PanguInputError when neither a sale nor a feed is given, when the sale
 * has no band, when there is no API key, or when Hermes refuses.
 */
export async function refreshPriceTransaction(
  input: RefreshPriceInput
): Promise<RefreshPrice> {
  const payer = requireRealPublicKey(input.payer, "payer");
  const { feedId, shard } = feedOf(input);
  const key = apiKey(input.apiKey);

  const updateData = await latestUpdate(
    input.hermesUrl ?? HERMES_URL,
    feedId,
    key
  );

  // The receiver builds transactions through an Anchor provider, which wants a
  // wallet. Nothing here signs, so the wallet is the payer's key and two
  // refusals: a caller that wants these signed has the transactions back to
  // sign itself.
  const wallet = {
    publicKey: payer,
    signTransaction: () => {
      throw new PanguInputError("pangu-sdk never signs, sign the transactions yourself");
    },
    signAllTransactions: () => {
      throw new PanguInputError("pangu-sdk never signs, sign the transactions yourself");
    },
  } as unknown as ConstructorParameters<typeof PythSolanaReceiver>[0]["wallet"];

  const receiver = new PythSolanaReceiver({ connection: input.connection, wallet });
  const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
  await builder.addUpdatePriceFeed(updateData, shard);

  const built = await builder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  });
  const transactions = built.map((entry) => ({
    transaction: entry.tx,
    signers: entry.signers,
  }));

  return {
    transactions,
    priceAccount: priceFeedAddress(feedId, shard),
    shard,
    feedId,
    bytes: transactions.reduce(
      (total, entry) => total + entry.transaction.serialize().length,
      0
    ),
  };
}
