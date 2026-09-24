import { NATIVE_MINT, unpackMint } from "@solana/spl-token";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress,
  type PoolConfig,
  type VirtualPool,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { saleDirectory, type Sale, type SaleDirectoryEntry } from "pangu-sdk";
import { dbcProgram } from "pangu-sdk/dbc";

import record from "../../scripts/sales.json";

import { chooseLiveSale } from "./live-sale";
import { CHAIN, NETWORK, payingUnit, type Money } from "./network";
import type { OpenedSale } from "./sales";
import { chainConnection } from "./solana";

/*
 * Every Pangu sale on the network this app was built for, read off the chain.
 * Server only: it reads through the server's endpoint, which may carry a key,
 * and it asks lib/live-sale which sale the front page leads with, which can
 * reach the demo key.
 *
 * sales.json does not decide which sales exist. It only says which ones are the
 * app's own demo sales, the order they are featured in, and which of them were
 * retired, so a sale launched from /launch shows up here without anyone editing
 * a file.
 */

/** Where a sale stands, in the one word the ledger shows. */
export type SaleState = "running" | "graduated" | "offering-over" | "unknown";

/** One sale as the ledger and the sale page show it. Plain JSON: no bigint, no keys. */
export interface DirectorySale {
  mint: string;
  pool: string;
  /** From the mint's metadata, whatever the issuer typed. The mint is the identity. */
  name: string;
  symbol: string;
  state: SaleState;
  /** True while the mint still names Pangu as its transfer hook. */
  running: boolean;
  graduated: boolean;
  offeringOver: boolean;
  /** Unix seconds the offering ends, or null when it has no end. */
  endsAt: number | null;
  accessMode: number;
  hasBand: boolean;
  bandBps: number;
  /** Lowercase hex, no prefix. Null on a sale with no price band. */
  feedId: string | null;
  /** Null only when neither the rules nor the launch template could be read. */
  quoteMint: string | null;
  money: Money;
  /** True when the sale is paid for in the demo dollar the demo dollars button mints. */
  demoDollar: boolean;
  quoteDecimals: number | null;
  baseDecimals: number;
  /** Whole units of the paying token in the curve, and what it must reach to graduate. */
  raised: number | null;
  threshold: number | null;
  /** Wallets the rules count as holding more than nothing, from the rules account. */
  buyers: number;
  issuer: string;
  /** The DAMM v2 pool, once somebody has sent the migration. */
  dammPool: string | null;
  /** Unix milliseconds the pool opened for trading, when the template counts in seconds. */
  openedAt: number | null;
  /** One of the app's own demo sales from sales.json. */
  featured: boolean;
  /** A demo sale sales.json marks as retired. Hidden unless asked for. */
  retired: boolean;
  layoutVersion: number;
}

/** The rules the sale page reads back, as JSON carries them: raw amounts as decimal strings. */
export interface SaleTermsWire {
  cap: string;
  credential: string;
  schema: string;
  priceAccount: string;
  maxPriceAgeSecs: number;
  maxConfBps: number;
  priceShard: number;
}

export interface Directory {
  sales: DirectorySale[];
  /** Retired demo sales left out of `sales`, so the page can say how many. */
  hiddenRetired: number;
  /** Rules accounts on the program this build cannot read, left out rather than guessed at. */
  skipped: number;
  /** Unix milliseconds of the read this came from. */
  readAt: number;
  /** True when the chain did not answer the latest read and this is the last one that did. */
  stale: boolean;
  /** Set when there is no reading at all. A sentence that says what to do next. */
  failure: string | null;
}

interface Held {
  at: number;
  sales: DirectorySale[];
  rules: Map<string, Sale>;
  skipped: number;
}

// Thirty seconds. The list changes when somebody
// launches a sale, not every block, and the sale page asks again on a miss.
const FRESH_MS = 30_000;

// A mint the held list does not know may be a sale launched a moment ago, so a
// miss reads the chain again, but never more often than this. A stranger asking
// for made-up mints costs the chain one directory read per window, not one per ask.
const MISS_REREAD_MS = 5_000;

