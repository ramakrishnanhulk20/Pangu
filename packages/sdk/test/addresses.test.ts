// Address vectors. Every expected value is derived here from the seed strings in
// ARCHITECTURE.md, not taken from the package, so a changed seed fails loudly.
//
// Not covered: whether these accounts hold anything on any network. What a Pyth
// price feed account holds is price.test.ts, and the fork and devnet runs.

import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  attestationAddress,
  buyerRecordAddress,
  dbcBaseVaultAddress,
  extraAccountListAddress,
  feedIdBytes,
  feedIdHex,
  priceFeedAddress,
  saleRulesAddress,
  DBC_PROGRAM_ID,
  PANGU_PROGRAM_ID,
  PANGU_SHARD_ID,
  PYTH_PRICE_FEED_PROGRAM_ID,
  SAS_PROGRAM_ID,
} from "../src/index.js";

const MINT = new PublicKey("So11111111111111111111111111111111111111112");
const WALLET = new PublicKey("Vote111111111111111111111111111111111111111");
const POOL = new PublicKey("Stake11111111111111111111111111111111111111");
const CREDENTIAL = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const SCHEMA = new PublicKey("SysvarRent111111111111111111111111111111111");

/**
 * Pyth's own Equity.US.AAPL/USD feed, the account Pyth keeps for it on mainnet
 * shard 0, and the account Pangu's own shard puts it at on devnet. All three
 * are recorded in docs/measurements/price-band-pyth.md, and the devnet one is
 * the account packages/program/feeds/refresh.ts really wrote. Typed out rather
 * than imported: this package must not reach into the program's folder.
 */
const AAPL_FEED =
  "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
const MAINNET_SHARD_0_AAPL = "DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy";
const PANGU_SHARD_AAPL = "9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb";

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

  it("derives a price feed account from the shard id and the feed id", () => {
    const shard = Uint8Array.from([PANGU_SHARD_ID & 0xff, PANGU_SHARD_ID >> 8]);
    expect(priceFeedAddress(AAPL_FEED).toBase58()).toBe(
      pda([shard, Buffer.from(AAPL_FEED, "hex")], PYTH_PRICE_FEED_PROGRAM_ID)
    );
  });

  it("lands on the two AAPL accounts Pyth really keeps", () => {
    // Shard 0 is the one Pyth sponsors on mainnet, and shard 7700 is the one
    // Pangu refreshes itself. The same feed, two accounts, and the shard is the
    // only thing that differs.
    expect(priceFeedAddress(AAPL_FEED, 0).toBase58()).toBe(MAINNET_SHARD_0_AAPL);
    expect(priceFeedAddress(`0x${AAPL_FEED}`).toBase58()).toBe(PANGU_SHARD_AAPL);
    expect(priceFeedAddress(AAPL_FEED, PANGU_SHARD_ID).toBase58()).toBe(
      PANGU_SHARD_AAPL
    );
  });

  it("refuses a shard id that would not fit in the two bytes it is written into", () => {
    expect(() => priceFeedAddress(AAPL_FEED, -1)).toThrow(/between 0 and 65535/);
    expect(() => priceFeedAddress(AAPL_FEED, 65_536)).toThrow(/between 0 and 65535/);
  });

  it("reads a feed id the same way whether it arrives as hex or bytes", () => {
    const bytes = feedIdBytes(AAPL_FEED);
    expect(bytes).toHaveLength(32);
    expect(feedIdHex(bytes)).toBe(AAPL_FEED);
    expect(feedIdHex(`0x${AAPL_FEED.toUpperCase()}`)).toBe(AAPL_FEED);
    expect(priceFeedAddress(bytes).equals(priceFeedAddress(AAPL_FEED))).toBe(true);
  });

  it("refuses a feed id that is not 32 bytes", () => {
    expect(() => feedIdBytes("49f6b6")).toThrow(/64 hex characters/);
    expect(() => feedIdBytes(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => feedIdBytes("zz".repeat(32))).toThrow(/hex/);
  });
});
