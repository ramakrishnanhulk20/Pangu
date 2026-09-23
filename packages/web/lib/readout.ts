import { getTransferHook, unpackMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  ACCESS_MODE,
  curvePriceDollars,
  dollars,
  listBuyerRecords,
  PANGU_PROGRAM_ID,
  PanguLayoutError,
  priceCeiling,
  readPrice,
  saleStanding,
  TOKEN_2022_PROGRAM_ID,
  type Sale,
} from "pangu-sdk";
import { loadPool, saleProgress, type PoolView } from "pangu-sdk/dbc";

import { feedWords, type FeedWords } from "./feeds";
import { openedSales, type OpenedSale } from "./sales";
import { devnetConnection } from "./solana";

/** One point of the real price path: how many shares are gone, and the price there. */
export interface CurvePoint {
  /** Whole shares the curve has sold by this point. */
  sold: number;
  /** Whole units of the paying token one share costs there. */
  price: number;
}

/** One wallet's standing, as its own account holds it. */
export interface HolderRow {
  wallet: string;
  shares: number;
  /** Its slice of everything sold, 0 to 1. */
  share: number;
}

/** What the picker needs: one line per sale, with no curve behind it. */
export interface SaleChoice {
  mint: string;
  name: string;
  /** Null when devnet did not say. A sale nobody could read is never called finished. */
  running: boolean | null;
}

/** Everything the readout paints, all of it read off devnet. */
export interface SaleReadout {
  mint: string;
  pool: string;
  name: string;
  /** The token buyers pay in, in the word a person uses for it. */
  money: "dollars" | "SOL";
  running: boolean;
  graduated: boolean;
  /** Where the liquidity went, once somebody has sent the migration. */
  dammPool: string | null;
  /** Whole paying-token units one share costs right now. */
  priceNow: number | null;
  /** The real stock behind the token, on a sale with a price band. */
  stockName: string | null;
  /** The Pyth feed the ceiling follows, lowercase hex, on a sale with a price band. */
  feedId: string | null;
  stockDollars: number | null;
  /** The highest curve price this sale still takes a buy at. */
  ceilingDollars: number | null;
  /** Set when the published stock price is too old or too uncertain to buy against. */
  priceWarning: string | null;
  /** Unix milliseconds Pyth published the stock price, on a sale with a price band. */
  stockPublishedAt: number | null;
  /** True when that price has aged past what the program accepts, rather than doubted for another reason. */
  stockStale: boolean;
  raised: number;
  threshold: number;
  /**
   * Raised against the threshold, where 1 is the threshold. Left as measured:
   * the swap that graduates a sale can carry it past 1, and the number says so.
   */
  raisedShare: number;
  buyers: number;
  /** Shares the curve has sold so far, and the number it sells in all. */
  sold: number;
  saleSize: number;
  /** The cap on one wallet, in shares and as a slice of the whole sale. */
  cap: number;
  capOfSale: number;
  /** The largest wallet's slice of everything sold, and what the cap is worth there. */
  largestShare: number;
  capOfSold: number;
  holders: HolderRow[];
  curve: CurvePoint[];
  /** The rule a buyer would run into first, in plain words, built from the numbers. */
  rule: string;
  /**
   * Unix seconds at which the offering period ends and every rule lifts, or
   * null when the sale has none, which is every version 1 sale.
   */
  endsAt: number | null;
  /** True once that moment has passed, judged by the SDK's standing helper. */
  offeringOver: boolean;
  /** Unix milliseconds this reading was taken. */
  readAt: number;
  /**
   * True when devnet did not answer the latest read and this is the last
   * reading that did answer, handed back as it was, never adjusted.
   */
  stale: boolean;
  /** Unix milliseconds of the read devnet did not answer, when stale. */
  missedAt: number | null;
  /** Set when this sale would not read. Nothing is invented in its place. */
  failure: string | null;
  /**
   * True when that failure is devnet not answering, which the next read may
   * fix, rather than a sale this app can never read. The picker keeps the sale
   * on screen when a switch lands on one of these.
   */
  unanswered: boolean;
}

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const CURVE_SAMPLES = 72;
const Q128 = 1n << 128n;

/** One live segment of DBC's curve: liquidity up to a square root price. */
interface Segment {
  sqrtPrice: bigint;
  liquidity: bigint;
}

