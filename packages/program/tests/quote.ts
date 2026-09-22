// Writing a Pyth price feed account byte for byte, and working out the one
// address it can live at.
//
// The layout is `PriceUpdateV2` from pyth-solana-receiver-sdk 2.0.0, checked
// against Pyth's real mainnet AAPL account in docs/measurements/price-band-pyth.md.
// Tests craft these accounts so they can aim a stale, short, partly verified,
// foreign or nonsense price at the hook, which Pyth's receiver would never write.

import { PublicKey } from "@solana/web3.js";

/** Derives every price feed account address. Same on mainnet and devnet. */
export const PRICE_FEED_PROGRAM_ID = new PublicKey(
  "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT"
);

/** Owns every price feed account, and the only program that can write one. */
export const RECEIVER_PROGRAM_ID = new PublicKey(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
);

/** The shard Pangu's own refresher writes, matching PANGU_SHARD_ID in price.rs. */
export const PANGU_SHARD_ID = 7_700;

/** The band compares every price on one scale, a dollar being 1e18. */
export const PRICE_SCALE = 10n ** 18n;

/** sha256("account:PriceUpdateV2") cut to eight bytes. */
const ACCOUNT_DISCRIMINATOR = Buffer.from([
  34, 241, 35, 99, 157, 126, 244, 205,
]);

/** `PriceUpdateV2::LEN`: the widest the account can be, which is what Pyth allocates. */
export const PRICE_UPDATE_LEN = 134;

const FEED_ID_LENGTH = 32;
/** `VerificationLevel::Partial { num_signatures }` is variant 0, `Full` is variant 1. */
const VERIFICATION_PARTIAL = 0;
const VERIFICATION_FULL = 1;

export interface PriceUpdateSpec {
  feedId: number[];
  /** The whole number Pyth publishes. Multiply by ten to the exponent. */
  price: bigint;
  /** Pyth's confidence interval, on the same scale as the price. */
  conf: bigint;
  /** Negative for every feed a sale can use: -5 for US equities, -8 for tokenised. */
  exponent: number;
  publishTime: bigint;
  writeAuthority?: PublicKey;
  postedSlot?: bigint;
  /**
   * Undefined means fully verified. A number writes `Partial` with that many
   * guardian signatures, which is what Pangu refuses.
   */
  partialSignatures?: number;
  /** Overrides the eight byte account discriminator. */
  discriminator?: Buffer;
  /** Cuts the account short, to aim a half-written account at the hook. */
  truncateTo?: number;
}

/** A 32 byte feed id from a single seed number, so tests can name feeds cheaply. */
export function feedId(seed: number): number[] {
  const bytes = Array.from({ length: 32 }, () => 0);
  bytes[0] = seed & 0xff;
  bytes[1] = (seed >> 8) & 0xff;
  bytes[31] = 0xab;
  return bytes;
}

/**
 * The one address a price for this shard and this feed can live at.
 *
 * Seeds are the shard id as two little endian bytes and then the feed id, under
 * Pyth's price feed program. The payer is not a seed, so a sale can name the
 * address years before anyone refreshes it and nobody can put a rival account
 * there.
 */
export function priceFeedAddress(
  shardId: number,
  feed: number[]
): PublicKey {
  const shard = Buffer.alloc(2);
  shard.writeUInt16LE(shardId, 0);
  return PublicKey.findProgramAddressSync(
    [shard, Buffer.from(feed)],
    PRICE_FEED_PROGRAM_ID
  )[0];
}

export function encodePriceUpdate(spec: PriceUpdateSpec): Buffer {
  const partial = spec.partialSignatures;
  const level =
    partial === undefined
      ? Buffer.from([VERIFICATION_FULL])
      : Buffer.from([VERIFICATION_PARTIAL, partial & 0xff]);

  const message = Buffer.alloc(FEED_ID_LENGTH + 8 + 8 + 4 + 8 + 8 + 8 + 8);
  Buffer.from(spec.feedId).copy(message, 0);
  writeI64LE(message, FEED_ID_LENGTH, spec.price);
  writeU64LE(message, FEED_ID_LENGTH + 8, spec.conf);
  message.writeInt32LE(spec.exponent, FEED_ID_LENGTH + 16);
  writeI64LE(message, FEED_ID_LENGTH + 20, spec.publishTime);
  writeI64LE(message, FEED_ID_LENGTH + 28, spec.publishTime);
  // The exponential moving average, which Pangu does not read. Written because a
  // real account carries it and the fields behind it would otherwise shift.
  writeI64LE(message, FEED_ID_LENGTH + 36, spec.price);
  writeU64LE(message, FEED_ID_LENGTH + 44, spec.conf);

  const postedSlot = Buffer.alloc(8);
  writeU64LE(postedSlot, 0, spec.postedSlot ?? 1n);

  const data = Buffer.concat([
    spec.discriminator ?? ACCOUNT_DISCRIMINATOR,
    (spec.writeAuthority ?? PublicKey.default).toBuffer(),
    level,
    message,
    postedSlot,
  ]);

  // Pyth allocates the widest the account can be, so a fully verified update,
  // which is one byte shorter, sits in a buffer with one byte of padding behind.
  const padded = Buffer.alloc(Math.max(PRICE_UPDATE_LEN, data.length));
  data.copy(padded, 0);

  return spec.truncateTo === undefined
    ? padded
    : padded.subarray(0, spec.truncateTo);
}

/** The live stock price in dollars scaled by 1e18, the way price.rs reads it. */
export function stockPrice1e18(price: bigint, exponent: number): bigint {
  const shift = 18 + exponent;
  return shift >= 0
    ? price * 10n ** BigInt(shift)
    : price / 10n ** BigInt(-shift);
}

/** The whole number to publish at a given exponent for a price in dollars. */
export function dollarsAtExponent(dollars1e18: bigint, exponent: number): bigint {
  const shift = 18 + exponent;
  return shift >= 0
    ? dollars1e18 / 10n ** BigInt(shift)
    : dollars1e18 * 10n ** BigInt(-shift);
}

function writeI64LE(buffer: Buffer, offset: number, value: bigint) {
  const unsigned = value < 0n ? (1n << 64n) + value : value;
  buffer.writeBigUInt64LE(unsigned & 0xffffffffffffffffn, offset);
}

function writeU64LE(buffer: Buffer, offset: number, value: bigint) {
  buffer.writeBigUInt64LE(value & 0xffffffffffffffffn, offset);
}