// After the chain fails to answer, the next ten seconds are served from what is
// held, the window lib/readout.ts keeps a miss for, so an outage does not turn
// every visit into another read of a node that is not answering.
const FAILED_MS = 10_000;

const NO_ANSWER = `${CHAIN.atStart} did not answer the read of every sale. Press try again in a moment.`;

const WRAPPED_SOL = NATIVE_MINT.toBase58();

const DEMO_SALES = (record as OpenedSale[]).filter((sale) => sale.network === NETWORK);

/**
 * The paying tokens of the demo sales that do not pay in SOL: the demo dollar
 * the demo dollars route mints. Read from the file rather than typed out, so a
 * new demo dollar needs no edit here.
 */
const DEMO_DOLLARS = new Set(
  DEMO_SALES.map((sale) => sale.quoteMint).filter((mint) => mint !== WRAPPED_SOL)
);

let held: Held | null = null;
let failedAt = 0;
let inFlight: Promise<Held> | null = null;

function timeOf(value: string | undefined): number {
  const at = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isNaN(at) ? 0 : at;
}

function stateOf(entry: SaleDirectoryEntry): SaleState {
  if (entry.graduated === true) {
    return "graduated";
  }
  if (entry.offeringOver) {
    return "offering-over";
  }
  return entry.running ? "running" : "unknown";
}

function decimalsOf(info: AccountInfo<Buffer> | null, mint: PublicKey): number | null {
  if (info === null) {
    return null;
  }
  try {
    return unpackMint(mint, info, info.owner).decimals;
  } catch {
    return null;
  }
}

function dammConfigOf(config: PoolConfig): PublicKey | null {
  return DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption] ?? null;
}

/**
 * One read of every sale: the SDK's directory, then the pools, their launch
 * templates, the paying tokens and, for a graduated sale, its DAMM v2 pool,
 * each in one batched call. About six calls whatever the number of sales.
 */
