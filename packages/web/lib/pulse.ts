import { getTransferHook, unpackMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  curvePriceDollars,
  dollars,
  getSale,
  listBuyerRecords,
  PANGU_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  priceCeiling,
  readPrice,
  saleStanding,
  type Sale,
} from "pangu-sdk";
import { loadPool } from "pangu-sdk/dbc";

import { openedSales, type OpenedSale } from "./sales";
import { devnetConnection } from "./solana";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

/** The three live numbers the hero paints before any wallet is connected. */
export interface HeroPulse {
  /** The sale the curve price was read from. */
  priceSaleName: string;
  /** Dollars per whole share, off the pool's own square root price. */
  priceDollars: number | null;
  /** Apple, as Pyth published it into the account the program reads. */
  stockName: string;
  stockDollars: number | null;
  /** The highest curve price this sale still accepts a buy at. */
  ceilingDollars: number | null;
  /** Set when the published price is too old or too uncertain to buy against. */
  priceWarning: string | null;
  /** The sale the sharing numbers were read from. */
  sharedSaleName: string;
  buyers: number | null;
  /** The largest wallet's share of everything sold, 0 to 1. */
  largestShare: number;
  /** What one wallet's cap is worth as a share of everything sold, 0 to 1. */
  capShare: number;
  /** Set when devnet could not be read at all. Nothing is invented in its place. */
  failure: string | null;
}

const EMPTY: HeroPulse = {
  priceSaleName: "",
  priceDollars: null,
  stockName: "Apple",
  stockDollars: null,
  ceilingDollars: null,
  priceWarning: null,
  sharedSaleName: "",
  buyers: null,
  largestShare: 0,
  capShare: 0,
  failure: null,
};

/** The dollar-priced sale carrying the price ceiling, the hero's own sale. */
function pricedSale(sales: OpenedSale[]): OpenedSale | null {
  const priced = sales.filter(
    (sale) => sale.bandBps !== null && sale.quoteMint !== WRAPPED_SOL
  );
  return priced.length === 0 ? null : priced[priced.length - 1];
}

/** The sales that show how the tokens got shared out, newest last. */
function listedSales(sales: OpenedSale[], except: string): OpenedSale[] {
  return sales.filter((sale) => sale.mode === "list" && sale.mint !== except);
}

/**
 * The newest of these sales that is still running, read off the tokens
 * themselves in one call: a sale is running while its mint still names Pangu as
 * its transfer hook. A sale nobody can buy into any more is the last resort,
 * never the first choice, because the hero calls these numbers live.
 */
async function newestRunning(candidates: OpenedSale[]): Promise<OpenedSale | null> {
  if (candidates.length === 0) {
    return null;
  }

  const mints = candidates.map((sale) => new PublicKey(sale.mint));
  const accounts = await devnetConnection().getMultipleAccountsInfo(mints);

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const account = accounts[index];
    if (account === null || !account.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      continue;
    }
    const hook = getTransferHook(unpackMint(mints[index], account, TOKEN_2022_PROGRAM_ID));
    if (hook !== null && hook.programId.equals(PANGU_PROGRAM_ID)) {
      return candidates[index];
    }
  }

  return candidates[candidates.length - 1];
}

/** The name of the sale the hero is about, for the poster's metadata row. */
export function heroSaleName(): string {
  const sales = openedSales();
  const priced = pricedSale(sales);
  const listed = listedSales(sales, "");
  return priced?.name ?? listed[listed.length - 1]?.name ?? "";
}

interface Standing {
  buyers: number;
  largestShare: number;
  capShare: number;
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
 * Reads the hero's numbers off devnet. Server only: it pulls in Meteora's own
 * SDK to reach the pool's square root price, which no browser should download.
 *
 * Every field is read from the chain on the spot. Nothing is invented: when
 * devnet does not answer, the fields stay null and the page says so.
 */
async function readFromChain(): Promise<HeroPulse> {
  const sales = openedSales();
  const priced = pricedSale(sales);
  const candidates = listedSales(sales, priced?.mint ?? "");
  const connection = devnetConnection();

  if (priced === null && candidates.length === 0) {
    return { ...EMPTY, failure: "no devnet sale has been opened yet" };
  }

  try {
    const [pool, listed] = await Promise.all([
      priced === null
        ? Promise.resolve(null)
        : loadPool(connection, new PublicKey(priced.mint)),
      newestRunning(candidates),
    ]);

    const pulse: HeroPulse = { ...EMPTY };

    if (pool !== null && priced !== null) {
      const { sale } = pool;
      pulse.priceSaleName = priced.name;

      if (sale.quoteDecimals > 0) {
        const sqrtPrice = BigInt(pool.poolAccount.poolState.sqrtPrice.toString());
        pulse.priceDollars = dollars(
          curvePriceDollars(sqrtPrice, sale.baseDecimals, sale.quoteDecimals)
        );
      }

      if (sale.hasBand) {
        const reading = await readPrice(connection, sale);
        pulse.stockDollars = reading.priceDollars;

        // The ceiling is worth showing even when the published price has aged
        // out: it is the number the chain last measured a buy against. The
        // warning next to it says the sale is not taking buys meanwhile.
        if (reading.price > 0n) {
          pulse.ceilingDollars = dollars(
            priceCeiling({ bandBps: sale.bandBps }, reading.price)
          );
        }
        if (!reading.usable) {
          pulse.priceWarning = "no fresh price right now, so buying is paused";
        }
      }

      const ownStanding = await standingOf(sale);
      if (ownStanding.buyers > 0) {
        pulse.sharedSaleName = priced.name;
        pulse.buyers = ownStanding.buyers;
        pulse.largestShare = ownStanding.largestShare;
        pulse.capShare = ownStanding.capShare;
      }
    }

    // The priced sale has refused every buy so far, so the sharing numbers come
    // from the sale that has buyers in it. The label on screen says which.
    if (pulse.buyers === null && listed !== null) {
      const sale = await getSale(connection, new PublicKey(listed.mint));
      if (sale !== null) {
        const standing = await standingOf(sale);
        pulse.sharedSaleName = listed.name;
        pulse.buyers = standing.buyers;
        pulse.largestShare = standing.largestShare;
        pulse.capShare = standing.capShare;
      }
    }

    return pulse;
  } catch (error) {
    return {
      ...EMPTY,
      failure: error instanceof Error ? error.message : "devnet did not answer",
    };
  }
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
  reading = readFromChain().then((pulse) => {
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

  const held = lastGood.pulse;
  return Promise.race([
    fresh,
    new Promise<HeroPulse>((resolve) => {
      setTimeout(() => resolve(held), WAIT_MS);
    }),
  ]);
}