/**
 * The segments that carry the sale, in order.
 *
 * DBC stores twenty curve points and pads the unused ones with zeros, and the
 * point past graduation is a tail that only exists to absorb a swap the curve
 * cannot fill. Reading stops at the first padded point, so what gets drawn is
 * the part of the curve a buyer can walk.
 */
function segments(view: PoolView): Segment[] {
  const live: Segment[] = [];
  let last = BigInt(view.configState.sqrtStartPrice.toString());

  for (const point of view.configState.curve) {
    const sqrtPrice = BigInt(point.sqrtPrice.toString());
    const liquidity = BigInt(point.liquidity.toString());
    if (sqrtPrice <= last || liquidity === 0n) {
      break;
    }
    live.push({ sqrtPrice, liquidity });
    last = sqrtPrice;
  }

  return live;
}

/**
 * Shares the curve has handed out by the time it reaches this square root
 * price, in raw units.
 *
 * This is DBC's own `getDeltaAmountBaseUnsigned` summed over the segments, the
 * arithmetic the program swaps on, so the drawing is the real curve rather
 * than a shape that looks like one.
 */
function sharesSoldAt(sqrtPrice: bigint, start: bigint, live: Segment[]): bigint {
  let total = 0n;
  let lower = start;

  for (const segment of live) {
    if (sqrtPrice > lower) {
      const upper = sqrtPrice < segment.sqrtPrice ? sqrtPrice : segment.sqrtPrice;
      total += (segment.liquidity * (upper - lower)) / (lower * upper);
    }
    lower = segment.sqrtPrice;
  }

  return total;
}

/**
 * The square root price the curve reaches once this much of the paying token
 * has gone in. DBC's `getMigrationThresholdPrice`, walked segment by segment.
 */
function sqrtPriceAfter(quote: bigint, start: bigint, live: Segment[]): bigint {
  let lower = start;
  let left = quote;

  for (const segment of live) {
    const inSegment =
      (segment.liquidity * (segment.sqrtPrice - lower) + Q128 - 1n) / Q128;
    if (inSegment >= left) {
      return lower + (left << 128n) / segment.liquidity;
    }
    left -= inSegment;
    lower = segment.sqrtPrice;
  }

  return lower;
}

function whole(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/** Whole units of the paying token one whole share costs at this square root price. */
function priceAt(
  sqrtPrice: bigint,
  baseDecimals: number,
  quoteDecimals: number
): number {
  return dollars(curvePriceDollars(sqrtPrice, baseDecimals, quoteDecimals));
}

/**
 * The decimals of the token buyers pay in.
 *
 * The program only stores them on a sale with a price band, because that is
 * the only sale whose hook compares a price, so every other sale holds a zero
 * and the mint itself is asked instead.
 */
async function quoteDecimalsOf(view: PoolView): Promise<number> {
  if (view.sale.quoteDecimals > 0) {
    return view.sale.quoteDecimals;
  }
  const info = await devnetConnection().getAccountInfo(view.quoteMint);
  if (info === null) {
    return 0;
  }
  return unpackMint(view.quoteMint, info, info.owner).decimals;
}

function percentWords(share: number): string {
  const percent = share * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)} percent`;
}

function dollarWords(value: number): string {
  if (value > 0 && value < 0.01) {
    return "under $0.01";
  }
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The one rule a buyer would run into first, written from the sale's own
 * fields rather than typed out anywhere.
 */
function bindingRule(
  sale: Sale,
  input: {
    graduated: boolean;
    capOfSale: number;
    ceilingDollars: number | null;
    priceNow: number | null;
    priceWarning: string | null;
    offeringOver: boolean;
    feed: FeedWords;
  }
): string {
  if (input.graduated) {
    return "The curve filled, so Pangu came off the token for good and it trades freely now.";
  }

  // The hook stands aside before it reads the list, the price or the cap, so
  // none of the rules below is what a buyer meets any more.
  if (input.offeringOver) {
    return "The offering period ended, so Pangu no longer checks a buy or a transfer on this token.";
  }

  const capLine = `any wallet may buy up to ${percentWords(input.capOfSale)} of the sale`;

  if (sale.hasBand && input.priceWarning !== null) {
    return `There is no fresh ${input.feed.fresh} right now, so every buy is refused until one arrives. When it does, ${capLine}.`;
  }

  if (sale.hasBand && input.ceilingDollars !== null) {
    const ceiling = `Buys stop above ${dollarWords(input.ceilingDollars)} a share, ${(
      sale.bandBps / 100
    ).toFixed(0)} percent over ${input.feed.price}`;
    if (input.priceNow !== null && input.priceNow > input.ceilingDollars) {
      return `${ceiling}, and the curve is at ${dollarWords(
        input.priceNow
      )}, so every buy is refused until ${input.feed.price} catches up.`;
    }
    return `${ceiling}.`;
  }

  if (sale.accessMode === ACCESS_MODE.issuerList) {
    return `Approved wallets only: the issuer's list decides who may buy, and ${capLine}.`;
  }

  if (sale.accessMode === ACCESS_MODE.verifierCredential) {
    return `Approved wallets only: a wallet needs a credential from the sale's verifier, and ${capLine}.`;
  }

  return `Any wallet may buy, and ${capLine}.`;
}