async function readFresh(): Promise<Held> {
  const connection: Connection = chainConnection();
  let skipped = 0;
  const entries = await saleDirectory(connection, { onSkipped: () => (skipped += 1) });

  const program = dbcProgram(connection);
  const pools = (await program.account.transferHookPool.fetchMultiple(
    entries.map((entry) => entry.pool)
  )) as (VirtualPool | null)[];

  const configKeys = [
    ...new Set(
      pools
        .filter((pool): pool is VirtualPool => pool !== null)
        .map((pool) => pool.poolState.config.toBase58())
    ),
  ];
  const templates = (await program.account.configWithTransferHook.fetchMultiple(
    configKeys.map((key) => new PublicKey(key))
  )) as ({ config: PoolConfig } | null)[];
  const configs = new Map<string, PoolConfig>();
  configKeys.forEach((key, index) => {
    const template = templates[index];
    if (template !== null && template !== undefined) {
      configs.set(key, template.config);
    }
  });

  const quoteOf = (index: number): PublicKey | null => {
    const entry = entries[index];
    const pool = pools[index];
    if (entry?.quoteMint != null) {
      return entry.quoteMint;
    }
    // A version 1 sale never stored its paying token. Its template names it.
    const config = pool === null || pool === undefined ? undefined : configs.get(pool.poolState.config.toBase58());
    return config?.quoteMint ?? null;
  };

  const quoteKeys = [
    ...new Set(
      entries
        .map((_, index) => quoteOf(index)?.toBase58())
        .filter((key): key is string => key !== undefined)
    ),
  ];
  const quoteInfos = await connection.getMultipleAccountsInfo(
    quoteKeys.map((key) => new PublicKey(key))
  );
  const quoteDecimals = new Map<string, number | null>();
  quoteKeys.forEach((key, index) => {
    quoteDecimals.set(key, decimalsOf(quoteInfos[index] ?? null, new PublicKey(key)));
  });

  // Where each graduated sale's liquidity would land, asked in one call. The
  // address only means something once the account exists.
  const dammCandidates = entries.map((entry, index) => {
    const pool = pools[index];
    const quote = quoteOf(index);
    const config = pool === null || pool === undefined ? undefined : configs.get(pool.poolState.config.toBase58());
    if (entry.graduated !== true || config === undefined || quote === null) {
      return null;
    }
    const dammConfig = dammConfigOf(config);
    return dammConfig === null ? null : deriveDammV2PoolAddress(dammConfig, entry.mint, quote);
  });
  const dammAsked = dammCandidates.filter((key): key is PublicKey => key !== null);
  const dammInfos =
    dammAsked.length === 0 ? [] : await connection.getMultipleAccountsInfo(dammAsked);
  const dammFound = new Set(
    dammAsked.filter((_, index) => dammInfos[index] !== null).map((key) => key.toBase58())
  );

  const demo = new Map(DEMO_SALES.map((sale) => [sale.mint, sale]));
  const rules = new Map<string, Sale>();

  const sales = entries.map((entry, index): DirectorySale => {
    const mint = entry.mint.toBase58();
    const pool = pools[index] ?? null;
    const config = pool === null ? undefined : configs.get(pool.poolState.config.toBase58());
    const quote = quoteOf(index);
    const quoteKey = quote?.toBase58() ?? null;
    const decimals =
      entry.sale.quoteDecimals > 0
        ? entry.sale.quoteDecimals
        : quoteKey === null
          ? null
          : (quoteDecimals.get(quoteKey) ?? null);
    const scale = decimals === null ? null : 10 ** decimals;
    const raised =
      pool === null || scale === null ? null : Number(pool.poolState.quoteReserve.toString()) / scale;
    const threshold =
      config === undefined || scale === null
        ? null
        : Number(config.migrationQuoteThreshold.toString()) / scale;
    const opened =
      pool !== null && config !== undefined && config.activationType === 1
        ? Number(pool.poolState.activationPoint.toString()) * 1000
        : null;
    const damm = dammCandidates[index]?.toBase58() ?? null;
    const file = demo.get(mint);
    rules.set(mint, entry.sale);

    return {
      mint,
      pool: entry.pool.toBase58(),
      name: entry.name?.trim() || file?.name || "Unnamed sale",
      symbol: entry.symbol?.trim() || file?.symbol || "",
      state: stateOf(entry),
      running: entry.running,
      graduated: entry.graduated === true,
      offeringOver: entry.offeringOver,
      endsAt: entry.endsAt,
      accessMode: entry.accessMode,
      hasBand: entry.hasBand,
      bandBps: entry.sale.bandBps,
      feedId: entry.hasBand ? entry.sale.priceFeedId : null,
      quoteMint: quoteKey,
      money: payingUnit(quoteKey),
      demoDollar: quoteKey !== null && DEMO_DOLLARS.has(quoteKey),
      quoteDecimals: decimals,
      baseDecimals: entry.sale.baseDecimals,
      raised,
      threshold,
      buyers: entry.buyers,
      issuer: entry.issuer.toBase58(),
      dammPool: damm !== null && dammFound.has(damm) ? damm : null,
      openedAt: opened ?? (file === undefined ? null : timeOf(file.openedAt) || null),
      featured: file !== undefined,
      retired: file?.retiredAt !== undefined,
      layoutVersion: entry.sale.layoutVersion,
    };
  });

  return { at: Date.now(), sales, rules, skipped };
}

/**
 * The featured demo sales first: the one the front page leads with, then the
 * rest newest first. Then every other sale, newest first. Retired demo sales go
 * last, for when they are asked for at all.
 */
function ordered(sales: DirectorySale[], lead: string | null): DirectorySale[] {
  const newest = (left: DirectorySale, right: DirectorySale) =>
    (right.openedAt ?? 0) - (left.openedAt ?? 0);
  const featured = sales.filter((sale) => sale.featured && !sale.retired).sort(newest);
  const leading = featured.findIndex((sale) => sale.mint === lead);
  if (leading > 0) {
    featured.unshift(...featured.splice(leading, 1));
  }
  return [
    ...featured,
    ...sales.filter((sale) => !sale.featured).sort(newest),
    ...sales.filter((sale) => sale.retired).sort(newest),
  ];
}

