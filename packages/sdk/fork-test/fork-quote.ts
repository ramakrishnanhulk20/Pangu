// Fork scaffolding: putting a Switchboard quote into the account a banded sale
// reads, on a local validator.
//
// Switchboard's quote program does not run on a local chain, and a quote account
// is a program address only that program can write. scripts/wsl/fork-validator.sh
// deploys a tiny writer at the quote program's address and loads the quote
// accounts at genesis, signed for slot zero. The hook checks the signed slot hash
// against the SlotHashes sysvar, and a genesis account cannot carry its own
// chain's slot hash, so the quotes are rewritten here through that writer.
//
// The layout below is the one switchboard-on-demand 0.13.0 writes and
// programs/pangu/src/price.rs reads, the same encoder the program package's own
// band tests use. Nothing here ships: it exists only for the local validator.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

/** Switchboard scales every feed value by 1e18. */
export const FEED_SCALE = 10n ** 18n;

/** Where fork-validator.sh leaves the quote accounts it made. */
export const FORK_ACCOUNTS_DIR = join(homedir(), "pangu-fork-accounts");
const MANIFEST_FILE = "band-quotes.json";

/** The feed ids and signing key fork-tests/band-setup.ts builds its quotes with. */
export const PRICE_FEED_ID = fillFeed(0x51);
export const CLOCK_FEED_ID = fillFeed(0x52);
export const ORACLE_SIGNER = Buffer.alloc(32, 0x33);

export const QUOTE_PROGRAM_ID = new PublicKey(
  "orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz"
);
export const SLOT_HASHES_SYSVAR = new PublicKey(
  "SysvarS1otHashes111111111111111111111111111"
);

export type SaleName = "low" | "high" | "aging";

export interface QuoteManifestEntry {
  queue: string;
  quote: string;
  stockPrice: string;
  marketClockUnix: number;
  quoteSlot: number;
}

export function readManifest(): Record<SaleName, QuoteManifestEntry> {
  return JSON.parse(
    readFileSync(join(FORK_ACCOUNTS_DIR, MANIFEST_FILE), "utf8")
  ) as Record<SaleName, QuoteManifestEntry>;
}

function fillFeed(marker: number): number[] {
  const bytes = Array.from({ length: 32 }, () => marker);
  bytes[31] = 0xcd;
  return bytes;
}

const OFFSETS_RECORD_LENGTH = 14;
const SIGNATURE_BLOCK_LENGTH = 96;
const FEED_INFO_LENGTH = 49;
const HEADER_LENGTH = 42;

export interface ForkQuote {
  queue: PublicKey;
  slot: bigint;
  signedSlotHash: Buffer;
  /** Dollars scaled by 1e18. */
  stockPrice: bigint;
  /** Unix seconds of the last market trade. */
  marketClockUnix: number;
}

export function encodeQuote(quote: ForkQuote): Buffer {
  const feeds = [
    { id: PRICE_FEED_ID, value: quote.stockPrice },
    { id: CLOCK_FEED_ID, value: BigInt(quote.marketClockUnix) * FEED_SCALE },
  ];
  const message = Buffer.concat([
    quote.signedSlotHash,
    ...feeds.map((feed) => {
      const info = Buffer.alloc(FEED_INFO_LENGTH);
      Buffer.from(feed.id).copy(info, 0);
      info.writeBigUInt64LE(feed.value & 0xffffffffffffffffn, 32);
      info.writeBigUInt64LE((feed.value >> 64n) & 0xffffffffffffffffn, 40);
      info.writeUInt8(1, 48);
      return info;
    }),
  ]);

  const signatureBlockStart = 2 + OFFSETS_RECORD_LENGTH;
  const messageOffset = signatureBlockStart + SIGNATURE_BLOCK_LENGTH;
  const offsets = Buffer.alloc(OFFSETS_RECORD_LENGTH);
  offsets.writeUInt16LE(signatureBlockStart, 0);
  offsets.writeUInt16LE(0, 2);
  offsets.writeUInt16LE(signatureBlockStart + 64, 4);
  offsets.writeUInt16LE(0, 6);
  offsets.writeUInt16LE(messageOffset, 8);
  offsets.writeUInt16LE(message.length, 10);
  offsets.writeUInt16LE(0, 12);

  const signatureBlock = Buffer.alloc(SIGNATURE_BLOCK_LENGTH, 0x22);
  ORACLE_SIGNER.copy(signatureBlock, 64);

  const tail = Buffer.alloc(1 + 13);
  tail.writeUInt8(0, 0);
  tail.writeBigUInt64LE(quote.slot, 1);
  tail.writeUInt8(0, 9);
  Buffer.from("SBOD", "utf8").copy(tail, 10);

  const payload = Buffer.concat([
    Buffer.from([1, 0]),
    offsets,
    signatureBlock,
    message,
    tail,
  ]);
  const header = Buffer.alloc(HEADER_LENGTH);
  Buffer.from("SBOracle", "utf8").copy(header, 0);
  quote.queue.toBuffer().copy(header, 8);
  header.writeUInt16LE(payload.length, 40);
  return Buffer.concat([header, payload]);
}

/** The writer instruction. Its discriminator is Anchor's hash of the name. */
export function writeQuoteIx(
  quoteAccount: PublicKey,
  bytes: Buffer
): TransactionInstruction {
  const discriminator = createHash("sha256")
    .update("global:write")
    .digest()
    .subarray(0, 8);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length, 0);
  return new TransactionInstruction({
    programId: QUOTE_PROGRAM_ID,
    keys: [{ pubkey: quoteAccount, isSigner: false, isWritable: true }],
    data: Buffer.concat([discriminator, length, bytes]),
  });
}
