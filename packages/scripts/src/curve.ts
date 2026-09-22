/**
 * The bonding curve a devnet demo sale is launched with.
 *
 * It is Meteora's own `buildCurve` input with nothing clever in it: a billion
 * tokens, a flat 25 basis point fee, all the graduating liquidity locked to the
 * creator. What changes per launch is the shape below, because that is what
 * decides both the devnet cost of the demo and the price a share opens at.
 */

import {
  ActivationType,
  BaseFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  TokenAuthorityOption,
  TokenDecimal,
  type BuildCurveParams,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

/** How many shares a demo sale ever mints. */
export const TOTAL_SUPPLY = 1_000_000_000;

/** What a launch decides about the curve it opens. */
export interface CurveShape {
  /** The paying token's decimals, read off its mint. */
  quoteDecimals: TokenDecimal;
  /** The sale token's decimals. */
  baseDecimals: TokenDecimal;
  /** What share of the supply is carried over to DAMM v2, as a percentage. */
  migrationPercent: number;
  /** Whole units of the paying token the curve has to take in to graduate. */
  threshold: number;
}

/**
 * The opening price of this curve, in whole units of the paying token per share.
 *
 * Meteora works the curve out from the raise and the supply, so the opening
 * price is not something a launch sets directly: it falls out of the threshold,
 * the supply and the share kept back for migration. This says what it will be,
 * so a launch can be aimed at a price rather than guessed at. Measured against
 * `buildCurve` for every shape the scripts open, and the real pool's own price
 * is printed after the sale is open.
 */
export function openingPrice(shape: CurveShape): number {
  const soldOnCurve = (100 - shape.migrationPercent) / 100;
  const onMigration = shape.migrationPercent / 100;
  return (
    (shape.threshold * onMigration) /
    (TOTAL_SUPPLY * soldOnCurve * soldOnCurve)
  );
}

export function demoCurve(shape: CurveShape): BuildCurveParams {
  const { quoteDecimals, baseDecimals, migrationPercent } = shape;
  const migrationQuoteThreshold = shape.threshold;
  return {
    token: {
      tokenBaseDecimal: baseDecimals,
      tokenQuoteDecimal: quoteDecimals,
      // The creator keeps the metadata update authority and nobody keeps the
      // mint authority. A token that can still be minted is one the hook can
      // never hold to a cap, and create_sale refuses it.
      tokenAuthorityOption: TokenAuthorityOption.CreatorUpdateAuthority,
      totalTokenSupply: TOTAL_SUPPLY,
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
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
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
    percentageSupplyOnMigration: migrationPercent,
    migrationQuoteThreshold,
  } as unknown as BuildCurveParams;
}
