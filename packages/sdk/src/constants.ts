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
 * Switchboard's quote program, which owns every canonical quote account.
 * Source: programs/pangu/src/price.rs, QUOTE_PROGRAM_ID.
 */
export const SWITCHBOARD_QUOTE_PROGRAM_ID = new PublicKey(
  "orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz"
);

export { TOKEN_2022_PROGRAM_ID };

export const ACCESS_MODE = {
  open: 0,
  issuerList: 1,
  verifierCredential: 2,
} as const;

export type AccessMode = (typeof ACCESS_MODE)[keyof typeof ACCESS_MODE];

/**
 * The seed prefixes the program and its neighbours derive addresses from.
 * Source: state.rs (sale, buyer, extra-account-metas), sas.rs (attestation),
 * dbc.rs (token_vault).
 */
export const SEEDS = {
  sale: "sale",
  buyer: "buyer",
  extraAccountMetas: "extra-account-metas",
  attestation: "attestation",
  dbcTokenVault: "token_vault",
} as const;

/**
 * The limits the program itself enforces. Each one names the Rust constant or
 * check it copies, so a change on chain has one place to land here.
 */
export const LIMITS = {
  /** price.rs MAX_BAND_BPS: half again over the live stock price. */
  maxBandBps: 5_000,
  /** price.rs MAX_PRICE_AGE_SLOTS, and create_sale.rs check_band takes 1..=400. */
  maxPriceAgeSlots: 400,
  minPriceAgeSlots: 1,
  /** create_sale.rs check_band: max_market_age_secs must be above zero. */
  minMarketAgeSecs: 1,
  /** create_sale.rs check_band: min_oracles must be at least one. */
  minOracles: 1,
  /** price.rs MAX_DECIMALS. */
  maxDecimals: 18,
  /** Every Switchboard feed id is 32 bytes. */
  feedIdLength: 32,
  /** u64 raw token units, the widest cap the program can hold. */
  maxCap: (1n << 64n) - 1n,
} as const;
