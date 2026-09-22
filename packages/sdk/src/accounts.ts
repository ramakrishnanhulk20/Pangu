import { Buffer } from "buffer";
import type { BN } from "@anchor-lang/core";
import type { Connection, PublicKey } from "@solana/web3.js";
import { getTransferHook, unpackMint } from "@solana/spl-token";
import { buyerRecordAddress, feedIdHex, saleRulesAddress } from "./addresses.js";
import { PANGU_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants.js";
import { panguCoder } from "./coder.js";
import { PanguInputError, requirePublicKey } from "./inputs.js";

const SALE_RULES = "SaleRules";
const BUYER_RECORD = "BuyerRecord";

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

/** Reads a SaleRules account's bytes. Throws when they are not a SaleRules. */
export function decodeSale(data: Uint8Array): Sale {
  const raw = decodeAccount<RawSale>(SALE_RULES, data);
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
  if (info === null || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return false;
  }
  const state = unpackMint(mint, info, TOKEN_2022_PROGRAM_ID);
  const hook = getTransferHook(state);
  if (hook === null) {
    return false;
  }
  return hook.programId.equals(PANGU_PROGRAM_ID);
}
