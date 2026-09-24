import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import type { VirtualPool } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ACCESS_MODE,
  buyerRecordAddress,
  credentialStatus,
  curvePriceDollars,
  decodeBuyerRecord,
  dollars,
  saleTokenInfo,
  type BuyerRecord,
} from "pangu-sdk";
import { dbcProgram } from "pangu-sdk/dbc";

import { findSale, readDirectory, type DirectorySale, type SaleState } from "./directory";
import { CHAIN, type Money } from "./network";
import { chainConnection } from "./solana";

/*
 * One wallet's place in every Pangu sale: what it holds, what the cap still
 * lets it buy, whether the rules let it buy at all, and the sales it issued.
 * Server only: every read goes through the server's own endpoint, which
 * may carry a key, and the directory it starts from is server only too.
 */

/** Where a credential sale's verifier stands on this wallet, as the SDK's check answers. */
export type CredentialWord = "valid" | "expired" | "absent" | "unread";

/** One sale the wallet is in. Raw amounts travel as decimal strings: JSON has no bigint. */
export interface Holding {
  mint: string;
  name: string;
  symbol: string;
  /** The metadata link the mint carries, where the token's logo is named. Null when it carries none. */
  uri: string | null;
  state: SaleState;
  graduated: boolean;
  offeringOver: boolean;
  /** Unix seconds the offering ends, or null for a sale with no end. */
  endsAt: number | null;
  accessMode: number;
  retired: boolean;
  pool: string;
  dammPool: string | null;
  money: Money;
  quoteMint: string | null;
  baseDecimals: number;
  /** Raw units of the sale token in the wallet's own account for it. */
  held: string;
  /** False when the wallet has no buyer record in this sale, only tokens. */
  hasRecord: boolean;
  /** Raw units bought net of sells, from the buyer record. "0" with no record. */
  netBought: string;
  /** Raw units of one wallet's cap, and what is left of it for this wallet. */
  cap: string;
  capRoom: string;
  /** On the issuer's list. Null on a sale that is not list mode. */
  approved: boolean | null;
  /** Null on a sale that is not credential mode. */
  credential: CredentialWord | null;
  /** Whole units of the paying token one whole share costs on the curve. Null when unreadable. */
  price: number | null;
  /** The holding at that price, in whole units of the paying token. */
  value: number | null;
}

/** One sale the wallet issued, as the issued ledger shows it. */
export interface Issued {
  mint: string;
  name: string;
  symbol: string;
  uri: string | null;
  state: SaleState;
  graduated: boolean;
  offeringOver: boolean;
  endsAt: number | null;
  accessMode: number;
  retired: boolean;
  dammPool: string | null;
  money: Money;
  buyers: number;
  raised: number | null;
  threshold: number | null;
}

/** What a holding is worth in one paying token. Two paying tokens are never added together. */
export interface Total {
  quoteMint: string;
  money: Money;
  demoDollar: boolean;
  sales: number;
  value: number;
  /** Holdings in this token whose price could not be read, so the value leaves them out. */
  unpriced: number;
}

export interface Portfolio {
  wallet: string;
  holdings: Holding[];
  issued: Issued[];
  totals: Total[];
  /** Unix milliseconds of the read this came from. */
  readAt: number;
  /** True when the chain did not answer the latest read and this is the last one that did. */
  stale: boolean;
  /** Set when there is no reading at all. A sentence that says what to do next. */
  failure: string | null;
}

/** What the route answers: a portfolio, or a refusal with the status to send. */
export type PortfolioAnswer =
  | { ok: true; portfolio: Portfolio }
  | { ok: false; status: 400 | 429; reason: string };

// Fifteen seconds: long enough that a page polling
// and a second tab share one read, short enough that a sell shows on the next.
const FRESH_MS = 15_000;

// After the chain fails to answer for a wallet, the next ten seconds are served
// from what is held, the window the directory keeps a miss for.
const FAILED_MS = 10_000;

// A stranger asking about made-up wallets costs the chain about four calls each.
// This many fresh wallets per window, across every visitor, is plenty for real
// use and caps what a script can spend of the keyed endpoint.
const NEW_READS_PER_WINDOW = 24;
const NEW_READS_WINDOW_MS = 10_000;

// Oldest wallets are dropped past this many, so the held answers never grow without end.
const MOST_HELD = 500;

// getMultipleAccountsInfo takes at most one hundred addresses a call.
const BATCH = 100;

const NO_ANSWER = `${CHAIN.atStart} did not answer the read of this wallet. Press read again in a moment.`;
const BUSY =
  "This server is reading a lot of wallets right now. Wait ten seconds, then read again.";

interface Slot {
  at: number;
  portfolio: Portfolio | null;
  failedAt: number;
  inFlight: Promise<Portfolio> | null;
}

const slots = new Map<string, Slot>();
let windowStart = 0;
let windowReads = 0;

async function accountsOf(
  connection: Connection,
  keys: readonly PublicKey[]
): Promise<(AccountInfo<Buffer> | null)[]> {
  const found: (AccountInfo<Buffer> | null)[] = [];
  for (let start = 0; start < keys.length; start += BATCH) {
    found.push(...(await connection.getMultipleAccountsInfo(keys.slice(start, start + BATCH), "confirmed")));
  }
  return found;
}