function refused(
  about: { mint: string; pool: string; name: string; money: "dollars" | "SOL" },
  reason: string,
  unanswered = false
): SaleReadout {
  return {
    ...about,
    running: false,
    graduated: false,
    dammPool: null,
    priceNow: null,
    stockName: null,
    feedId: null,
    stockDollars: null,
    ceilingDollars: null,
    priceWarning: null,
    stockPublishedAt: null,
    stockStale: false,
    raised: 0,
    threshold: 0,
    raisedShare: 0,
    buyers: 0,
    sold: 0,
    saleSize: 0,
    cap: 0,
    capOfSale: 0,
    largestShare: 0,
    capOfSold: 0,
    holders: [],
    curve: [],
    rule: "",
    endsAt: null,
    offeringOver: false,
    readAt: Date.now(),
    stale: false,
    missedAt: null,
    failure: reason,
    unanswered,
  };
}

/**
 * The opened sales, oldest first, by the time the scripts say each was opened.
 *
 * Never by where an entry sits in sales.json: an entry appended out of order
 * must not change which sale the page opens on. A time that will not parse
 * sorts as the oldest, and equal times keep their file order.
 */
export function oldestFirst(sales: OpenedSale[]): OpenedSale[] {
  const time = (sale: OpenedSale) => {
    const at = Date.parse(sale.openedAt);
    return Number.isNaN(at) ? 0 : at;
  };
  return [...sales].sort((left, right) => time(left) - time(right));
}

function moneyOf(opened: OpenedSale): "dollars" | "SOL" {
  return opened.quoteMint === WRAPPED_SOL ? "SOL" : "dollars";
}

/**
 * Reads one sale off devnet: the pool, its launch template, its buyer records
 * and, on a banded sale, the published stock price.
 *
 * Every number handed back is measured here. The curve points are the launch
 * template's own, so the path the page draws is the path the program prices on.
 */
