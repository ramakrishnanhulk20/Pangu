/**
 * Keeping a banded sale's price fresh.
 *
 * Node and server only. It reaches Switchboard's Crossbar over the network and
 * pulls in `@switchboard-xyz/on-demand`, so the web app calls it from a server
 * route and never from the browser. Reading a price back is `readPrice` in the
 * core entry point, which is browser safe.
 */

import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { CrossbarClient, CrossbarNetwork } from "@switchboard-xyz/common";
import * as sb from "@switchboard-xyz/on-demand";
import type { Sale } from "./accounts.js";
import { canonicalQuoteAddress, feedIdHex, type FeedId } from "./addresses.js";
import { PanguInputError, requireRealPublicKey, requireWholeNumber } from "./inputs.js";

/**
 * The Ed25519 instruction has to sit at a known index, and that index has to be
 * written into the instruction itself.
 *
 * An Ed25519 instruction carries three index fields saying where its signature,
 * key and message are. Solana's own program accepts 65535, meaning "in this
 * instruction", and Switchboard's TypeScript SDK writes that by default. The
 * deployed quote program refuses it and panics. So the index is baked in, the
 * Ed25519 instruction goes first, and the transaction is compiled here rather
 * than through `asV0Tx`, which would put the sentinel back. See
 * docs/RD-SWITCHBOARD-SPIKE.md Q8 item 1.
 */
const ED25519_INSTRUCTION_INDEX = 0;

/**
 * A flat compute limit, never one taken from a trial simulation. A failed
 * simulation once poisoned the limit and every later run died for compute
 * instead of for the real reason. Measured need: about 910 units.
 */
const REFRESH_COMPUTE_LIMIT = 200_000;
const REFRESH_COMPUTE_PRICE_MICRO_LAMPORTS = 20_000;

/** The feeds a refresh carries, either read off a sale or given directly. */
export interface FeedSet {
  queue: PublicKey;
  priceFeedId: FeedId;
  clockFeedId: FeedId;
  /** How many oracles must sign. Defaults to the sale's own quorum, or one. */
  minOracles?: number;
}

export interface RefreshPriceInput {
  connection: Connection;
  /** Who pays the fee. Anyone can: the payer is not part of the address. */
  payer: PublicKey;
  /** A sale read from the chain, or the three public values by hand. */
  sale?: Sale;
  feeds?: FeedSet;
  /** A Crossbar client of your own. One is made for this network otherwise. */
  crossbar?: CrossbarClient;
}

export interface RefreshPrice {
  /** Unsigned. The payer signs it and sends it. */
  transaction: VersionedTransaction;
  /** The one account these feeds write to, for reading back afterwards. */
  quoteAccount: PublicKey;
  bytes: number;
  computeUnitLimit: number;
}

function feedsOf(input: RefreshPriceInput): Required<FeedSet> {
  if (input.sale !== undefined && input.sale !== null) {
    if (!input.sale.hasBand) {
      throw new PanguInputError(
        "this sale has no price band, so it has no price to refresh"
      );
    }
    return {
      queue: input.sale.priceQueue,
      priceFeedId: input.sale.priceFeedId,
      clockFeedId: input.sale.clockFeedId,
      minOracles: input.sale.minOracles,
    };
  }
  if (input.feeds === undefined || input.feeds === null) {
    throw new PanguInputError(
      "a refresh needs either a sale or the queue and both feed ids"
    );
  }
  return {
    queue: requireRealPublicKey(input.feeds.queue, "feeds.queue"),
    priceFeedId: input.feeds.priceFeedId,
    clockFeedId: input.feeds.clockFeedId,
    minOracles:
      input.feeds.minOracles === undefined
        ? 1
        : requireWholeNumber(input.feeds.minOracles, "feeds.minOracles", 1, 8),
  };
}

async function crossbarFor(
  connection: Connection,
  given: CrossbarClient | undefined
): Promise<CrossbarClient> {
  if (given !== undefined) {
    return given;
  }
  const crossbar = CrossbarClient.default();
  crossbar.setNetwork(
    (await sb.isMainnetConnection(connection))
      ? CrossbarNetwork.SolanaMainnet
      : CrossbarNetwork.SolanaDevnet
  );
  return crossbar;
}

/**
 * Builds the transaction that writes a fresh stock price and market clock into
 * the one account this sale reads.
 *
 * Anybody can send it and the payer is not one of the account's seeds, so the
 * address never moves and a sale can name it before anyone has ever refreshed
 * it. Both feeds ride in one transaction, which is what lets the hook check the
 * price and whether the market is open from the same signed moment.
 *
 * Node and server only. Signs and sends nothing.
 *
 * Throws PanguInputError when neither a sale nor a feed set is given, or when
 * the sale has no band.
 */
export async function refreshPriceTransaction(
  input: RefreshPriceInput
): Promise<RefreshPrice> {
  const payer = requireRealPublicKey(input.payer, "payer");
  const feeds = feedsOf(input);
  const priceFeedId = feedIdHex(feeds.priceFeedId);
  const clockFeedId = feedIdHex(feeds.clockFeedId);

  const queue = await sb.getQueue({
    queueAddress: feeds.queue,
    solanaRPCUrl: input.connection.rpcEndpoint,
  });
  const updateIxs = await queue.fetchManagedUpdateIxs(
    await crossbarFor(input.connection, input.crossbar),
    [priceFeedId, clockFeedId],
    {
      numSignatures: feeds.minOracles,
      variableOverrides: {},
      payer,
      instructionIdx: ED25519_INSTRUCTION_INDEX,
    }
  );

  const { blockhash } = await input.connection.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [
        ...updateIxs,
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: REFRESH_COMPUTE_PRICE_MICRO_LAMPORTS,
        }),
        ComputeBudgetProgram.setComputeUnitLimit({
          units: REFRESH_COMPUTE_LIMIT,
        }),
      ],
    }).compileToV0Message()
  );

  return {
    transaction,
    quoteAccount: canonicalQuoteAddress(feeds.queue, [priceFeedId, clockFeedId]),
    bytes: transaction.serialize().length,
    computeUnitLimit: REFRESH_COMPUTE_LIMIT,
  };
}
