import {
  SYSVAR_CLOCK_PUBKEY,
  PublicKey as Web3PublicKey,
  type Connection,
  type PublicKey,
} from "@solana/web3.js";
import type { Sale } from "./accounts.js";
import { priceFeedAddress } from "./addresses.js";
import { confidenceBps, dollars, stockPriceDollars } from "./band.js";
import { LIMITS, PYTH_RECEIVER_PROGRAM_ID } from "./constants.js";
import type { PanguErrorName } from "./errors.js";
import { explainPanguError } from "./errors.js";
import { PanguInputError } from "./inputs.js";

/** What one Pyth price feed account carries. */
export interface PriceUpdate {
  /** The key Pyth's receiver program recorded as having written this update. */
  writeAuthority: PublicKey;
  /** True when two thirds of the Wormhole guardians signed it. */
  fullyVerified: boolean;
  /** Lowercase hex, no prefix, matching Sale.priceFeedId. */
  feedId: string;
  /** Pyth's whole number. The dollar price is this times ten to the exponent. */
  price: bigint;
  /** How wide the publishers' disagreement is, in the same units as the price. */
  conf: bigint;
  exponent: number;
  /** Unix seconds Pyth's publishers agreed this price. */
  publishTime: number;
  prevPublishTime: number;
  /** The Solana slot the update was posted in. */
  postedSlot: bigint;
}

/** A sale's live stock price, and whether a buy could use it right now. */
export interface PriceReading {
  /** The Pyth price feed account this sale reads. */
  address: PublicKey;
  /** The stock price in dollars, scaled by 1e18. Zero when there is none. */
  price: bigint;
  /** The same price as an ordinary number, for display. */
  priceDollars: number;
  /** Unix seconds the price was published, or zero when unknown. */
  publishTime: number;
  /** How old it is, in seconds, against the chain's own clock. */
  ageSecs: number;
  /** Pyth's confidence interval as basis points of the price, rounded up. */
  confBps: number;
  /** True when two thirds of the Wormhole guardians signed the update. */
  fullyVerified: boolean;
  usable: boolean;
  /** Why it cannot be used, as the program's own refusal. Null when usable. */
  error: PanguErrorName | null;
  /** One sentence for a buyer. Null when usable. */
  reason: string | null;
}

/**
 * The first eight bytes of sha256("account:PriceUpdateV2"), the discriminator
 * Anchor writes in front of every price feed account. Read off Pyth's own
 * mainnet AAPL account, see docs/measurements/price-band-pyth.md.
 */
const DISCRIMINATOR = [34, 241, 35, 99, 157, 126, 244, 205];

/**
 * Borsh writes `VerificationLevel::Partial { num_signatures }` first and `Full`
 * second, so Partial is tag 0 followed by one more byte and Full is tag 1 with
 * nothing after it. Every offset after the tag moves by one on a Partial
 * update, which is why the tag is read before any field is.
 */
const PARTIAL_TAG = 0;
const FULL_TAG = 1;

const WRITE_AUTHORITY_OFFSET = 8;
const VERIFICATION_OFFSET = 40;

/** price.rs PUBLISH_FUTURE_TOLERANCE_SECS: Pyth's clock is not Solana's. */
const PUBLISH_FUTURE_TOLERANCE_SECS = 60;

/** Where the Clock sysvar keeps its Unix time: slot, epoch start, epoch, schedule. */
const CLOCK_UNIX_TIMESTAMP_OFFSET = 32;

function slice(data: Uint8Array, start: number, length: number): Uint8Array {
  const end = start + length;
  if (start < 0 || length < 0 || end > data.length) {
    throw new PanguInputError(
      "these bytes are not a Pyth price update: they end before the layout does"
    );
  }
  return data.subarray(start, end);
}

function hex(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unsigned(data: Uint8Array, offset: number, length: number): bigint {
  const bytes = slice(data, offset, length);
  let value = 0n;
  for (let index = length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0);
  }
  return value;
}

function signed(data: Uint8Array, offset: number, length: number): bigint {
  const value = unsigned(data, offset, length);
  const bits = BigInt(length * 8);
  return value >= 1n << (bits - 1n) ? value - (1n << bits) : value;
}

/**
 * Reads a Pyth price feed account without the Pyth package.
 *
 * Every offset is the one `programs/pangu/src/price.rs` reads on chain through
 * Pyth's own Rust SDK, checked against the real account bytes in
 * docs/measurements/price-band-pyth.md. Safe in a browser: it is arithmetic
 * over bytes the caller already has, and it pulls in nothing.
 *
 * A partly verified update is decoded rather than refused, because the caller
 * has to be able to say which of the two it is. `fullyVerified` is the answer,
 * and `readPrice` refuses on it.
 *
 * Throws PanguInputError for anything that is not a well formed price update.
 */
