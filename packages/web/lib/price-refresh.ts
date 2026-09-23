import type { Connection, Keypair, PublicKey, Signer, VersionedTransaction } from "@solana/web3.js";
import { getSale, readPrice, type Sale } from "pangu-sdk";
import { API_KEY_VARIABLE, refreshPriceTransaction } from "pangu-sdk/price";

import { Refused, demoKey } from "@/lib/demo-dollars";
import { devnetConnection } from "@/lib/solana";

/**
 * Keeps a banded sale's Pyth price fresh without anyone running a script.
 *
 * Server only. Nothing here may be imported by a client component: it reads the
 * devnet demo key and the Hermes key, and pulls in pangu-sdk/price, which is
 * where the Hermes key is used. Either key in a client import is that key in the
 * browser bundle.
 *
 * Pyth is a pull oracle. The account a sale reads only moves when somebody
 * posts a newer guardian-signed price into it, so the page that needs a fresh
 * price posts one, paid for by the demo key, about 0.000035 SOL a time.
 */

/** A stored price younger than this is left alone. */
const FRESH_ENOUGH_SECS = 10 * 60;

/** One post a minute across the whole process, whichever sale asks. */
const POST_GAP_MS = 60 * 1000;

/**
 * A "fresh" answer is shared for this long, so a burst of calls costs devnet
 * one read, the way the price route's own answers are shared (C17).
 */
const FRESH_SHARED_MS = 10_000;

/** A shut market is asked about again after this long, not on every page load. */
const CLOSED_RECHECK_MS = 60 * 1000;

const HERMES_URL = "https://hermes.pyth.network";
const HERMES_TIMEOUT_MS = 15_000;

/** Enough polls to outlast a blockhash, about 150 blocks, twice over. */
const CONFIRM_POLLS = 60;
const CONFIRM_WAIT_MS = 2_000;

export type RefreshOutcome =
  | { status: "fresh"; publishedAt: number; price: number }
  | { status: "posted"; posted: string; signatures: string[]; publishedAt: number; price: number }
  | { status: "closed"; closed: true; lastPublishedAt: number }
  | { status: "limited"; retryAfterSecs: number };

let running: { mint: string; outcome: Promise<RefreshOutcome> } | null = null;
let lastPostAt = 0;
const closedSeen = new Map<string, { at: number; outcome: RefreshOutcome }>();
const freshSeen = new Map<string, { at: number; outcome: RefreshOutcome }>();

/**
 * Posts a fresh Pyth price for this sale when the one on chain is over ten
 * minutes old, and answers what it did.
 *
 * Only one refresh runs at a time in this process: a second ask for the same
 * sale while one is running waits for that one and gets its answer, and an ask
 * for another sale is told to wait. A post is never sent within a minute of the
 * last one. When Pyth itself has nothing newer than the sale's own age limit,
 * the market is shut and nothing is posted, because a post would only write the
 * same old price again.
 *
 * Throws {@link Refused} with a sentence a visitor can read when the sale has no
 * band or the deploy has no key for this. Any other throw is devnet or Hermes
 * failing, and its text may carry an endpoint, so it stays on the server.
 */
export function refreshIfStale(mint: PublicKey): Promise<RefreshOutcome> {
  const key = mint.toBase58();
  const fresh = freshSeen.get(key);
  if (fresh !== undefined && Date.now() - fresh.at < FRESH_SHARED_MS) {
    return Promise.resolve(fresh.outcome);
  }
  if (running !== null) {
    if (running.mint === key) {
      return running.outcome;
    }
    return Promise.resolve({ status: "limited", retryAfterSecs: 15 });
  }
  const entry = { mint: key, outcome: refresh(mint) };
  running = entry;
  void entry.outcome.then(
    (outcome) => {
      if (outcome.status === "fresh" || outcome.status === "posted") {
        freshSeen.set(key, { at: Date.now(), outcome: freshOf(outcome) });
      }
    },
    () => {}
  );
  const done = () => {
    if (running === entry) {
      running = null;
    }
  };
  entry.outcome.then(done, done);
  return entry.outcome;
}

