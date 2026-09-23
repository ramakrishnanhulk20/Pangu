/**
 * The bonding curve a devnet demo sale is launched with.
 *
 * It is Meteora's own `buildCurve` input with nothing clever in it: a flat 25
 * basis point fee and all the graduating liquidity locked to the creator. What
 * changes per launch is the shape below, because that is what decides both the
 * devnet cost of the demo and the price a share opens at.
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

/** How many shares a demo sale mints when a launch does not say. */
export const DEFAULT_SUPPLY = 1_000_000_000;

/** What a launch decides about the curve it opens. */
export interface CurveShape {
  /** The paying token's decimals, read off its mint. */
  quoteDecimals: TokenDecimal;
  /** The sale token's decimals. */
  baseDecimals: TokenDecimal;
  /** How many shares this sale ever mints. */
  supply: number;
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
 *
 * The supply is the lever that makes a share price affordable. A billion shares
 * and a three figure opening price need a raise in the hundreds of billions,
 * which nobody can fill. Twenty shares reach the same price on a raise of a few
 * thousand.
 */
export function openingPrice(shape: CurveShape): number {
  const soldOnCurve = (100 - shape.migrationPercent) / 100;
  const onMigration = shape.migrationPercent / 100;
  return (
    (shape.threshold * onMigration) /
    (shape.supply * soldOnCurve * soldOnCurve)
  );
}

/**
 * The price the curve ends at, in whole units of the paying token per share.
 *
 * The curve is one stretch of constant liquidity from the opening price to this
 * one, so these two numbers and the supply are the whole shape. A banded sale
 * never gets here: the ceiling stops it partway.
 */
export function graduationPrice(shape: CurveShape): number {
  const soldOnCurve = (100 - shape.migrationPercent) / 100;
  return openingPrice(shape) * (soldOnCurve / (shape.migrationPercent / 100)) ** 2;
}

/**
 * What share of the curve's tokens have to sell before the curve price reaches
 * `price`, as a fraction of the tokens the curve sells. Above 1 when the curve
 * ends below that price.
 *
 * This is what a banded launch is aimed with: it says where in the sale the
 * ceiling bites, so a demo can be seeded to just under it.
 */
export function shareSoldAtPrice(shape: CurveShape, price: number): number {
  const opening = openingPrice(shape);
  const ratio = shape.migrationPercent / (100 - shape.migrationPercent);
  return (1 - Math.sqrt(opening / price)) / (1 - ratio);
}

export function demoCurve(shape: CurveShape): BuildCurveParams {
  const { quoteDecimals, baseDecimals, migrationPercent, supply } = shape;
  const migrationQuoteThreshold = shape.threshold;
  return {
    token: {
      tokenBaseDecimal: baseDecimals,
      tokenQuoteDecimal: quoteDecimals,
      // The creator keeps the metadata update authority and nobody keeps the
      // mint authority. A token that can still be minted is one the hook can
      // never hold to a cap, and create_sale refuses it.
      tokenAuthorityOption: TokenAuthorityOption.CreatorUpdateAuthority,
      totalTokenSupply: supply,
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
