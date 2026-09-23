/**
 * The smallest buy that pushes a banded sale's curve past its price ceiling.
 *
 * Found with Meteora's own exact-out quote, run here against one read of the
 * pool, so the search asks the node nothing. It is the same quote the SDK's
 * preflightBuy judges the band with, with the same arguments and the same
 * rounding, so a size found here is one the preflight and the chain agree on.
 */

import { swapQuoteExactOut } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { curvePriceDollars } from "pangu-sdk";
import type { PoolView } from "pangu-sdk/dbc";
import { isCurveLimit, type TokenDecimals } from "./buying.js";

/**
 * Where a buy of `tokens` raw units would leave the curve, in dollars scaled by
 * 1e18, or null when the curve cannot fill that many.
 */
export type PriceAfter = (tokens: bigint) => bigint | null;

/** The smallest crossing buy, or the highest price the curve reaches without one. */
export type Crossing =
  | { tokens: bigint; price: bigint }
  | { tokens: null; highest: bigint | null };

/**
 * The smallest number of tokens, from 1 to `most`, whose buy leaves the curve
 * above `ceiling`.
 *
 * The price only rises as a buy grows, and past the tokens the curve has left
 * the quote refuses, so along the sizes every answer is "under" until the
 * first "over" and every "over" comes before the first refusal. A plain
 * halving search for the first size that is not "under" therefore lands on the
 * crossing when there is one, and on a refusal when the curve ends first.
 */
export function smallestCrossing(priceAfter: PriceAfter, ceiling: bigint, most: bigint): Crossing {
  if (most < 1n) {
    return { tokens: null, highest: null };
  }
  const first = priceAfter(1n);
  if (first === null) {
    return { tokens: null, highest: null };
  }
  if (first > ceiling) {
    return { tokens: 1n, price: first };
  }
  const last = priceAfter(most);
  if (last !== null && last <= ceiling) {
    return { tokens: null, highest: last };
  }

  let under = 1n;
  let underPrice = first;
  let over = most;
  let overPrice = last;
  while (over - under > 1n) {
    const middle = (under + over) / 2n;
    const price = priceAfter(middle);
    if (price !== null && price <= ceiling) {
      under = middle;
      underPrice = price;
    } else {
      over = middle;
      overPrice = price;
    }
  }
  return overPrice === null
    ? { tokens: null, highest: underPrice }
    : { tokens: over, price: overPrice };
}

/**
 * Where a buy would leave this pool's curve, from Meteora's exact-out quote.
 *
 * Throws what the quote throws for anything but a curve limit.
 */
export function priceAfterOnPool(view: PoolView, decimals: TokenDecimals): PriceAfter {
  // DBC's quote takes its own big number type. The pool's clock reading is one,
  // so its constructor makes more without a second copy of bn.js.
  const Big = view.currentPoint.constructor as new (value: string) => PoolView["currentPoint"];
  return (tokens) => {
    try {
      const quote = swapQuoteExactOut(
        view.poolAccount,
        view.configState,
        false,
        new Big(tokens.toString()),
        0,
        false,
        view.currentPoint,
        false
      ) as unknown as { nextSqrtPrice: { toString(): string } };
      return curvePriceDollars(
        BigInt(quote.nextSqrtPrice.toString()),
        decimals.baseDecimals,
        decimals.quoteDecimals
      );
    } catch (error) {
      if (isCurveLimit(error)) {
        return null;
      }
      throw error;
    }
  };
}
