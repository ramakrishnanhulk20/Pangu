import { PublicKey } from "@solana/web3.js";
import {
  DBC_PROGRAM_ID,
  LIMITS,
  PANGU_PROGRAM_ID,
  SAS_PROGRAM_ID,
  SEEDS,
  SWITCHBOARD_QUOTE_PROGRAM_ID,
} from "./constants.js";
import { PanguInputError, requirePublicKey } from "./inputs.js";

/** A Switchboard feed id, either 32 raw bytes or the same bytes written as hex. */
export type FeedId = string | Uint8Array | number[];

const HEX = /^[0-9a-fA-F]+$/;

function seed(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * The one place a feed id is turned into bytes.
 *
 * Everything that derives an address or encodes an instruction goes through
 * this, so a hex string and a byte array can never be compared after two
 * different readings. A leading "0x" is accepted because that is how the feed
 * scripts print ids. Anything that is not exactly 32 bytes is refused.
 */
export function feedIdBytes(id: FeedId): Uint8Array {
  let bytes: Uint8Array;
  if (typeof id === "string") {
    const text = id.startsWith("0x") || id.startsWith("0X") ? id.slice(2) : id;
    if (text.length !== LIMITS.feedIdLength * 2 || !HEX.test(text)) {
      throw new PanguInputError(
        `a feed id must be ${LIMITS.feedIdLength * 2} hex characters, got "${id}"`
      );
    }
    bytes = new Uint8Array(LIMITS.feedIdLength);
    for (let i = 0; i < LIMITS.feedIdLength; i += 1) {
      bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  if (Array.isArray(id)) {
    if (id.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw new PanguInputError("a feed id array must hold whole bytes");
    }
    bytes = Uint8Array.from(id);
  } else if (id instanceof Uint8Array) {
    bytes = id;
  } else {
    throw new PanguInputError("a feed id must be hex or 32 bytes");
  }
  if (bytes.length !== LIMITS.feedIdLength) {
    throw new PanguInputError(
      `a feed id must be ${LIMITS.feedIdLength} bytes, got ${bytes.length}`
    );
  }
  return bytes;
}

/** The same id as lowercase hex with no prefix, which is how the feed scripts print it. */
export function feedIdHex(id: FeedId): string {
  return Array.from(feedIdBytes(id))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The rules account of one sale. Seeds "sale" and the mint. */
export function saleRulesAddress(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.sale), requirePublicKey(mint, "mint").toBuffer()],
    PANGU_PROGRAM_ID
  )[0];
}

/** One wallet's record in one sale. Seeds "buyer", the mint and the wallet. */
export function buyerRecordAddress(mint: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      seed(SEEDS.buyer),
      requirePublicKey(mint, "mint").toBuffer(),
      requirePublicKey(wallet, "wallet").toBuffer(),
    ],
    PANGU_PROGRAM_ID
  )[0];
}

/** The transfer hook's published account list. Seeds fixed by the SPL interface. */
export function extraAccountListAddress(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.extraAccountMetas), requirePublicKey(mint, "mint").toBuffer()],
    PANGU_PROGRAM_ID
  )[0];
}

/**
 * The one address an attestation for this credential, schema and wallet can have.
 * Derived under the attestation service, not under Pangu.
 */
export function attestationAddress(
  credential: PublicKey,
  schema: PublicKey,
  wallet: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      seed(SEEDS.attestation),
      requirePublicKey(credential, "credential").toBuffer(),
      requirePublicKey(schema, "schema").toBuffer(),
      requirePublicKey(wallet, "wallet").toBuffer(),
    ],
    SAS_PROGRAM_ID
  )[0];
}

/** The pool's base token vault. Derived under DBC, which is what owns it. */
export function dbcBaseVaultAddress(mint: PublicKey, pool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      seed(SEEDS.dbcTokenVault),
      requirePublicKey(mint, "mint").toBuffer(),
      requirePublicKey(pool, "pool").toBuffer(),
    ],
    DBC_PROGRAM_ID
  )[0];
}

/**
 * The one quote account a queue and a set of feeds can write to.
 *
 * The payer is not a seed, so nobody can create a rival account for the same
 * feeds and the address is fixed before anyone has refreshed it. Feed order
 * matters: a banded sale passes the price feed and then the market clock feed.
 */
export function canonicalQuoteAddress(
  queue: PublicKey,
  feedIds: FeedId[]
): PublicKey {
  if (!Array.isArray(feedIds) || feedIds.length === 0) {
    throw new PanguInputError("at least one feed id is needed for a quote address");
  }
  return PublicKey.findProgramAddressSync(
    [
      requirePublicKey(queue, "queue").toBuffer(),
      ...feedIds.map((id) => feedIdBytes(id)),
    ],
    SWITCHBOARD_QUOTE_PROGRAM_ID
  )[0];
}