async function readSale(opened: OpenedSale): Promise<SaleReadout> {
  const connection = devnetConnection();
  const mint = new PublicKey(opened.mint);
  const view = await loadPool(connection, mint);
  const sale = view.sale;
  const state = view.poolAccount.poolState;

  const quoteDecimals = await quoteDecimalsOf(view);
  const baseDecimals = sale.baseDecimals;

  const start = BigInt(view.configState.sqrtStartPrice.toString());
  const live = segments(view);
  const threshold = BigInt(view.configState.migrationQuoteThreshold.toString());
  const raised = BigInt(state.quoteReserve.toString());
  const end = sqrtPriceAfter(threshold, start, live);
  const now = BigInt(state.sqrtPrice.toString());
  const graduated = raised >= threshold || state.isMigrated !== 0;

  const curve: CurvePoint[] = [];
  const step = (end - start) / BigInt(CURVE_SAMPLES);
  for (let index = 0; index <= CURVE_SAMPLES; index += 1) {
    const sqrtPrice = index === CURVE_SAMPLES ? end : start + step * BigInt(index);
    curve.push({
      sold: whole(sharesSoldAt(sqrtPrice, start, live), baseDecimals),
      price: priceAt(sqrtPrice, baseDecimals, quoteDecimals),
    });
  }

  const soldRaw = sharesSoldAt(now < end ? now : end, start, live);
  const saleSize = whole(sharesSoldAt(end, start, live), baseDecimals);
  const cap = whole(sale.cap, baseDecimals);

  const records = await listBuyerRecords(connection, mint);
  const standing = saleStanding(sale, records);
  const holders: HolderRow[] = records
    .filter((record) => record.netBought > 0n)
    .sort((left, right) => (right.netBought > left.netBought ? 1 : -1))
    .slice(0, 8)
    .map((record) => ({
      wallet: record.wallet.toBase58(),
      shares: whole(record.netBought, baseDecimals),
      share:
        standing.totalNetBought === 0n
          ? 0
          : Number(record.netBought) / Number(standing.totalNetBought),
    }));

  let stockDollars: number | null = null;
  let ceilingDollars: number | null = null;
  let priceWarning: string | null = null;
  let stockPublishedAt: number | null = null;
  let stockStale = false;
  if (sale.hasBand) {
    const reading = await readPrice(connection, sale);
    stockDollars = reading.priceDollars;
    stockPublishedAt = reading.publishTime > 0 ? reading.publishTime * 1000 : null;
    stockStale = reading.error === "PriceStale";

    // The ceiling is worth showing even when the published price has aged out:
    // it is the number the chain last measured a buy against.
    if (reading.price > 0n) {
      ceilingDollars = dollars(priceCeiling({ bandBps: sale.bandBps }, reading.price));
    }
    if (!reading.usable) {
      priceWarning = "no fresh price right now, so buying is paused";
    }
  }

  // Only a finished sale has somewhere else to trade, and finding that pool
  // costs a second read of the curve, so a running sale never pays for it.
  let dammPool: string | null = null;
  if (graduated) {
    dammPool = await saleProgress(connection, mint)
      .then((progress) => progress.dammPool?.toBase58() ?? null)
      .catch(() => null);
  }

  const capOfSale = saleSize === 0 ? 0 : cap / saleSize;

  return {
    mint: opened.mint,
    pool: sale.pool.toBase58(),
    name: opened.name,
    money: moneyOf(opened),
    running: !graduated,
    graduated,
    dammPool,
    priceNow: priceAt(now, baseDecimals, quoteDecimals),
    stockName: sale.hasBand ? "Apple" : null,
    feedId: sale.hasBand ? sale.priceFeedId : null,
    stockDollars,
    ceilingDollars,
    priceWarning,
    stockPublishedAt,
    stockStale,
    raised: whole(raised, quoteDecimals),
    threshold: whole(threshold, quoteDecimals),
    raisedShare:
      threshold === 0n
        ? 0
        : Number((raised * 1_000_000n) / threshold) / 1_000_000,
    buyers: standing.buyers,
    sold: whole(soldRaw, baseDecimals),
    saleSize,
    cap,
    capOfSale,
    largestShare: standing.largestShare,
    capOfSold: standing.capShare,
    holders,
    curve,
    rule: bindingRule(sale, {
      graduated,
      capOfSale,
      ceilingDollars,
      priceNow: priceAt(now, baseDecimals, quoteDecimals),
      priceWarning,
      offeringOver: standing.offeringOver,
      feed: feedWords(sale.hasBand ? sale.priceFeedId : null),
    }),
    endsAt: sale.endsAt,
    offeringOver: standing.offeringOver,
    readAt: Date.now(),
    stale: false,
    missedAt: null,
    failure: null,
    unanswered: false,
  };
}

// The public devnet endpoint answers 429 when several loads land together and
// one sale is about ten reads, so a reading is shared for ten seconds and only
// one is ever in flight per sale. The window matches lib/pulse.ts on purpose:
// the hero and the readout must not show two different readings of one second.
const FRESH_MS = 10_000;

// The last reading devnet answered, per sale, kept for as long as this server
// runs. When a read fails it goes back marked stale instead of a blank page,
// and a miss is remembered for the same ten seconds so an outage does not turn
// every visit into another read of a node that is not answering.
const held = new Map<string, { at: number; readout: SaleReadout }>();
const missed = new Map<string, { at: number; readout: SaleReadout }>();
const reading = new Map<string, Promise<SaleReadout>>();

/**
 * A sale the scripts did not open, found in the chain's own list of sales: one
 * launched from /launch, or a demo sale since retired. Loaded on demand, since
 * lib/directory reaches lib/live-sale, which reads this file.
 *
 * Only a mint the directory knows is ever read, so a stranger naming made-up
 * mints costs devnet the directory's own shared read and nothing per mint (C17).
 */
