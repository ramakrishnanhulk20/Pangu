import { Buffer } from "buffer";
import type { BN } from "@anchor-lang/core";
import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { getTransferHook, unpackMint } from "@solana/spl-token";
import { buyerRecordAddress, feedIdHex, saleRulesAddress } from "./addresses.js";
import {
  PANGU_PROGRAM_ID,
  SALE_RULES_LAYOUT_VERSIONS,
  TOKEN_2022_PROGRAM_ID,
} from "./constants.js";
import { panguCoder } from "./coder.js";
import { PanguInputError, requirePublicKey } from "./inputs.js";

const SALE_RULES = "SaleRules";
const BUYER_RECORD = "BuyerRecord";

/**
 * Thrown when a SaleRules account was not written by the layout this package
 * reads: the wrong length, or a layout version it does not know.
 *
 * Both are the same failure seen from two sides. Anchor's decoder reads every
 * field at a fixed offset and does not care what wrote the bytes, so an account
 * from another build comes back as a sale with a nonsense cap or a nonsense
 * band rather than as an error. It is a PanguInputError, so a caller that
 * already handles those keeps working.
 */
export class PanguLayoutError extends PanguInputError {
  constructor(message: string) {
    super(message);
    this.name = "PanguLayoutError";
  }
}

/** One sale's rules, as the chain holds them. Written once, never updated. */
export interface Sale {
  mint: PublicKey;
  pool: PublicKey;
  baseVault: PublicKey;
  issuer: PublicKey;
  /** Raw token units, so a six decimal token's cap of 100 reads as 100000000n. */
  cap: bigint;
  accessMode: number;
  credential: PublicKey;
  schema: PublicKey;
  /** Band only: the Pyth price feed account the hook reads. */
  priceAccount: PublicKey;
  bandBps: number;
  /** Lowercase hex, no prefix, the way the feed scripts print an id. */
  priceFeedId: string;
  /** The Pyth shard the price account was derived under. */
  priceShard: number;
  /** How old the published price may be on a buy, in seconds. */
  maxPriceAgeSecs: number;
  /** The widest confidence interval this sale buys against, in basis points. */
  maxConfBps: number;
  /**
   * Decimals of the sale token. The program only stores these on a sale with a
   * price band, so the chain holds zero for every other sale. `getSale` fills
   * that in from the mint itself; `decodeSale`, which only has the bytes in
   * front of it, hands back the zero the account really holds.
   */
  baseDecimals: number;
  /** Decimals of the paying token, stored only on a sale with a price band. */
  quoteDecimals: number;
  buyers: number;
  totalNetBought: bigint;
  bump: number;
  /** Which layout wrote this account: 1 or 2. */
  layoutVersion: number;
  /**
   * The token buyers pay in, stored by layout 2 onwards. Null on a version 1
   * sale, which never recorded it; its launch template still names it.
   */
  quoteMint: PublicKey | null;
  /**
   * Unix seconds at which the offering period ends and every rule lifts. Null
   * when the sale has no end, which includes every version 1 sale.
   */
  endsAt: number | null;
  /** Spare bytes the program keeps so the account can grow later. */
  reserved: Uint8Array;
  /** True when this sale has a price band, matching SaleRules::has_band. */
  hasBand: boolean;
}

/** One wallet's standing in one sale. */
export interface BuyerRecord {
  mint: PublicKey;
  wallet: PublicKey;
  approved: boolean;
  /** Tokens received from the pool minus tokens sold back, in raw units. */
  netBought: bigint;
  bump: number;
}

interface RawSale {
  mint: PublicKey;
  pool: PublicKey;
  base_vault: PublicKey;
  issuer: PublicKey;
  cap: BN;
  access_mode: number;
  credential: PublicKey;
  schema: PublicKey;
  price_account: PublicKey;
  price_feed_id: number[];
  price_shard: number;
  band_bps: number;
  max_price_age_secs: number;
  max_conf_bps: number;
  base_decimals: number;
  quote_decimals: number;
  buyers: number;
  total_net_bought: BN;
  bump: number;
  layout_version: number;
  quote_mint: PublicKey;
  ends_at: BN;
  reserved: number[];
}

interface RawBuyerRecord {
  mint: PublicKey;
  wallet: PublicKey;
  approved: boolean;
  net_bought: BN;
  bump: number;
}

function asBuffer(data: Uint8Array): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function big(value: BN): bigint {
  return BigInt(value.toString());
}

function decodeAccount<T>(name: string, data: Uint8Array): T {
  try {
    return panguCoder().accounts.decode<T>(name, asBuffer(data));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PanguInputError(`these bytes are not a Pangu ${name}: ${reason}`);
  }
}

