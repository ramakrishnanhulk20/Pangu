import { getTransferHook, unpackMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  curvePriceDollars,
  dollars,
  getSale,
  listBuyerRecords,
  PANGU_PROGRAM_ID,
  PanguLayoutError,
  TOKEN_2022_PROGRAM_ID,
  priceCeiling,
  readPrice,
  saleStanding,
  type Sale,
} from "pangu-sdk";
import { loadPool } from "pangu-sdk/dbc";

import { feedWords } from "./feeds";
import { chooseLiveSale, lastLiveSale, type LiveSale } from "./live-sale";
import { oldestFirst } from "./readout";
import { openedSales, type OpenedSale } from "./sales";
import { firstReadableSharing, type Standing } from "./sharing";
import { devnetConnection } from "./solana";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

// A sale this package cannot decode is almost always a sale written by another
// build of the program. That means nothing to a visitor, so the line says the
// only part they care about: the numbers are on their way back.
const REFRESHING =
  "The sale list is being refreshed. Live numbers return in a moment.";

// When the node itself is not answering, the line says that instead. Calling
// an outage a refresh would promise numbers that are not on their way.
const DEVNET_SILENT = "Devnet did not answer, so there is nothing true to show yet.";

/** Why the sales that would not read did not, counted over one reading. */
interface Misses {
  /** Written by another build of the program, so they will never decode here. */
  layout: number;
  /** Devnet did not answer, or answered with an error. */
  silent: number;
}

function countMiss(misses: Misses, error: unknown): void {
  if (error instanceof PanguLayoutError) {
    misses.layout += 1;
  } else {
    misses.silent += 1;
  }
}

/** When one sale's offering period ends, as its rules account holds it. */
export interface Offering {
  /** Unix seconds, or null when the sale has no end, which is every version 1 sale. */
  endsAt: number | null;
  /** True once that moment has passed, judged by the SDK's standing helper. */
  offeringOver: boolean;
}

const NO_END: Offering = { endsAt: null, offeringOver: false };

/**
 * The offering period of a sale. The standing helper is asked with no records
 * on purpose: whether the period is over turns on the rules alone, so a read of
 * the buyer records that fails cannot take the end date off the page with it.
 */
function offeringOf(sale: Sale): Offering {
  return { endsAt: sale.endsAt, offeringOver: saleStanding(sale, []).offeringOver };
}

/** The three live numbers the hero paints before any wallet is connected. */
export interface HeroPulse {
  /** The sale the curve price was read from. */
  priceSaleName: string;
  priceOffering: Offering;
  /** Dollars per whole share, off the pool's own square root price. */
  priceDollars: number | null;
  /** The feed the ceiling follows, in its short label, as Pyth published it into the account the program reads. */
  stockLabel: string;
  stockDollars: number | null;
  /** The highest curve price this sale still accepts a buy at. */
  ceilingDollars: number | null;
  /** Set when the published price is too old or too uncertain to buy against. */
  priceWarning: string | null;
  /** The sale the sharing numbers were read from. */
  sharedSaleName: string;
  sharedOffering: Offering;
  buyers: number | null;
  /** The largest wallet's share of everything sold, 0 to 1. */
  largestShare: number;
  /** What one wallet's cap is worth as a share of everything sold, 0 to 1. */
  capShare: number;
  /** How many opened sales would not read this time. They are left out, never guessed at. */
  skipped: number;
  /** Set when not one sale could be read. Nothing is invented in its place. */
  failure: string | null;
  /** Unix milliseconds this reading was taken, which the offering count is measured from. */
  readAt: number;
}

const EMPTY: HeroPulse = {
  priceSaleName: "",
  priceOffering: NO_END,
  priceDollars: null,
  stockLabel: feedWords(null).label,
  stockDollars: null,
  ceilingDollars: null,
  priceWarning: null,
  sharedSaleName: "",
  sharedOffering: NO_END,
  buyers: null,
  largestShare: 0,
  capShare: 0,
  skipped: 0,
  failure: null,
  readAt: 0,
};

/** The dollar-priced sale carrying the price ceiling, the hero's own sale. */
function pricedSale(sales: OpenedSale[]): OpenedSale | null {
  const priced = sales.filter(
    (sale) => sale.bandBps !== null && sale.quoteMint !== WRAPPED_SOL
  );
  return priced.length === 0 ? null : priced[priced.length - 1];
}

/**
 * The sale the hero leads with: the live sale lib/live-sale.ts chose, or the
 * newest priced sale when no banded sale is live.
 */
function leadSale(sales: OpenedSale[], live: LiveSale | null): OpenedSale | null {
  const chosen = live === null ? undefined : sales.find((sale) => sale.mint === live.mint);
  return chosen ?? pricedSale(sales);
}

/** The sales that show how the tokens got shared out, newest last. */
function listedSales(sales: OpenedSale[], except: string): OpenedSale[] {
  return sales.filter((sale) => sale.mode === "list" && sale.mint !== except);
}