async function fromDirectory(mint: string): Promise<OpenedSale | "unanswered" | undefined> {
  const { findSale } = await import("./directory");
  const found = await findSale(mint);
  if (!found.found) {
    return found.unanswered ? "unanswered" : undefined;
  }
  const { sale } = found;
  return {
    network: "devnet",
    name: sale.name,
    symbol: sale.symbol,
    mode: String(sale.accessMode),
    mint: sale.mint,
    pool: sale.pool,
    quoteMint: sale.quoteMint ?? "",
    issuer: sale.issuer,
    bandBps: sale.hasBand ? sale.bandBps : null,
    feed: sale.feedId,
    openedAt: sale.openedAt === null ? "" : new Date(sale.openedAt).toISOString(),
  };
}

/** One sale's numbers, live off devnet, shared between the loads that land together. */
export async function readReadout(mint: string): Promise<SaleReadout> {
  const opened = openedSales().find((sale) => sale.mint === mint) ?? (await fromDirectory(mint));
  if (opened === "unanswered") {
    return refused(
      { mint, pool: "", name: "This sale", money: "dollars" },
      "Devnet did not answer, so there is nothing true to show yet.",
      true
    );
  }
  if (opened === undefined) {
    return refused(
      { mint, pool: "", name: "This sale", money: "dollars" },
      "No sale with this mint was opened on Solana devnet."
    );
  }

  const fresh = held.get(mint);
  if (fresh !== undefined && Date.now() - fresh.at < FRESH_MS) {
    return fresh.readout;
  }

  const miss = missed.get(mint);
  if (miss !== undefined && Date.now() - miss.at < FRESH_MS) {
    return miss.readout;
  }

  const inFlight = reading.get(mint);
  if (inFlight !== undefined) {
    return inFlight;
  }

  const about = {
    mint: opened.mint,
    pool: opened.pool,
    name: opened.name,
    money: moneyOf(opened),
  };

  const started = readSale(opened)
    .catch((error: unknown) => {
      // A sale written by an earlier build decodes at the wrong offsets, which
      // is a different thing from devnet being slow, and the page says so.
      if (error instanceof PanguLayoutError) {
        return refused(
          about,
          "This sale was opened by an earlier build of the program, so its numbers cannot be read here."
        );
      }
      const last = held.get(mint);
      if (last !== undefined) {
        return { ...last.readout, stale: true, missedAt: Date.now() };
      }
      return refused(
        about,
        "Devnet did not answer, so there is nothing true to show yet.",
        true
      );
    })
    .then((readout) => {
      if (readout.failure === null && !readout.stale) {
        held.set(mint, { at: Date.now(), readout });
        missed.delete(mint);
      } else {
        missed.set(mint, { at: Date.now(), readout });
      }
      reading.delete(mint);
      return readout;
    });

  reading.set(mint, started);
  return started;
}

/**
 * Every devnet sale, newest first, with whether it still takes buys.
 *
 * Running is read off the tokens themselves in one call: a mint names Pangu as
 * its transfer hook for exactly as long as the sale is open.
 */
export async function readSaleChoices(): Promise<SaleChoice[]> {
  const opened = oldestFirst(openedSales()).reverse();
  const mints = opened.map((sale) => new PublicKey(sale.mint));

  let accounts;
  try {
    accounts = await devnetConnection().getMultipleAccountsInfo(mints);
  } catch {
    return opened.map((sale) => ({ mint: sale.mint, name: sale.name, running: null }));
  }

  return opened.map((sale, index) => {
    const account = accounts[index];
    let running: boolean | null = null;
    if (account !== null && account.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      try {
        const hook = getTransferHook(
          unpackMint(mints[index], account, TOKEN_2022_PROGRAM_ID)
        );
        running = hook !== null && hook.programId.equals(PANGU_PROGRAM_ID);
      } catch {
        running = null;
      }
    }
    return { mint: sale.mint, name: sale.name, running };
  });
}

/**
 * The sale the readout opens on: the live sale lib/live-sale.ts chose when it
 * is in the list, otherwise the newest one still taking buys.
 */
export function defaultChoice(
  choices: SaleChoice[],
  preferred: string | null = null
): SaleChoice | null {
  return (
    choices.find((choice) => preferred !== null && choice.mint === preferred) ??
    choices.find((choice) => choice.running === true) ??
    choices[0] ??
    null
  );
}
