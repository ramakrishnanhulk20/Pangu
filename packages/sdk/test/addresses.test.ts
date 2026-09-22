// Address vectors. Every expected value is derived here from the seed strings in
// ARCHITECTURE.md, not taken from the package, so a changed seed fails loudly.
//
// Not covered: whether these accounts exist on any network, and the Switchboard
// queue's own contents. Those are the program's fork tests.

import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  attestationAddress,
  buyerRecordAddress,
  canonicalQuoteAddress,
  dbcBaseVaultAddress,
  extraAccountListAddress,
  feedIdBytes,
  feedIdHex,
  saleRulesAddress,
  DBC_PROGRAM_ID,
  PANGU_PROGRAM_ID,
  SAS_PROGRAM_ID,
  SWITCHBOARD_QUOTE_PROGRAM_ID,
} from "../src/index.js";

const MINT = new PublicKey("So11111111111111111111111111111111111111112");
const WALLET = new PublicKey("Vote111111111111111111111111111111111111111");
const POOL = new PublicKey("Stake11111111111111111111111111111111111111");
const CREDENTIAL = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const SCHEMA = new PublicKey("SysvarRent111111111111111111111111111111111");

/**
 * The production devnet feeds this project refreshes, and the one account they
 * write to. Copied from packages/program/feeds (the ids the scripts resolve) and
 * the run recorded in docs/measurements/price-band.md. Not imported: this package
 * must not reach across into the program's folder.
 */
const DEVNET_QUEUE = new PublicKey("EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7");
const DEVNET_PRICE_FEED =
  "db4fa77aa3c4e909923c4767ae01f5d2a3d0c7138c953db372639122bdeceb3d";
const DEVNET_CLOCK_FEED =
  "15ff868ad9e4b29e63e75b68a527df7d8f2fa83782938b233d03ea5e259d08c5";
const DEVNET_QUOTE_ACCOUNT = "7uPLLyB29H9sATzjKi1DKWgqD2YXrjp8YS8QpEZi5b1Z";

function pda(seeds: (Uint8Array | Buffer)[], program: PublicKey): string {
  return PublicKey.findProgramAddressSync(seeds, program)[0].toBase58();
}

const text = (value: string) => Buffer.from(value, "utf8");

describe("addresses", () => {
  it("derives the sale rules account from the mint", () => {
    expect(saleRulesAddress(MINT).toBase58()).toBe(
      pda([text("sale"), MINT.toBuffer()], PANGU_PROGRAM_ID)
    );
  });

  it("derives a buyer record from the mint and the wallet", () => {
    expect(buyerRecordAddress(MINT, WALLET).toBase58()).toBe(
      pda([text("buyer"), MINT.toBuffer(), WALLET.toBuffer()], PANGU_PROGRAM_ID)
    );
  });

  it("derives the transfer hook's account list from the mint", () => {
    expect(extraAccountListAddress(MINT).toBase58()).toBe(
      pda([text("extra-account-metas"), MINT.toBuffer()], PANGU_PROGRAM_ID)
    );
  });

  it("derives an attestation under the attestation service", () => {
    expect(attestationAddress(CREDENTIAL, SCHEMA, WALLET).toBase58()).toBe(
      pda(
        [
          text("attestation"),
          CREDENTIAL.toBuffer(),
          SCHEMA.toBuffer(),
          WALLET.toBuffer(),
        ],
        SAS_PROGRAM_ID
      )
    );
  });

  it("derives the pool's base vault under DBC", () => {
    expect(dbcBaseVaultAddress(MINT, POOL).toBase58()).toBe(
      pda([text("token_vault"), MINT.toBuffer(), POOL.toBuffer()], DBC_PROGRAM_ID)
    );
  });

  it("derives a quote account from the queue and the feed ids", () => {
    const feeds = [DEVNET_PRICE_FEED, DEVNET_CLOCK_FEED].map((id) =>
      Buffer.from(id, "hex")
    );
    expect(canonicalQuoteAddress(DEVNET_QUEUE, feeds).toBase58()).toBe(
      pda([DEVNET_QUEUE.toBuffer(), ...feeds], SWITCHBOARD_QUOTE_PROGRAM_ID)
    );
  });

  it("puts the production devnet feeds at the account the program reads", () => {
    expect(
      canonicalQuoteAddress(DEVNET_QUEUE, [
        DEVNET_PRICE_FEED,
        `0x${DEVNET_CLOCK_FEED}`,
      ]).toBase58()
    ).toBe(DEVNET_QUOTE_ACCOUNT);
  });

  it("reads a feed id the same way whether it arrives as hex or bytes", () => {
    const bytes = feedIdBytes(DEVNET_PRICE_FEED);
    expect(bytes).toHaveLength(32);
    expect(feedIdHex(bytes)).toBe(DEVNET_PRICE_FEED);
    expect(feedIdHex(`0x${DEVNET_PRICE_FEED.toUpperCase()}`)).toBe(
      DEVNET_PRICE_FEED
    );
  });

  it("refuses a feed id that is not 32 bytes", () => {
    expect(() => feedIdBytes("db4fa7")).toThrow(/64 hex characters/);
    expect(() => feedIdBytes(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => feedIdBytes("zz".repeat(32))).toThrow(/hex/);
  });
});
