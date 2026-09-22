import { LIMITS } from "./constants.js";
import { PanguInputError, requireBigint, requireWholeNumber } from "./inputs.js";

/**
 * Every price in this package is a dollar amount scaled by 1e18, the scale
 * Switchboard publishes its feed values in. Working in the feed's own scale
 * means the band comparison never rounds twice.
 */
export const DOLLAR_SCALE = 10n ** 18n;

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/**
 * The curve's price in dollars per whole token, scaled by 1e18 and rounded UP.
 *
 * `sqrtPrice` is DBC's Q64.64 square root of quote raw units per base raw unit,
 * so the price is `(sqrtPrice / 2^64)^2` shifted by the two mints' decimals.
 * Rounding goes up, always, matching `curve_price_ceil_1e18` in
 * programs/pangu/src/price.rs, so a fraction of a unit can never be the reason
 * a buy looks allowed here and is refused on chain.
 *
 * Throws PanguInputError for a negative square root price or for decimals past
 * the program's own limit of 18.
 */
export function curvePriceDollars(
  sqrtPrice: bigint,
  baseDecimals: number,
  quoteDecimals: number
): bigint {
  const root = requireBigint(sqrtPrice, "sqrtPrice");
  if (root < 0n) {
    throw new PanguInputError("sqrtPrice cannot be negative");
  }
  const base = requireWholeNumber(baseDecimals, "baseDecimals", 0, LIMITS.maxDecimals);
  const quote = requireWholeNumber(
    quoteDecimals,
    "quoteDecimals",
    0,
    LIMITS.maxDecimals
  );

  const numerator = root * root * pow10(18 + base);
  const denominator = (1n << 128n) * pow10(quote);
  const whole = numerator / denominator;
  return numerator % denominator === 0n ? whole : whole + 1n;
}

/** The part of a sale's rules the ceiling is worked out from. */
export interface BandRules {
  bandBps: number;
}

/**
 * The highest curve price this sale allows, scaled by 1e18 and rounded DOWN.
 *
 * Rounding down here and up in `curvePriceDollars` is the program's own pairing
 * (`band_ceiling_floor_1e18`): a buy that lands exactly on the ceiling passes,
 * and nothing between the two roundings slips through.
 *
 * Throws PanguInputError when the sale has no band or the stock price is not
 * above zero, which is what the program treats as an unusable price.
 */
export function priceCeiling(sale: BandRules, stockPrice: bigint): bigint {
  const bandBps = requireWholeNumber(
    sale?.bandBps,
    "sale.bandBps",
    1,
    LIMITS.maxBandBps
  );
  const price = requireBigint(stockPrice, "stockPrice");
  if (price <= 0n) {
    throw new PanguInputError(
      "a stock price of zero or less is never a ceiling, the program refuses it"
    );
  }
  return (price * BigInt(10_000 + bandBps)) / 10_000n;
}

/** The same 1e18 scaled number as dollars, for display only. */
export function dollars(scaled: bigint): number {
  return Number(scaled) / Number(DOLLAR_SCALE);
}