/** Raw units in a Token-2022 holding account. The amount sits at byte 64 in both token programs. */
function amountIn(info: AccountInfo<Buffer> | null): bigint {
  if (info === null || !info.owner.equals(TOKEN_2022_PROGRAM_ID) || info.data.length < 72) {
    return 0n;
  }
  return info.data.readBigUInt64LE(64);
}

function recordIn(info: AccountInfo<Buffer> | null): BuyerRecord | null {
  if (info === null) {
    return null;
  }
  try {
    return decodeBuyerRecord(info.data);
  } catch {
    return null;
  }
}

/** Whole paying units per whole share, off the pool's square root price. */
function priceOf(pool: VirtualPool | null, sale: DirectorySale): number | null {
  if (pool === null || sale.quoteDecimals === null) {
    return null;
  }
  const sqrtPrice = BigInt(pool.poolState.sqrtPrice.toString());
  return dollars(curvePriceDollars(sqrtPrice, sale.baseDecimals, sale.quoteDecimals));
}

function issuedOf(sale: DirectorySale, uri: string | null): Issued {
  return {
    mint: sale.mint,
    name: sale.name,
    symbol: sale.symbol,
    uri,
    state: sale.state,
    graduated: sale.graduated,
    offeringOver: sale.offeringOver,
    endsAt: sale.endsAt,
    accessMode: sale.accessMode,
    retired: sale.retired,
    dammPool: sale.dammPool,
    money: sale.money,
    buyers: sale.buyers,
    raised: sale.raised,
    threshold: sale.threshold,
  };
}

function totalsOf(holdings: readonly Holding[], sales: readonly DirectorySale[]): Total[] {
  const demo = new Map(sales.map((sale) => [sale.mint, sale.demoDollar]));
  const byToken = new Map<string, Total>();
  for (const holding of holdings) {
    if (holding.quoteMint === null) {
      continue;
    }
    const total = byToken.get(holding.quoteMint) ?? {
      quoteMint: holding.quoteMint,
      money: holding.money,
      demoDollar: demo.get(holding.mint) ?? false,
      sales: 0,
      value: 0,
      unpriced: 0,
    };
    total.sales += 1;
    if (holding.value === null) {
      total.unpriced += 1;
    } else {
      total.value += holding.value;
    }
    byToken.set(holding.quoteMint, total);
  }
  // Dollars first, then SOL, then any stock token, each by value, so the
  // biggest number leads its kind.
  const rank = (money: Money) => (money === "dollars" ? 0 : money === "SOL" ? 1 : 2);
  return [...byToken.values()].sort(
    (left, right) =>
      rank(left.money) - rank(right.money) ||
      left.money.localeCompare(right.money) ||
      right.value - left.value
  );
}

/**
 * One read of one wallet: the directory (shared, thirty seconds), then the
 * wallet's holding account and buyer record for every sale in one batch per
 * hundred sales, then the pools of the sales it is in, the metadata link of
 * each sale shown, and the verifier's answer for each credential sale it is in.
 */
