import {
  ActivationType,
  BaseFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  TokenAuthorityOption,
  buildCurve,
  getBaseTokenForSwap,
  type BuildCurveParams,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { panguCurve } from "pangu-sdk/dbc";

/**
 * The bonding curve a sale opened from the launch page is built with, ported
 * from packages/scripts/src/curve.ts so the page and the terminal launch price
 * a share the same way. The scripts package is never imported here: it reads
 * key files and pulls in Node-only code a browser bundle cannot carry.
 *
 * lab-evidence/launch-curve-check.mjs holds these numbers against the curves
 * the terminal opened on devnet.
 */

/** Meteora's curve builder refuses 50 with "SafeMath: subtraction overflow"; 45 is the flattest it builds. */
export const MIN_MIGRATION_PERCENT = 10;
export const MAX_MIGRATION_PERCENT = 45;

/** The largest raw amount a token account can hold. */
const U64_MAX = (1n << 64n) - 1n;

/** What a launch decides about the curve it opens. */
export interface CurveShape {
  /** The paying token's decimals, read off its mint. */
  quoteDecimals: number;
  /** The sale token's decimals. */
  baseDecimals: number;
  /** How many shares this sale ever mints. */
  supply: number;
  /** What share of the supply is carried over to DAMM v2, as a percentage. */
  migrationPercent: number;
  /** Whole units of the paying token the curve has to take in to graduate. */
  threshold: number;
}

/**
 * The opening price, in whole units of the paying token per share.
 *
 * It is not set directly: Meteora works the curve out from the raise, the
 * supply and the share kept back for migration, and this says where that lands.
 */
export function openingPrice(shape: CurveShape): number {
  const soldOnCurve = (100 - shape.migrationPercent) / 100;
  const onMigration = shape.migrationPercent / 100;
  return (shape.threshold * onMigration) / (shape.supply * soldOnCurve * soldOnCurve);
}

/** The price the curve ends at. One stretch of constant liquidity joins the two. */
export function graduationPrice(shape: CurveShape): number {
  const soldOnCurve = (100 - shape.migrationPercent) / 100;
  return openingPrice(shape) * (soldOnCurve / (shape.migrationPercent / 100)) ** 2;
}

/** Opening over graduation price, which is also the square of the square root price ratio. */
function flatness(shape: CurveShape): number {
  return shape.migrationPercent / (100 - shape.migrationPercent);
}

/**
 * What share of the curve's tokens sell before the price reaches `price`, as a
 * fraction of what the curve sells. Below 0 when the curve opens above it,
 * above 1 when the curve ends below it.
 *
 * `price` is in the paying token, so a dollar ceiling only means something on
 * a curve paid in dollars. The scripts refuse wrapped SOL at this point; here
 * the caller only asks for a sale paid in the demo dollar.
 */
export function shareSoldAtPrice(shape: CurveShape, price: number): number {
  const opening = openingPrice(shape);
  return (1 - Math.sqrt(opening / price)) / (1 - flatness(shape));
}

/**
 * The price once this fraction of the curve's tokens has sold. The inverse of
 * shareSoldAtPrice: on constant liquidity one over the square root of the
 * price falls in a straight line with the tokens sold.
 */
export function priceAtShare(shape: CurveShape, share: number): number {
  const along = Math.min(1, Math.max(0, share));
  const depth = 1 - along * (1 - flatness(shape));
  return openingPrice(shape) / (depth * depth);
}

/** Evenly spaced points along the curve, for drawing it. */
export function curvePoints(
  shape: CurveShape,
  samples: number
): { share: number; price: number }[] {
  const points: { share: number; price: number }[] = [];
  for (let step = 0; step <= samples; step += 1) {
    const share = step / samples;
    points.push({ share, price: priceAtShare(shape, share) });
  }
  return points;
}

/** Meteora's own buildCurve input, the same one the terminal launch sends. */
export function demoCurve(shape: CurveShape): BuildCurveParams {
  const { quoteDecimals, baseDecimals, migrationPercent, supply } = shape;
  return {
    token: {
      tokenBaseDecimal: baseDecimals,
      tokenQuoteDecimal: quoteDecimals,
      // Nobody keeps the mint authority: a token that can still be minted is
      // one the hook can never hold to a cap, and create_sale refuses it.
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
    migrationQuoteThreshold: shape.threshold,
  } as unknown as BuildCurveParams;
}

/** What Meteora's curve builder makes of a shape, asked before anything is signed. */
export interface BuiltCurve {
  /** Raw units of the sale token the curve sells before it graduates: what the cap is a share of. */
  swapBaseAmount: bigint;
  /** The opening price as the builder rounds it, whole paying token per share. */
  openingPrice: number;
}

/**
 * Runs the curve through Pangu's settings and Meteora's own builder, which is
 * pure arithmetic and reads nothing from the chain.
 *
 * Throws with the builder's own message when it refuses the shape, such as
 * "SafeMath: subtraction overflow" for a curve kept back too far.
 */
export function builtCurve(shape: CurveShape): BuiltCurve {
  const config = buildCurve(panguCurve(demoCurve(shape)));
  const migration = config.curve[0]?.sqrtPrice;
  if (migration === undefined) {
    throw new Error("Meteora's curve builder returned no curve for this shape");
  }
  const swap = getBaseTokenForSwap(config.sqrtStartPrice, migration, config.curve);
  const sqrt = Number(BigInt(config.sqrtStartPrice.toString())) / 2 ** 64;
  return {
    swapBaseAmount: BigInt(swap.toString()),
    openingPrice: sqrt * sqrt * 10 ** (shape.baseDecimals - shape.quoteDecimals),
  };
}

/** True when a whole amount at these decimals still fits in a token account. */
export function fitsRaw(whole: number, decimals: number): boolean {
  if (!Number.isFinite(whole) || whole < 0) {
    return false;
  }
  const scaled = BigInt(Math.ceil(whole)) * 10n ** BigInt(decimals);
  return scaled <= U64_MAX;
}
