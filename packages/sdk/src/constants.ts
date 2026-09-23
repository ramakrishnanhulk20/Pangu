import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { Idl } from "@anchor-lang/core";
import idlJson from "./idl/pangu.json";

/**
 * The generated interface of the Pangu program, copied from the program's build
 * by `npm run sync-idl`. Everything else in this package is derived from it, so
 * a rebuilt program cannot leave a stale discriminator or error code behind.
 */
export const PANGU_IDL = idlJson as Idl;

export const PANGU_PROGRAM_ID = new PublicKey(PANGU_IDL.address);

/** Meteora's Dynamic Bonding Curve. Source: programs/pangu/src/dbc.rs. */
export const DBC_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
);

/** The Solana Attestation Service. Source: programs/pangu/src/sas.rs. */
export const SAS_PROGRAM_ID = new PublicKey(
  "22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG"
);

/**
 * Pyth's price feed program. Every price feed account is a program address of
 * this program over a shard id and a feed id, so a sale can name the address
 * before anybody has ever refreshed it.
 * Source: programs/pangu/src/price.rs, PRICE_FEED_PROGRAM_ID.
 */
export const PYTH_PRICE_FEED_PROGRAM_ID = new PublicKey(
  "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT"
);

/**
 * Pyth's receiver program, the only program that can write a price feed
 * account, and only after checking the Wormhole guardians' signatures.
 * Source: programs/pangu/src/price.rs, RECEIVER_PROGRAM_ID.
 */
export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
);

/**
 * The Pyth shard Pangu refreshes. A shard is a second copy of the same feed at
 * a second address, so a sale depends on a price Pangu's own refresher keeps
 * fresh rather than on the sponsored one.
 * Source: programs/pangu/src/price.rs, PANGU_SHARD_ID.
 */
export const PANGU_SHARD_ID = 7_700;

export { TOKEN_2022_PROGRAM_ID };

/**
 * The SaleRules layouts this package reads. Source: state.rs,
 * SALE_RULES_OLDEST_READABLE_VERSION to SALE_RULES_LAYOUT_VERSION. Version 2
 * added the paying token and the end of the offering period in what used to be
 * spare bytes, so a version 1 account is the same size with every older field
 * in place. An account carrying any other number was written by a different
 * build of the program, so every field behind the version byte may sit
 * somewhere else.
 */
export const SALE_RULES_LAYOUT_VERSIONS: ReadonlySet<number> = new Set([1, 2]);

export const ACCESS_MODE = {
  open: 0,
  issuerList: 1,
  verifierCredential: 2,
} as const;

export type AccessMode = (typeof ACCESS_MODE)[keyof typeof ACCESS_MODE];

/**
 * The seed prefixes the program and its neighbours derive addresses from.
 * Source: state.rs (sale, buyer, extra-account-metas), sas.rs (attestation),
 * the attestation service source (credential, schema), dbc.rs (token_vault).
 */
export const SEEDS = {
  sale: "sale",
  buyer: "buyer",
  extraAccountMetas: "extra-account-metas",
  attestation: "attestation",
  credential: "credential",
  schema: "schema",
  dbcTokenVault: "token_vault",
} as const;

/**
 * The limits the program itself enforces. Each one names the Rust constant or
 * check it copies, so a change on chain has one place to land here.
 */
export const LIMITS = {
  /** price.rs MAX_BAND_BPS: half again over the live stock price. */
  maxBandBps: 5_000,
  minBandBps: 1,
  /** price.rs MAX_PRICE_AGE_SECS, and create_sale.rs check_band takes 1..=3600. */
  maxPriceAgeSecs: 3_600,
  minPriceAgeSecs: 1,
  /** price.rs MAX_CONF_BPS: ten percent, and check_band takes 1..=1000. */
  maxConfBps: 1_000,
  minConfBps: 1,
  /** price.rs MAX_DECIMALS. */
  maxDecimals: 18,
  /** Every Pyth feed id is 32 bytes. */
  feedIdLength: 32,
  /** A Pyth shard id is a u16, which is what the address seed holds. */
  maxShard: 65_535,
  /** u64 raw token units, the widest cap the program can hold. */
  maxCap: (1n << 64n) - 1n,
} as const;
