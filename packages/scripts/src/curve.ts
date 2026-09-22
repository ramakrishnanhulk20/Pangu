/**
 * The bonding curve a devnet demo sale is launched with.
 *
 * It is Meteora's own `buildCurve` input with nothing clever in it: a billion
 * tokens, a flat 25 basis point fee, all the graduating liquidity locked to the
 * creator. Only two things change per launch, the paying token's decimals and
 * the amount that has to be raised before the sale graduates, because those are
 * what decide how much devnet SOL the whole demo costs.
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

/** The sale token's own decimals, fixed so a cap in raw units reads the same everywhere. */
export const BASE_DECIMALS = TokenDecimal.SIX;

export function demoCurve(
  quoteDecimals: TokenDecimal,
  migrationQuoteThreshold: number
): BuildCurveParams {
  return {
    token: {
      tokenBaseDecimal: BASE_DECIMALS,
      tokenQuoteDecimal: quoteDecimals,
      // The creator keeps the metadata update authority and nobody keeps the
      // mint authority. A token that can still be minted is one the hook can
      // never hold to a cap, and create_sale refuses it.
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
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold,
  } as unknown as BuildCurveParams;
}