export function decodePriceUpdate(data: Uint8Array): PriceUpdate {
  const discriminator = slice(data, 0, DISCRIMINATOR.length);
  if (DISCRIMINATOR.some((byte, index) => discriminator[index] !== byte)) {
    throw new PanguInputError("these bytes are not a Pyth price feed account");
  }

  const tag = slice(data, VERIFICATION_OFFSET, 1)[0];
  if (tag !== FULL_TAG && tag !== PARTIAL_TAG) {
    throw new PanguInputError(
      `${String(tag)} is not a verification level Pyth writes, so these bytes cannot be read`
    );
  }
  const message = VERIFICATION_OFFSET + (tag === FULL_TAG ? 1 : 2);

  return {
    writeAuthority: new Web3PublicKey(slice(data, WRITE_AUTHORITY_OFFSET, 32)),
    fullyVerified: tag === FULL_TAG,
    feedId: hex(slice(data, message, 32)),
    price: signed(data, message + 32, 8),
    conf: unsigned(data, message + 40, 8),
    exponent: Number(signed(data, message + 48, 4)),
    publishTime: Number(signed(data, message + 52, 8)),
    prevPublishTime: Number(signed(data, message + 60, 8)),
    postedSlot: unsigned(data, message + 84, 8),
  };
}

function unusable(
  address: PublicKey,
  error: PanguErrorName,
  partial: Partial<PriceReading> = {}
): PriceReading {
  return {
    address,
    price: 0n,
    priceDollars: 0,
    publishTime: 0,
    ageSecs: 0,
    confBps: 0,
    fullyVerified: false,
    usable: false,
    error,
    reason: explainPanguError(error),
    ...partial,
  };
}

/**
 * The live stock price a banded sale checks against, read straight off the
 * chain, plus whether a buy could use it this moment.
 *
 * Runs the hook's own checks in the hook's own order: the account sits at the
 * one address this sale's shard and feed id produce, it is owned by Pyth's
 * receiver program, its bytes are a price update, two thirds of the guardians
 * signed it, the feed inside it is this sale's feed, it is no older than the
 * sale allows, it was not published in the future, the price is above zero, and
 * Pyth's confidence interval is inside the sale's limit. Any doubt comes back
 * as `usable: false` with the program's own error name, because that is what
 * the buy would hit.
 *
 * The age is measured against the chain's own clock, the same clock the hook
 * compares against, rather than this machine's. If the Clock sysvar cannot be
 * read, this machine's clock stands in.
 *
 * Does not cover the Wormhole guardian signatures. Nothing can redo those from
 * the account's bytes: what stands in for them is the owner check, because only
 * Pyth's receiver program can write an account it owns and it checks them
 * first.
 *
 * Throws PanguInputError when the sale has no price band.
 */
export async function readPrice(
  connection: Connection,
  sale: Sale
): Promise<PriceReading> {
  if (sale === null || sale === undefined || !sale.hasBand) {
    throw new PanguInputError(
      "this sale has no price band, so there is no price account to read"
    );
  }
  const address = sale.priceAccount;

  // The rules carry both the address and the two values it is derived from. If
  // they ever disagree, the bytes at that address are not this sale's price.
  if (!priceFeedAddress(sale.priceFeedId, sale.priceShard).equals(address)) {
    return unusable(address, "WrongPriceAccount");
  }

  const [info, clock] = await connection.getMultipleAccountsInfo([
    address,
    SYSVAR_CLOCK_PUBKEY,
  ]);
  if (info === null || info === undefined) {
    return unusable(address, "PriceStale");
  }
  if (!info.owner.equals(PYTH_RECEIVER_PROGRAM_ID)) {
    return unusable(address, "WrongPriceAccount");
  }

  let update: PriceUpdate;
  try {
    update = decodePriceUpdate(info.data);
  } catch {
    return unusable(address, "WrongPriceAccount");
  }

  if (!update.fullyVerified) {
    return unusable(address, "PriceNotFullyVerified", {
      publishTime: update.publishTime,
    });
  }
  if (update.feedId !== sale.priceFeedId) {
    return unusable(address, "WrongPriceAccount");
  }
  if (
    update.price <= 0n ||
    update.exponent > 0 ||
    update.exponent < -LIMITS.maxDecimals
  ) {
    return unusable(
      address,
      update.price <= 0n ? "PriceStale" : "WrongPriceAccount",
      { fullyVerified: true, publishTime: update.publishTime }
    );
  }

  const now =
    clock !== null &&
    clock !== undefined &&
    clock.data.length >= CLOCK_UNIX_TIMESTAMP_OFFSET + 8
      ? Number(clock.data.readBigInt64LE(CLOCK_UNIX_TIMESTAMP_OFFSET))
      : Math.floor(Date.now() / 1000);

  const price = stockPriceDollars(update.price, update.exponent);
  const confBps = Number(confidenceBps(update.price, update.conf));
  const reading: PriceReading = {
    address,
    price,
    priceDollars: dollars(price),
    publishTime: update.publishTime,
    ageSecs: now - update.publishTime,
    confBps,
    fullyVerified: true,
    usable: true,
    error: null,
    reason: null,
  };

  const refuse = (error: PanguErrorName): PriceReading => ({
    ...reading,
    usable: false,
    error,
    reason: explainPanguError(error),
  });

  // A price may be old, within the sale's limit, but never newer than now. Pyth
  // stops publishing an equity outside its trading sessions, so a shut market
  // reaches this the same way a broken publisher does: the account stops moving
  // and ages out. There is no session flag to tell the two apart.
  if (
    reading.ageSecs > sale.maxPriceAgeSecs ||
    update.publishTime > now + PUBLISH_FUTURE_TOLERANCE_SECS ||
    price <= 0n
  ) {
    return refuse("PriceStale");
  }
  if (confBps > sale.maxConfBps) {
    return refuse("PriceTooUncertain");
  }

  return reading;
}
