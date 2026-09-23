// Fork scaffolding: finding the Pyth price accounts a banded sale reads, and
// the demo dollar it pays in, on a local validator.
//
// Pyth's receiver program does not run on a local chain, and a price feed
// account is a program address only Pyth's price feed program could produce. So
// scripts/wsl/fork-validator.sh writes the accounts in Pyth's own layout before
// the chain starts and hands them to the validator, along with a manifest of
// what it wrote. They can never be rewritten from inside the run: a sale's
// stock price is fixed for the whole test, and the price ages on its own
// against the chain's clock, which is the whole of the market clock.
//
// The numbers below have to match packages/program/fork-tests/band-setup.ts,
// which is what wrote the accounts. They are typed out rather than imported,
// because this package must not reach across into the program's folder, and
// `readManifest` proves they still agree by deriving each address and comparing
// it against the manifest. Nothing here ships.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { dollarMints, priceFeedAddress } from "../src/index.js";

/** Where fork-validator.sh leaves the accounts it made and its manifest. */
export const FORK_ACCOUNTS_DIR = join(homedir(), "pangu-fork-accounts");
const MANIFEST_FILE = "band-prices.json";

/** The test feed id band-setup.ts builds its price accounts with. */
export const PRICE_FEED_ID = fillFeed(0x51);

/** The band and the confidence limit those sales are opened with. */
export const BAND_BPS = 1_000;
export const MAX_CONF_BPS = 100;

/**
 * The demo dollar, on the devnet build's list of tokens a price ceiling may be
 * set on. The fork runs that build, so every banded sale here is paid in it.
 * It does not exist on mainnet, so the program's band-accounts.ts writes the
 * mint before genesis, with a throwaway wallet as its mint authority.
 */
export const DEMO_DOLLAR_MINT = new PublicKey(
  "2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5"
);
/** The file band-accounts.ts keeps that throwaway authority in. */
const DOLLAR_AUTHORITY_FILE = "band-dollar-authority.json";

export type SaleName = "low" | "high" | "aging";

export interface PriceManifestEntry {
  shard: number;
  priceAccount: string;
  /** The stock price in dollars, scaled by 1e18. */
  stockPrice: string;
  /** The whole number written into the account, at Pyth's own exponent. */
  rawPrice: string;
  /** The Unix second the account says the price was published. */
  publishTime: number;
  maxPriceAgeSecs: number;
}

export type PriceManifest = Record<SaleName, PriceManifestEntry>;

/**
 * The prices the validator was started with.
 *
 * Every address is derived again here from the shard and the feed id and
 * checked against the manifest, so a feed id that drifts from the program's
 * fork setup fails on the first line rather than deriving a wrong address and
 * reading an account that does not exist.
 */
export function readManifest(): PriceManifest {
  const manifest = JSON.parse(
    readFileSync(join(FORK_ACCOUNTS_DIR, MANIFEST_FILE), "utf8")
  ) as PriceManifest;

  for (const [name, entry] of Object.entries(manifest)) {
    const derived = priceFeedAddress(PRICE_FEED_ID, entry.shard).toBase58();
    if (derived !== entry.priceAccount) {
      throw new Error(
        `the ${name} sale's price account is ${entry.priceAccount}, but shard ${entry.shard} and this feed id derive ${derived}. fork-price.ts and packages/program/fork-tests/band-setup.ts have drifted apart.`
      );
    }
  }
  return manifest;
}

/**
 * The wallet that can mint the demo dollar on the fork.
 *
 * Refuses when the SDK's own devnet list does not carry the demo dollar, so a
 * list that drifted from the program would fail here before any sale is sent.
 */
export function demoDollarAuthority(): Keypair {
  if (!dollarMints("devnet").some((mint) => mint.equals(DEMO_DOLLAR_MINT))) {
    throw new Error("the SDK's devnet dollar list does not carry the demo dollar");
  }
  const secret = JSON.parse(
    readFileSync(join(FORK_ACCOUNTS_DIR, DOLLAR_AUTHORITY_FILE), "utf8")
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function fillFeed(marker: number): number[] {
  const bytes = Array.from({ length: 32 }, () => marker);
  bytes[31] = 0xcd;
  return bytes;
}