/**
 * Reads a SaleRules account's bytes.
 *
 * The discriminator says these are a SaleRules, then the length and the layout
 * version say which build wrote them. Versions 1 and 2 are read; on version 1
 * the paying token and the end of the offering come back as null, because
 * those bytes were spare zeros then. Anything else throws a `PanguLayoutError`,
 * because an account from another build sits at the same address behind the
 * same discriminator: Anchor reads it without complaint and hands back fields
 * taken from the wrong offsets.
 *
 * Throws `PanguInputError` when the bytes are not a SaleRules at all.
 */
export function decodeSale(data: Uint8Array): Sale {
  const raw = decodeAccount<RawSale>(SALE_RULES, data);
  const size = panguCoder().accounts.size(SALE_RULES);
  if (data.length !== size) {
    throw new PanguLayoutError(
      `a SaleRules account is ${size} bytes and these are ${data.length}, so they were written by another build of the program`
    );
  }
  if (!SALE_RULES_LAYOUT_VERSIONS.has(raw.layout_version)) {
    throw new PanguLayoutError(
      `these are layout version ${raw.layout_version} and this package reads versions ${[...SALE_RULES_LAYOUT_VERSIONS].join(" and ")}, so they were written by another build of the program`
    );
  }
  const newFields = raw.layout_version >= 2;
  const endsAt = newFields ? Number(big(raw.ends_at)) : 0;
  return {
    mint: raw.mint,
    pool: raw.pool,
    baseVault: raw.base_vault,
    issuer: raw.issuer,
    cap: big(raw.cap),
    accessMode: raw.access_mode,
    credential: raw.credential,
    schema: raw.schema,
    priceAccount: raw.price_account,
    bandBps: raw.band_bps,
    priceFeedId: feedIdHex(raw.price_feed_id),
    priceShard: raw.price_shard,
    maxPriceAgeSecs: raw.max_price_age_secs,
    maxConfBps: raw.max_conf_bps,
    baseDecimals: raw.base_decimals,
    quoteDecimals: raw.quote_decimals,
    buyers: raw.buyers,
    totalNetBought: big(raw.total_net_bought),
    bump: raw.bump,
    layoutVersion: raw.layout_version,
    quoteMint: newFields ? raw.quote_mint : null,
    endsAt: endsAt === 0 ? null : endsAt,
    reserved: Uint8Array.from(raw.reserved),
    hasBand: raw.band_bps > 0,
  };
}

/** Reads a BuyerRecord account's bytes. Throws when they are not a BuyerRecord. */
export function decodeBuyerRecord(data: Uint8Array): BuyerRecord {
  const raw = decodeAccount<RawBuyerRecord>(BUYER_RECORD, data);
  return {
    mint: raw.mint,
    wallet: raw.wallet,
    approved: raw.approved,
    netBought: big(raw.net_bought),
    bump: raw.bump,
  };
}

function ownedByPangu(owner: PublicKey, address: PublicKey): void {
  if (!owner.equals(PANGU_PROGRAM_ID)) {
    throw new PanguInputError(
      `${address.toBase58()} is owned by ${owner.toBase58()}, not by Pangu`
    );
  }
}

/**
 * The rules of the sale for this mint, or null when no sale was ever opened.
 *
 * An account sitting at the rules address that Pangu does not own is refused
 * rather than decoded, because at that point the reader cannot tell what the
 * bytes mean.
 *
 * A sale with no price band stores no decimals, because the hook never needs
 * them, so one more read fills `baseDecimals` from the mint. That keeps every
 * caller turning raw units into an amount a person reads off one field instead
 * of each one remembering the exception. A mint that cannot be read leaves the
 * zero in place.
 */
export async function getSale(
  connection: Connection,
  mint: PublicKey
): Promise<Sale | null> {
  const address = saleRulesAddress(mint);
  const info = await connection.getAccountInfo(address);
  if (info === null) {
    return null;
  }
  ownedByPangu(info.owner, address);
  const sale = decodeSale(info.data);
  if (sale.baseDecimals === 0) {
    const decimals = await mintDecimals(connection, sale.mint);
    if (decimals !== null) {
      return { ...sale, baseDecimals: decimals };
    }
  }
  return sale;
}

async function mintDecimals(
  connection: Connection,
  mint: PublicKey
): Promise<number | null> {
  const info = await connection.getAccountInfo(mint);
  if (info === null || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return null;
  }
  try {
    return unpackMint(mint, info, TOKEN_2022_PROGRAM_ID).decimals;
  } catch {
    return null;
  }
}

