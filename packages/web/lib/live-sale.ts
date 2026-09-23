import { PublicKey } from "@solana/web3.js";
import {
  ACCESS_MODE,
  PanguLayoutError,
  getSale,
  isSaleRunning,
  readPrice,
  saleStanding,
  type Sale,
} from "pangu-sdk";

import { isAaplx, isAppleExchange } from "./feeds";
import { refreshIfStale } from "./price-refresh";
import { oldestFirst } from "./readout";
import { openedSales, type OpenedSale } from "./sales";
import { devnetConnection } from "./solana";

/*
 * Which sale the page opens on. Server only: it can ask lib/price-refresh to
 * post a fresh Pyth price, and that file holds the demo key and the Hermes key.
 *
 * Apple's exchange price only publishes while the US market is open, so the
 * sale banded on it refuses every buy at night and at weekends. The sale banded
 * on AAPLx, which trades all week, can take a buy at any hour. The page leads
 * with whichever one can take a buy right now, and with the exchange-price sale
 * whenever both can.
 */

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

/** A live banded sale the choice was made from. */
export interface LiveCandidate {
  mint: string;
  name: string;
  /** Lowercase hex, no prefix, as the sale's rules hold it. */
  feedId: string;
}

export interface LiveSale extends LiveCandidate {
  /** True when no banded sale has a usable price, even after asking Pyth for one. */
  closed: boolean;
  /**
   * True when the exchange-price sale was passed over because its price is not
   * usable, so the page leads with the round-the-clock sale instead.
   */
  exchangeShut: boolean;
  /** Every live banded sale, newest first, the chosen one among them. */
  candidates: LiveCandidate[];
}

interface Checked {
  opened: OpenedSale;
  sale: Sale;
  usable: boolean;
}

function candidateOf(entry: Checked): LiveCandidate {
  return { mint: entry.opened.mint, name: entry.opened.name, feedId: entry.sale.priceFeedId };
}

/**
 * One banded sale, read for the choice: null when it is not open to anyone, not
 * running, has no band, or its offering is over. Throws when devnet did not
 * answer, so a node that is down is told apart from a sale that is shut.
 */
async function check(opened: OpenedSale): Promise<Checked | null> {
  const connection = devnetConnection();
  const mint = new PublicKey(opened.mint);
  let sale: Sale | null;
  let running: boolean;
  try {
    [sale, running] = await Promise.all([
      getSale(connection, mint),
      isSaleRunning(connection, mint),
    ]);
  } catch (error) {
    // A sale written by an earlier build of the program never decodes here, so
    // it is left out rather than counted as devnet going quiet.
    if (error instanceof PanguLayoutError) {
      return null;
    }
    throw error;
  }
  if (
    sale === null ||
    !running ||
    !sale.hasBand ||
    sale.accessMode !== ACCESS_MODE.open ||
    saleStanding(sale, []).offeringOver
  ) {
    return null;
  }
  const price = await readPrice(connection, sale);
  return { opened, sale, usable: price.usable };
}

/**
 * Asks Pyth for a fresh price for this sale, and answers whether the sale's
 * price is usable afterwards, read back off the chain rather than taken from
 * the refresh's own word. A refresh that is refused, rate limited or fails is
 * simply not usable: the page falls through to the next sale.
 */
async function usableAfterRefresh(entry: Checked): Promise<boolean> {
  try {
    const outcome = await refreshIfStale(new PublicKey(entry.opened.mint));
    if (outcome.status !== "fresh" && outcome.status !== "posted") {
      return false;
    }
    return (await readPrice(devnetConnection(), entry.sale)).usable;
  } catch {
    return false;
  }
}

async function choose(): Promise<LiveSale | null> {
  const banded = oldestFirst(openedSales())
    .reverse()
    .filter((sale) => sale.bandBps !== null && sale.quoteMint !== WRAPPED_SOL);
  if (banded.length === 0) {
    return null;
  }

  const settled = await Promise.allSettled(banded.map(check));
  if (settled.every((result) => result.status === "rejected")) {
    throw new Error("devnet did not answer any read of the banded sales");
  }
  const live = settled
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter((entry): entry is Checked => entry !== null);
  if (live.length === 0) {
    return null;
  }

  const candidates = live.map(candidateOf);
  const exchange = live.find((entry) => isAppleExchange(entry.sale.priceFeedId)) ?? null;
  const aaplx = live.find((entry) => isAaplx(entry.sale.priceFeedId)) ?? null;
  const answer = (chosen: Checked, closed: boolean): LiveSale => ({
    ...candidateOf(chosen),
    closed,
    exchangeShut:
      !closed && exchange !== null && chosen !== exchange && isAaplx(chosen.sale.priceFeedId),
    candidates,
  });

  // The exchange-price sale leads whenever Apple is trading, so its price is
  // brought up to date before the round-the-clock sale is allowed to stand in.
  // Otherwise a still-fresh AAPLx price would keep the page on the stand-in for
  // up to an hour after the exchange opens. refreshIfStale remembers a shut
  // market, so this costs one Hermes question per few minutes, not per load.
  if (exchange !== null && !exchange.usable && (await usableAfterRefresh(exchange))) {
    return answer(exchange, false);
  }

  const usable = live.filter((entry) => entry.usable);
  const preferred =
    usable.find((entry) => isAppleExchange(entry.sale.priceFeedId)) ?? usable[0];
  if (preferred !== undefined) {
    return answer(preferred, false);
  }
  if (aaplx !== null && (await usableAfterRefresh(aaplx))) {
    return answer(aaplx, false);
  }
  return answer(exchange ?? aaplx ?? live[0], true);
}

// Shared for the same ten seconds lib/readout.ts, lib/pulse.ts and
// lib/break-target.ts share a reading for, so the hero, the readout and the
// ledger never lead with two different sales in one moment.
const FRESH_MS = 10_000;

let held: { at: number; live: LiveSale | null } | null = null;
let inFlight: Promise<LiveSale | null> | null = null;
let generation = 0;

/**
 * The sale the page leads with, or null when no banded sale is live, in which
 * case each caller keeps its own older rule. Never throws: when devnet does not
 * answer, the last answer that did is handed back, or null.
 */
export function chooseLiveSale(): Promise<LiveSale | null> {
  if (held !== null && Date.now() - held.at < FRESH_MS) {
    return Promise.resolve(held.live);
  }
  if (inFlight !== null) {
    return inFlight;
  }
  const startedIn = generation;
  const started = choose()
    .then((live) => {
      if (startedIn === generation) {
        held = { at: Date.now(), live };
      }
      return live;
    })
    .catch(() => {
      // The error's own text can carry the keyed endpoint, so the log gets a
      // fixed line and never the message.
      console.error("live sale: devnet did not answer, the last answer stands");
      return held?.live ?? null;
    })
    .finally(() => {
      if (startedIn === generation) {
        inFlight = null;
      }
    });
  inFlight = started;
  return started;
}

/** The last answer, however old, for a caller that cannot wait on devnet. */
export function lastLiveSale(): LiveSale | null {
  return held?.live ?? null;
}

/** Drops the shared answer, so the next caller chooses again. Called after a price refresh lands. */
export function forgetLiveSale(): void {
  generation += 1;
  held = null;
  inFlight = null;
}