async function readFresh(wallet: PublicKey): Promise<Portfolio> {
  const directory = await readDirectory(true);
  if (directory.failure !== null) {
    throw new Error("directory unanswered");
  }
  const connection = chainConnection();
  const sales = directory.sales;

  const keys: PublicKey[] = [];
  for (const sale of sales) {
    const mint = new PublicKey(sale.mint);
    // allowOwnerOffCurve: a program's vault can hold sale tokens too, and its
    // holding account is derived the same way.
    keys.push(getAssociatedTokenAddressSync(mint, wallet, true, TOKEN_2022_PROGRAM_ID));
    keys.push(buyerRecordAddress(mint, wallet));
  }
  const infos = await accountsOf(connection, keys);

  const inSales = sales
    .map((sale, index) => ({
      sale,
      held: amountIn(infos[index * 2] ?? null),
      record: recordIn(infos[index * 2 + 1] ?? null),
    }))
    .filter((entry) => entry.held > 0n || entry.record !== null);

  const program = dbcProgram(connection);
  const pools =
    inSales.length === 0
      ? []
      : ((await program.account.transferHookPool.fetchMultiple(
          inSales.map((entry) => new PublicKey(entry.sale.pool))
        )) as (VirtualPool | null)[]);

  // The directory keeps no metadata link, so each sale shown here has its mint
  // read once more. A mint that does not answer only loses its logo.
  const who = wallet.toBase58();
  const issuedSales = sales.filter((sale) => sale.issuer === who);
  const shown = [...new Set([...inSales.map((entry) => entry.sale.mint), ...issuedSales.map((sale) => sale.mint)])];
  const tokenInfos = await Promise.all(
    shown.map((mint) => saleTokenInfo(connection, new PublicKey(mint)).catch(() => null))
  );
  const uris = new Map(
    shown.map((mint, index) => {
      const link = tokenInfos[index]?.uri.trim() ?? "";
      return [mint, link === "" ? null : link] as const;
    })
  );

  const holdings = await Promise.all(
    inSales.map(async ({ sale, held, record }, index): Promise<Holding> => {
      const lookup = await findSale(sale.mint);
      const rules = lookup.found ? lookup.rules : null;
      const cap = rules?.cap ?? 0n;
      const netBought = record?.netBought ?? 0n;
      const left = cap - netBought;

      let credential: CredentialWord | null = null;
      if (sale.accessMode === ACCESS_MODE.verifierCredential) {
        credential =
          rules === null
            ? "unread"
            : await credentialStatus(connection, rules.credential, rules.schema, wallet).catch(
                (): CredentialWord => "unread"
              );
      }

      const price = priceOf(pools[index] ?? null, sale);
      const scale = 10 ** sale.baseDecimals;
      return {
        mint: sale.mint,
        name: sale.name,
        symbol: sale.symbol,
        uri: uris.get(sale.mint) ?? null,
        state: sale.state,
        graduated: sale.graduated,
        offeringOver: sale.offeringOver,
        endsAt: sale.endsAt,
        accessMode: sale.accessMode,
        retired: sale.retired,
        pool: sale.pool,
        dammPool: sale.dammPool,
        money: sale.money,
        quoteMint: sale.quoteMint,
        baseDecimals: sale.baseDecimals,
        held: held.toString(),
        hasRecord: record !== null,
        netBought: netBought.toString(),
        cap: cap.toString(),
        capRoom: (left > 0n ? left : 0n).toString(),
        approved: sale.accessMode === ACCESS_MODE.issuerList ? (record?.approved ?? false) : null,
        credential,
        price,
        value: price === null ? null : (Number(held) / scale) * price,
      };
    })
  );

  return {
    wallet: who,
    holdings,
    issued: issuedSales.map((sale) => issuedOf(sale, uris.get(sale.mint) ?? null)),
    totals: totalsOf(holdings, sales),
    readAt: Date.now(),
    stale: directory.stale,
    failure: null,
  };
}

function slotOf(wallet: string): Slot {
  let slot = slots.get(wallet);
  if (slot === undefined) {
    slot = { at: 0, portfolio: null, failedAt: 0, inFlight: null };
    slots.set(wallet, slot);
    if (slots.size > MOST_HELD) {
      const oldest = slots.keys().next().value;
      if (oldest !== undefined && oldest !== wallet) {
        slots.delete(oldest);
      }
    }
  }
  return slot;
}

/** True when one more wallet may be read fresh in this window. */
function takeNewRead(): boolean {
  const now = Date.now();
  if (now - windowStart >= NEW_READS_WINDOW_MS) {
    windowStart = now;
    windowReads = 0;
  }
  if (windowReads >= NEW_READS_PER_WINDOW) {
    return false;
  }
  windowReads += 1;
  return true;
}

function readShared(slot: Slot, wallet: PublicKey): Promise<Portfolio> {
  if (slot.inFlight !== null) {
    return slot.inFlight;
  }
  // One more try straight away, as the directory does: one dropped connection
  // should not blank the page for ten seconds.
  const started = readFresh(wallet)
    .catch(() => readFresh(wallet))
    .then((fresh) => {
      slot.at = fresh.readAt;
      slot.portfolio = fresh;
      return fresh;
    })
    .catch((error: unknown) => {
      slot.failedAt = Date.now();
      // The thrown text can carry the keyed endpoint, so the log gets a fixed line.
      console.error("portfolio: the chain did not answer, the last reading stands");
      throw error;
    })
    .finally(() => {
      slot.inFlight = null;
    });
  slot.inFlight = started;
  return started;
}

function unanswered(wallet: string): Portfolio {
  return {
    wallet,
    holdings: [],
    issued: [],
    totals: [],
    readAt: Date.now(),
    stale: false,
    failure: NO_ANSWER,
  };
}

/**
 * One wallet's portfolio, shared for fifteen seconds per wallet. A failed read
 * is not tried again for ten seconds, and the last good one is served stale
 * meanwhile.
 */
export async function readPortfolio(address: string): Promise<PortfolioAnswer> {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(address);
  } catch {
    return { ok: false, status: 400, reason: "That is not a Solana address." };
  }
  const key = wallet.toBase58();
  const slot = slots.get(key);

  if (slot?.portfolio != null && Date.now() - slot.at < FRESH_MS) {
    return { ok: true, portfolio: slot.portfolio };
  }
  if (slot !== undefined && Date.now() - slot.failedAt < FAILED_MS) {
    return {
      ok: true,
      portfolio: slot.portfolio === null ? unanswered(key) : { ...slot.portfolio, stale: true },
    };
  }
  if (slot?.inFlight == null && slot?.portfolio == null && !takeNewRead()) {
    return { ok: false, status: 429, reason: BUSY };
  }

  const mine = slot ?? slotOf(key);
  try {
    return { ok: true, portfolio: await readShared(mine, wallet) };
  } catch {
    return {
      ok: true,
      portfolio: mine.portfolio === null ? unanswered(key) : { ...mine.portfolio, stale: true },
    };
  }
}