function readShared(): Promise<Held> {
  if (inFlight !== null) {
    return inFlight;
  }
  // One more try straight away: a node behind a load balancer that drops one
  // connection usually takes the next, and the ledger would otherwise show
  // nothing for ten seconds over one lost handshake.
  const started = readFresh()
    .catch(() => readFresh())
    .then((fresh) => {
      held = fresh;
      return fresh;
    })
    .catch((error: unknown) => {
      failedAt = Date.now();
      // The thrown text can carry the keyed endpoint, so the log gets a fixed
      // line and never the message.
      console.error("sale directory: the chain did not answer, the last reading stands");
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = started;
  return started;
}

/**
 * The held reading when it is fresh, a new one otherwise. Null when the chain has
 * never answered. A failed read is not tried again for ten seconds.
 */
async function current(): Promise<{ held: Held; stale: boolean } | null> {
  if (held !== null && Date.now() - held.at < FRESH_MS) {
    return { held, stale: false };
  }
  if (Date.now() - failedAt < FAILED_MS) {
    return held === null ? null : { held, stale: true };
  }
  try {
    return { held: await readShared(), stale: false };
  } catch {
    return held === null ? null : { held, stale: true };
  }
}

/** Every sale for the ledger, ordered, with retired demo sales left out unless `all`. */
export async function readDirectory(all = false): Promise<Directory> {
  const [reading, live] = await Promise.all([
    current(),
    chooseLiveSale().catch(() => null),
  ]);
  if (reading === null) {
    return {
      sales: [],
      hiddenRetired: 0,
      skipped: 0,
      readAt: Date.now(),
      stale: false,
      failure: NO_ANSWER,
    };
  }
  const every = ordered(reading.held.sales, live?.mint ?? null);
  const shown = all ? every : every.filter((sale) => !sale.retired);
  return {
    sales: shown,
    hiddenRetired: every.length - shown.length,
    skipped: reading.held.skipped,
    readAt: reading.held.at,
    stale: reading.stale,
    failure: null,
  };
}

/** What a lookup of one mint found. */
export type Lookup =
  | { found: true; sale: DirectorySale; terms: SaleTermsWire; rules: Sale }
  | { found: false; unanswered: boolean };

/**
 * One sale by its mint, retired or not. A mint the held list does not know
 * reads the chain again once the list is a few seconds old, so a sale launched
 * a moment ago is found without waiting out the thirty seconds.
 *
 * `unanswered` is true when the chain has not answered, which trying again may
 * fix, as against a mint no Pangu sale uses.
 */
export async function findSale(mint: string): Promise<Lookup> {
  let key: string;
  try {
    key = new PublicKey(mint).toBase58();
  } catch {
    return { found: false, unanswered: false };
  }

  let reading = await current();
  const known = (entry: Held | undefined) => entry?.sales.find((sale) => sale.mint === key);
  if (
    reading !== null &&
    known(reading.held) === undefined &&
    Date.now() - reading.held.at >= MISS_REREAD_MS &&
    Date.now() - failedAt >= MISS_REREAD_MS
  ) {
    try {
      reading = { held: await readShared(), stale: false };
    } catch {
      // The held list still answers for every sale it knows.
    }
  }
  if (reading === null) {
    return { found: false, unanswered: true };
  }

  const sale = known(reading.held);
  const rules = reading.held.rules.get(key);
  if (sale === undefined || rules === undefined) {
    return { found: false, unanswered: reading.stale };
  }
  return {
    found: true,
    sale,
    rules,
    terms: {
      cap: rules.cap.toString(),
      credential: rules.credential.toBase58(),
      schema: rules.schema.toBase58(),
      priceAccount: rules.priceAccount.toBase58(),
      maxPriceAgeSecs: rules.maxPriceAgeSecs,
      maxConfBps: rules.maxConfBps,
      priceShard: rules.priceShard,
    },
  };
}