/**
 * These sales in the order the hero wants to try them: the ones still running,
 * newest first, then the rest. Whether a sale is running is read off the tokens
 * themselves in one call, because a mint names Pangu as its transfer hook for
 * as long as the sale takes buys. A sale nobody can buy into any more is the
 * last resort, never the first choice, because the hero calls these numbers
 * live. When that one call does not answer, plain newest first stands in.
 */
async function runningFirst(candidates: OpenedSale[]): Promise<OpenedSale[]> {
  const newestFirst = [...candidates].reverse();
  if (newestFirst.length < 2) {
    return newestFirst;
  }

  try {
    const mints = newestFirst.map((sale) => new PublicKey(sale.mint));
    const accounts = await devnetConnection().getMultipleAccountsInfo(mints);
    const running: OpenedSale[] = [];
    const rest: OpenedSale[] = [];

    newestFirst.forEach((sale, index) => {
      const account = accounts[index];
      if (account === null || !account.owner.equals(TOKEN_2022_PROGRAM_ID)) {
        rest.push(sale);
        return;
      }
      try {
        const hook = getTransferHook(
          unpackMint(mints[index], account, TOKEN_2022_PROGRAM_ID)
        );
        const live = hook !== null && hook.programId.equals(PANGU_PROGRAM_ID);
        (live ? running : rest).push(sale);
      } catch {
        rest.push(sale);
      }
    });

    return [...running, ...rest];
  } catch {
    return newestFirst;
  }
}

/** The name of the sale the hero is about, for the poster's metadata row. */
export function heroSaleName(): string {
  const sales = oldestFirst(openedSales());
  // The poster renders before any devnet read finishes, so it takes the last
  // choice already made rather than waiting on a new one.
  const priced = leadSale(sales, lastLiveSale());
  const listed = listedSales(sales, "");
  return priced?.name ?? listed[listed.length - 1]?.name ?? "";
}

async function standingOf(sale: Sale): Promise<Standing> {
  const connection = devnetConnection();
  const records = await listBuyerRecords(connection, sale.mint);
  const standing = saleStanding(sale, records);
  return {
    buyers: standing.buyers,
    largestShare: standing.largestShare,
    capShare: standing.capShare,
  };
}

/**
 * The sharing numbers for one mint. Throws when that sale will not decode.
 * The sale's offering period is handed to `seen` beside them, because the walk
 * over the listed sales only carries the sharing numbers back.
 */
async function standingOfMint(
  mint: string,
  seen: (offering: Offering) => void
): Promise<Standing | null> {
  const sale = await getSale(devnetConnection(), new PublicKey(mint));
  if (sale === null) {
    return null;
  }
  const standing = await standingOf(sale);
  seen(offeringOf(sale));
  return standing;
}

interface PricedNumbers {
  name: string;
  offering: Offering;
  stockLabel: string;
  priceDollars: number | null;
  stockDollars: number | null;
  ceilingDollars: number | null;
  priceWarning: string | null;
  standing: Standing | null;
}

/**
 * The priced sale's own numbers, or null when that one sale will not read.
 *
 * This is deliberately its own try: the listed sales are read separately, so a
 * sale from an older build of the program sitting in the list cannot take the
 * price and the ceiling off the page with it.
 */
async function readPricedSale(
  opened: OpenedSale,
  misses: Misses
): Promise<PricedNumbers | null> {
  const connection = devnetConnection();

  try {
    const pool = await loadPool(connection, new PublicKey(opened.mint));
    const { sale } = pool;
    const numbers: PricedNumbers = {
      name: opened.name,
      offering: offeringOf(sale),
      stockLabel: feedWords(sale.hasBand ? sale.priceFeedId : null).label,
      priceDollars: null,
      stockDollars: null,
      ceilingDollars: null,
      priceWarning: null,
      standing: null,
    };

    if (sale.quoteDecimals > 0) {
      const sqrtPrice = BigInt(pool.poolAccount.poolState.sqrtPrice.toString());
      numbers.priceDollars = dollars(
        curvePriceDollars(sqrtPrice, sale.baseDecimals, sale.quoteDecimals)
      );
    }

    if (sale.hasBand) {
      const reading = await readPrice(connection, sale);
      numbers.stockDollars = reading.priceDollars;

      // The ceiling is worth showing even when the published price has aged
      // out: it is the number the chain last measured a buy against. The
      // warning next to it says the sale is not taking buys meanwhile.
      if (reading.price > 0n) {
        numbers.ceilingDollars = dollars(
          priceCeiling({ bandBps: sale.bandBps }, reading.price)
        );
      }
      if (!reading.usable) {
        numbers.priceWarning = "no fresh price right now, so buying is paused";
      }
    }

    // Its buyer records are a read of their own, so an empty answer there still
    // leaves the price standing.
    numbers.standing = await standingOf(sale).catch(() => null);
    return numbers;
  } catch (error) {
    countMiss(misses, error);
    return null;
  }
}