/** One wallet's record in this sale, or null when the wallet has none yet. */
export async function getBuyerRecord(
  connection: Connection,
  mint: PublicKey,
  wallet: PublicKey
): Promise<BuyerRecord | null> {
  const address = buyerRecordAddress(mint, wallet);
  const info = await connection.getAccountInfo(address);
  if (info === null) {
    return null;
  }
  ownedByPangu(info.owner, address);
  return decodeBuyerRecord(info.data);
}

/**
 * Every buyer record of one sale.
 *
 * The filter is the record discriminator followed by the sale's mint, which is
 * the record's first field, so the node only returns this sale's records. The
 * caller pays for one scan, and an RPC that refuses getProgramAccounts will
 * throw rather than return a short list.
 */
export async function listBuyerRecords(
  connection: Connection,
  mint: PublicKey
): Promise<BuyerRecord[]> {
  const coder = panguCoder().accounts;
  const accounts = await connection.getProgramAccounts(PANGU_PROGRAM_ID, {
    filters: [
      { dataSize: coder.size(BUYER_RECORD) },
      { memcmp: coder.memcmp(BUYER_RECORD, requirePublicKey(mint, "mint").toBuffer()) },
    ],
  });
  return accounts.map((entry) => decodeBuyerRecord(entry.account.data));
}

/** What `listSales` can be told, beyond the connection. */
export interface ListSalesOptions {
  /**
   * Called once for every rules account left out of the list, with its address
   * and the reason in words. Count the calls to know how many were skipped.
   */
  onSkipped?: (address: PublicKey, reason: string) => void;
}

/**
 * Every sale the Pangu program holds rules for, in no particular order.
 *
 * One scan, filtered by the node on the SaleRules discriminator and on the size
 * this build writes, so buyer records and the larger accounts an earlier build
 * left behind never come back. An account of the right size that this package
 * cannot read, a layout version it does not know, or one that does not sit at
 * the rules address of the mint it names, is skipped and reported through
 * `onSkipped` rather than thrown, so one stray account cannot hide every other
 * sale. Each sale comes back exactly as `decodeSale` reads it, so a sale with no
 * price band still shows zero decimals here; `getSale` or `saleDirectory` fill
 * them from the mint.
 *
 * Throws when the node refuses the scan, because a short list would look like
 * a complete one.
 */
export async function listSales(
  connection: Connection,
  options: ListSalesOptions = {}
): Promise<Sale[]> {
  const coder = panguCoder().accounts;
  const accounts = await connection.getProgramAccounts(PANGU_PROGRAM_ID, {
    filters: [{ dataSize: coder.size(SALE_RULES) }, { memcmp: coder.memcmp(SALE_RULES) }],
  });
  const sales: Sale[] = [];
  for (const entry of accounts) {
    let sale: Sale;
    try {
      sale = decodeSale(entry.account.data);
    } catch (error) {
      if (!(error instanceof PanguInputError)) {
        throw error;
      }
      options.onSkipped?.(entry.pubkey, error.message);
      continue;
    }
    if (!saleRulesAddress(sale.mint).equals(entry.pubkey)) {
      options.onSkipped?.(
        entry.pubkey,
        `these rules name ${sale.mint.toBase58()}, whose rules live at another address`
      );
      continue;
    }
    sales.push(sale);
  }
  return sales;
}

/**
 * Whether the sale is still running, read off the token itself.
 *
 * The rules live on while the mint names Pangu as its transfer hook. DBC clears
 * that name in the trade that completes the curve, and from then on the token
 * moves freely and any buyer can close their record. This is not a gate on
 * closing: a record holding nothing closes while the sale is still running. A
 * mint that does not exist, is not a Token-2022 mint, or names another hook is
 * not a running Pangu sale.
 */
export async function isSaleRunning(
  connection: Connection,
  mint: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(requirePublicKey(mint, "mint"));
  return mintRunsPangu(mint, info);
}

/**
 * The running check of `isSaleRunning` on mint bytes already in hand, so a
 * caller that fetched many mints in one call judges each the same way. Throws
 * when a Token-2022 account's bytes are not a mint.
 */
export function mintRunsPangu(
  mint: PublicKey,
  info: AccountInfo<Uint8Array> | null
): boolean {
  if (info === null || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return false;
  }
  const state = unpackMint(mint, info as AccountInfo<Buffer>, TOKEN_2022_PROGRAM_ID);
  const hook = getTransferHook(state);
  if (hook === null) {
    return false;
  }
  return hook.programId.equals(PANGU_PROGRAM_ID);
}
