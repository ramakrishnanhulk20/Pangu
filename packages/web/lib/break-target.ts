import { Connection } from "@solana/web3.js";
import { PanguLayoutError } from "pangu-sdk";

import { breakConnection, readTarget, targetToWire, type TargetReading } from "./break";
import { openedSales } from "./sales";
import { devnetConnection } from "./solana";

/*
 * The sale the attack ledger runs against, read once on the server for every
 * visitor. Server only: it reads through DEVNET_RPC_URL, which may carry a key.
 *
 * The browser used to read this itself from the public devnet node, which
 * rate limits a burst of reads and left a judge waiting a minute for the facts.
 * Only the wallet's own work (its balances, the sizing and the preflight of a
 * row) still runs in the browser, and only once a wallet is connected.
 */

// The same ten seconds lib/readout.ts shares a reading for, so the ledger and
// the readout above it never show two different readings of one moment.
const FRESH_MS = 10_000;

const PUBLIC_HOST = "api.devnet.solana.com";

const NO_SALE =
  "No Pangu sale is running on devnet right now, so there are no rules left to attack. A sale that has graduated has had its rules removed by Meteora, which is the design. Come back once a new sale opens.";
const OLD_BUILD =
  "The running sale was opened by an earlier build of the program, so its rules cannot be read here. Come back once a sale from this build opens.";
const NO_ANSWER =
  "Devnet did not answer the server's read of this sale. Press try again in a moment.";

let held: { at: number; reading: TargetReading } | null = null;
let missed: { at: number; reading: TargetReading } | null = null;
let inFlight: Promise<TargetReading> | null = null;
// Bumped when a reading is dropped on purpose, so a read already in flight from
// before that moment answers its own callers but is never kept.
let generation = 0;

/**
 * Drops the shared reading, so the next load reads the sale off devnet again.
 * Called after a price refresh lands: the reading from before it still says the
 * price is stale, and would for up to ten more seconds.
 */
export function forgetBreakTarget(): void {
  generation += 1;
  held = null;
  missed = null;
  inFlight = null;
}

async function readFresh(): Promise<TargetReading> {
  const candidates = openedSales().map((sale) => ({
    mint: sale.mint,
    name: sale.name,
    symbol: sale.symbol,
    mode: sale.mode,
  }));
  // A keyed endpoint takes the reads side by side. The public one, which is
  // what answers when no key is configured, is paced like the browser's copy
  // so a burst of reads never earns a 429.
  const endpoint = devnetConnection().rpcEndpoint;
  const connection =
    new URL(endpoint).hostname === PUBLIC_HOST
      ? breakConnection(endpoint)
      : new Connection(endpoint, "confirmed");
  const target = await readTarget(connection, candidates);
  return {
    target: target === null ? null : targetToWire(target),
    failure: target === null ? NO_SALE : null,
    unanswered: false,
    readAt: Date.now(),
    stale: false,
  };
}

/** The ledger's sale, live off devnet, shared between the loads that land together. */
export async function readBreakTarget(): Promise<TargetReading> {
  if (held !== null && Date.now() - held.at < FRESH_MS) {
    return held.reading;
  }
  if (missed !== null && Date.now() - missed.at < FRESH_MS) {
    return missed.reading;
  }
  if (inFlight !== null) {
    return inFlight;
  }

  const startedIn = generation;
  const started = readFresh()
    .catch((error: unknown): TargetReading => {
      if (error instanceof PanguLayoutError) {
        return { target: null, failure: OLD_BUILD, unanswered: false, readAt: Date.now(), stale: false };
      }
      console.error(
        `break target: ${error instanceof Error ? error.message : String(error)}`
      );
      // The last reading devnet answered goes back marked as held, never
      // adjusted, rather than a blank ledger.
      if (held !== null) {
        return { ...held.reading, stale: true };
      }
      return { target: null, failure: NO_ANSWER, unanswered: true, readAt: Date.now(), stale: false };
    })
    .then((reading) => {
      if (startedIn !== generation) {
        return reading;
      }
      if (reading.unanswered || reading.stale) {
        missed = { at: Date.now(), reading };
      } else {
        held = { at: Date.now(), reading };
        missed = null;
      }
      inFlight = null;
      return reading;
    });

  inFlight = started;
  return started;
}