/**
 * Reads the hero's numbers off devnet. Server only: it pulls in Meteora's own
 * SDK to reach the pool's square root price, which no browser should download.
 *
 * Every field is read from the chain on the spot. Nothing is invented: when
 * devnet does not answer, the fields stay null and the page says so.
 *
 * Each sale is read on its own and a sale that will not decode is passed over
 * and counted, so one account written by another build of the program costs its
 * own numbers and no others.
 */
async function readFromChain(): Promise<HeroPulse> {
  const sales = oldestFirst(openedSales());
  const priced = leadSale(sales, await chooseLiveSale());
  const candidates = listedSales(sales, priced?.mint ?? "");

  if (priced === null && candidates.length === 0) {
    return { ...EMPTY, failure: "No devnet sale has been opened yet." };
  }

  const misses: Misses = { layout: 0, silent: 0 };
  const [pricedNumbers, order] = await Promise.all([
    priced === null ? Promise.resolve(null) : readPricedSale(priced, misses),
    runningFirst(candidates),
  ]);

  const pulse: HeroPulse = { ...EMPTY };
  pulse.skipped = priced !== null && pricedNumbers === null ? 1 : 0;

  if (pricedNumbers !== null) {
    pulse.priceSaleName = pricedNumbers.name;
    pulse.priceOffering = pricedNumbers.offering;
    pulse.priceDollars = pricedNumbers.priceDollars;
    pulse.stockLabel = pricedNumbers.stockLabel;
    pulse.stockDollars = pricedNumbers.stockDollars;
    pulse.ceilingDollars = pricedNumbers.ceilingDollars;
    pulse.priceWarning = pricedNumbers.priceWarning;

    const own = pricedNumbers.standing;
    if (own !== null && own.buyers > 0) {
      pulse.sharedSaleName = pricedNumbers.name;
      pulse.sharedOffering = pricedNumbers.offering;
      pulse.buyers = own.buyers;
      pulse.largestShare = own.largestShare;
      pulse.capShare = own.capShare;
    }
  }

  // The priced sale has refused every buy so far, so the sharing numbers come
  // from the newest listed sale that reads. The label on screen says which.
  if (pulse.buyers === null && order.length > 0) {
    // The walk stops at the first sale that reads, so the last offering seen
    // belongs to the sale whose numbers come back.
    let offering = NO_END;
    const shared = await firstReadableSharing(order, (mint) =>
      standingOfMint(mint, (seen) => {
        offering = seen;
      }).catch((error: unknown) => {
        countMiss(misses, error);
        throw error;
      })
    );
    pulse.skipped += shared.skipped;
    if (shared.sharing !== null) {
      pulse.sharedSaleName = shared.sharing.name;
      pulse.sharedOffering = offering;
      pulse.buyers = shared.sharing.standing.buyers;
      pulse.largestShare = shared.sharing.standing.largestShare;
      pulse.capShare = shared.sharing.standing.capShare;
    }
  }

  pulse.readAt = Date.now();
  if (pricedNumbers === null && pulse.buyers === null) {
    const onlyOldBuilds = misses.silent === 0;
    return { ...pulse, failure: onlyOldBuilds ? REFRESHING : DEVNET_SILENT };
  }

  return pulse;
}

// The public devnet endpoint answers 429 when several loads land together, and
// one reading is about seven reads. So one reading is shared for ten seconds,
// only one is ever in flight, and a visitor never waits more than a moment and
// a half on it: past that they get the last real reading while the new one
// finishes. Anything older than a minute and a half is not worth showing, so
// then the page does wait.
const FRESH_MS = 10_000;
const WAIT_MS = 1_500;
const TOO_OLD_MS = 90_000;

let lastGood: { at: number; pulse: HeroPulse } | null = null;
let reading: Promise<HeroPulse> | null = null;

function startReading(): Promise<HeroPulse> {
  if (reading !== null) {
    return reading;
  }
  // A reading that throws is turned into the outage line and cleared like any
  // other, or the next visit would wait on a promise that already gave up.
  reading = readFromChain()
    .catch((): HeroPulse => ({ ...EMPTY, failure: DEVNET_SILENT, readAt: Date.now() }))
    .then((pulse) => {
      if (pulse.failure === null) {
        lastGood = { at: Date.now(), pulse };
      }
      reading = null;
      return pulse;
    });
  return reading;
}

/** The numbers for the hero, live off devnet, shared between the loads that land together. */
export async function readPulse(): Promise<HeroPulse> {
  const now = Date.now();
  if (lastGood !== null && now - lastGood.at < FRESH_MS) {
    return lastGood.pulse;
  }

  const fresh = startReading();
  if (lastGood === null || now - lastGood.at > TOO_OLD_MS) {
    return fresh;
  }

  // A failure that comes back fast still loses to the held reading: it is
  // young enough to show, and a blank hero says less than a true one.
  const held = lastGood.pulse;
  return Promise.race([
    fresh.then((pulse) => (pulse.failure === null ? pulse : held)),
    new Promise<HeroPulse>((resolve) => {
      setTimeout(() => resolve(held), WAIT_MS);
    }),
  ]);
}
