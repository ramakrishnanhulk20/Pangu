// The numbers the price-band fork test and the account generator must agree on.
//
// A local validator can only be handed accounts on its command line, at genesis,
// so the price accounts are written before the chain starts and never rewritten.
// That means the generator has to know the curve in advance, which it does,
// because buildCurve is a pure function of the parameters below.
//
// Pyth's freshness rule is publish time against the chain's own clock, in
// seconds, so a genesis account ages on its own as the run goes along. That is
// what the ageing sale below is for, and it is why nothing here needs a
// stand-in program deployed at Pyth's address: the accounts are enough.

import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  buildCurve,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PANGU_SHARD_ID, priceFeedAddress } from "../tests/quote";

export const BASE_DECIMALS = 6;
/** The paying token is a dollar stablecoin, so the band compares dollars. */
export const QUOTE_DECIMALS = 6;

/**
 * The demo dollar, on the devnet build's list of tokens a price ceiling may be
 * set on. The fork runs that build, so the banded sales are paid in it. It does
 * not exist on mainnet, so band-accounts.ts writes the mint before genesis.
 */
export const DEMO_DOLLAR_MINT = new PublicKey(
  "2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5"
);
/**
 * The throwaway wallet band-accounts.ts names as the demo dollar's mint
 * authority, so the test can fund its buyers. Kept with the other fork wallets,
 * outside the repo.
 */
export const DOLLAR_AUTHORITY_WALLET = "band-dollar-authority";

export const BAND_BPS = 1_000;
/** One percent, wide for a liquid stock and tight enough to be a real rule. */
export const MAX_CONF_BPS = 100;
/**
 * The exponent the fork's prices are published at.
 *
 * Pyth uses -5 for US equities and -8 for the tokenised ones. This curve opens
 * at a fifth of a cent a token, so -5 would round the stock price to two
 * significant figures and the ceiling would stop meaning what it says. -8 is a
 * real Pyth exponent and holds the number.
 */
export const PRICE_EXPONENT = -8;

/** Long enough that the price never goes stale during the price tests. */
export const PRICE_AGE_OPEN_SECS = 3_600;
/**
 * Short enough that the ageing sale shuts partway through the run, and long
 * enough that the validator's own startup does not shut it before the test has
 * bought anything. The accounts are written just before genesis, so this clock
 * starts running before mocha does.
 */
export const PRICE_AGE_SHORT_SECS = 240;

/** How far above the curve's opening price the low sale's ceiling sits. */
export const LOW_CEILING_MULTIPLE = 2n;
/** The high sale's stock price, as a multiple of the low sale's. */
export const HIGH_PRICE_MULTIPLE = 100n;

/** A test feed id. The real ones live in feeds/pyth-feeds.ts. */
export const PRICE_FEED_ID = fillFeed(0x51);

/** Owns every price feed account. The hook refuses any other owner. */
export const RECEIVER_PROGRAM_ID = new PublicKey(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
);

export type SaleName = "low" | "high" | "aging";
export const SALE_NAMES: SaleName[] = ["low", "high", "aging"];

/** Where band-accounts.ts leaves the manifest for the test to read. */
export const MANIFEST_FILE = "band-prices.json";

export interface PriceManifestEntry {
  shard: number;
  priceAccount: string;
  /** The stock price in dollars, scaled by 1e18. */
  stockPrice: string;
  /** The whole number written into the account at PRICE_EXPONENT. */
  rawPrice: string;
  /** The Unix second the account says the price was published. */
  publishTime: number;
  maxPriceAgeSecs: number;
}

export type PriceManifest = Record<SaleName, PriceManifestEntry>;

/**
 * A shard per sale, so the three sales read three accounts for the same feed.
 *
 * Pyth's shard id is only a way of having more than one account for one feed, so
 * picking a different one per sale is exactly what it is for. They sit next to
 * Pangu's own shard rather than on it, so a fork run can never be confused with
 * the account the devnet refresher writes.
 */
export function bandShard(name: SaleName): number {
  return PANGU_SHARD_ID + 1 + SALE_NAMES.indexOf(name);
}

/** The one address this sale's price can live at. */
export function bandPriceAccount(name: SaleName): PublicKey {
  return priceFeedAddress(bandShard(name), PRICE_FEED_ID);
}

/** How old a price may get in this sale before buys stop. */
export function maxPriceAgeSecs(name: SaleName): number {
  return name === "aging" ? PRICE_AGE_SHORT_SECS : PRICE_AGE_OPEN_SECS;
}

/** The launch template both the generator and the test build. */
export function bandCurve() {
  return buildCurve({
    token: {
      tokenType: TokenType.Token2022,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: TokenDecimal.SIX,
      tokenAuthorityOption: TokenAuthorityOption.CreatorUpdateAuthority,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 25,
          endingFeeBps: 25,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Disabled,
        poolFeeBps: 25,
        baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
      },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 100,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold: 500_000,
  });
}

/** Dollars per whole token, scaled by 1e18, rounded up. The program's own rule. */
export function curvePriceCeil1e18(
  sqrtPrice: bigint,
  baseDecimals: number,
  quoteDecimals: number
): bigint {
  const numerator = sqrtPrice * sqrtPrice * 10n ** BigInt(18 + baseDecimals);
  const denominator = (1n << 128n) * 10n ** BigInt(quoteDecimals);
  const whole = numerator / denominator;
  return numerator % denominator === 0n ? whole : whole + 1n;
}

/** The highest curve price a band allows, scaled by 1e18, rounded down. */
export function bandCeiling1e18(stockPrice: bigint, bandBps: number): bigint {
  return (stockPrice * BigInt(10_000 + bandBps)) / 10_000n;
}

/** The stock price whose ceiling sits at a given multiple of the opening price. */
export function stockPriceForMultiple(
  sqrtStartPrice: BN,
  multiple: bigint
): bigint {
  const start = curvePriceCeil1e18(
    BigInt(sqrtStartPrice.toString()),
    BASE_DECIMALS,
    QUOTE_DECIMALS
  );
  return (start * multiple * 10_000n) / BigInt(10_000 + BAND_BPS);
}

function fillFeed(marker: number): number[] {
  const bytes = Array.from({ length: 32 }, () => marker);
  bytes[31] = 0xcd;
  return bytes;
}