async function refresh(mint: PublicKey): Promise<RefreshOutcome> {
  const connection = devnetConnection();
  const sale = await getSale(connection, mint);
  if (sale === null) {
    throw new Refused(404, "There is no Pangu sale at this mint on devnet.");
  }
  if (!sale.hasBand) {
    throw new Refused(409, "This sale has no price band, so it has no price to bring up to date.");
  }

  const stored = await readPrice(connection, sale);
  // The chain's own clock, the one the hook ages the price against. readPrice
  // measured the age from it, so adding the two back together gives it.
  const chainNow =
    stored.publishTime > 0 ? stored.publishTime + stored.ageSecs : Math.floor(Date.now() / 1000);
  if (stored.publishTime > 0 && stored.ageSecs < FRESH_ENOUGH_SECS) {
    return { status: "fresh", publishedAt: stored.publishTime, price: stored.priceDollars };
  }

  const shut = closedSeen.get(mint.toBase58());
  if (shut !== undefined && Date.now() - shut.at < CLOSED_RECHECK_MS) {
    return shut.outcome;
  }

  const waited = Date.now() - lastPostAt;
  if (waited < POST_GAP_MS) {
    return { status: "limited", retryAfterSecs: Math.ceil((POST_GAP_MS - waited) / 1000) };
  }

  const payer = payingKey();
  const latest = await hermesPublishTime(sale.priceFeedId);
  if (chainNow - latest > sale.maxPriceAgeSecs) {
    const outcome: RefreshOutcome = { status: "closed", closed: true, lastPublishedAt: latest };
    closedSeen.set(mint.toBase58(), { at: Date.now(), outcome });
    return outcome;
  }
  if (stored.publishTime > 0 && latest <= stored.publishTime) {
    // Pyth has nothing newer than what is on chain, and what is on chain is
    // still inside the sale's limit, so posting would pay for the same price.
    return { status: "fresh", publishedAt: stored.publishTime, price: stored.priceDollars };
  }

  lastPostAt = Date.now();
  const signatures = await post(connection, payer, sale);
  const after = await readPrice(connection, sale);
  return {
    status: "posted",
    posted: signatures[signatures.length - 1] ?? "",
    signatures,
    publishedAt: after.publishTime,
    price: after.priceDollars,
  };
}

/** A post that just landed is, to the next caller, simply a fresh price. */
function freshOf(outcome: RefreshOutcome): RefreshOutcome {
  return outcome.status === "posted"
    ? { status: "fresh", publishedAt: outcome.publishedAt, price: outcome.price }
    : outcome;
}

/** The demo key, with a refusal that names this job rather than demo dollars. */
function payingKey(): Keypair {
  try {
    return demoKey();
  } catch (error) {
    if (error instanceof Refused) {
      throw new Refused(503, "Price refreshes are not switched on for this deploy.");
    }
    throw error;
  }
}

/**
 * When Pyth last published this feed, in Unix seconds, straight from Hermes.
 *
 * pangu-sdk/price asks Hermes for the same update when it builds the post, but
 * hands back only the transactions, so the time is asked for here first. The
 * key goes in a header and never into a message: whatever Hermes answers is
 * scrubbed of it, because an error text ends up in a log.
 */
async function hermesPublishTime(feedId: string): Promise<number> {
  // demoKey() has loaded the repository root .env on a developer machine by
  // now, which is where this key lives there too.
  const key = process.env[API_KEY_VARIABLE];
  if (key === undefined || key.trim() === "") {
    throw new Refused(503, "Price refreshes are not switched on for this deploy.");
  }
  const id = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
  const response = await fetch(
    `${HERMES_URL}/v2/updates/price/latest?ids[]=${id}&parsed=true&encoding=hex`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(HERMES_TIMEOUT_MS),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200).split(key).join("[key]");
    throw new Error(`Hermes answered ${response.status}: ${body}`);
  }
  const body = (await response.json()) as {
    parsed?: { price?: { publish_time?: number } }[];
  };
  const published = body?.parsed?.[0]?.price?.publish_time;
  if (typeof published !== "number" || !Number.isFinite(published)) {
    throw new Error("Hermes returned no parsed price for this feed");
  }
  return published;
}

/**
 * Builds the two transactions of a refresh, signs them with the demo key and
 * the throwaway keys the update is posted through, and lands them in order.
 *
 * Preflight is skipped, as the refresh script skips it: the second transaction
 * reads an account the first one creates, so a dry run of it before the first
 * has landed would fail for nothing.
 */
async function post(connection: Connection, payer: Keypair, sale: Sale): Promise<string[]> {
  const built = await refreshPriceTransaction({ connection, payer: payer.publicKey, sale });
  const signatures: string[] = [];
  for (const [index, entry] of built.transactions.entries()) {
    signatures.push(
      await land(connection, entry.transaction, [payer, ...entry.signers], index + 1)
    );
  }
  return signatures;
}

async function land(
  connection: Connection,
  transaction: VersionedTransaction,
  signers: Signer[],
  step: number
): Promise<string> {
  const fresh = await connection.getLatestBlockhash("confirmed");
  transaction.message.recentBlockhash = fresh.blockhash;
  transaction.sign(signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
    maxRetries: 5,
  });

  for (let poll = 0; poll < CONFIRM_POLLS; poll += 1) {
    const status = (
      await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })
    ).value[0];
    if (status !== null && status !== undefined) {
      if (status.err !== null) {
        throw new Error(`price refresh transaction ${step} failed on chain: ${signature}`);
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return signature;
      }
    } else if ((await connection.getBlockHeight("confirmed")) > fresh.lastValidBlockHeight) {
      throw new Error(`price refresh transaction ${step} expired before it landed: ${signature}`);
    }
    await new Promise((wake) => setTimeout(wake, CONFIRM_WAIT_MS));
  }
  throw new Error(`could not tell whether price refresh transaction ${step} landed: ${signature}`);
}
