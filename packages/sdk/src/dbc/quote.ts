import { BN } from "@anchor-lang/core";
import {
  swapQuoteExactIn,
  swapQuoteExactOut,
  swapQuotePartialFill,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { PoolMarket } from "./state.js";

/**
 * The numbers Meteora's quote functions really return.
 *
 * Their published type, `SwapQuote2Result`, resolves to an empty object here
 * because it is built from an Anchor IDL lookup that TypeScript cannot follow
 * through their bundle, so the fields are written out. Every one is checked
 * against their own source (`swapQuoteExactIn` and `swapQuoteExactOut` in
 * dynamic-bonding-curve-sdk 1.5.12) and read only through `toString`, so no
 * copy of bn.js has to match.
 */
export interface SwapNumbers {
  /** What the trade returns, in raw units of the token coming out. */
  outputAmount: { toString(): string };
  /** Partial fill only: the part of the input the curve cannot take. */
  amountLeft?: { toString(): string };
  /** Where this trade leaves the curve, as DBC's Q64.64 square root price. */
  nextSqrtPrice: { toString(): string };
  /** Exact-in only: the floor after slippage. */
  minimumAmountOut?: { toString(): string };
  /** Exact-out only: the ceiling after slippage. */
  maximumAmountIn?: { toString(): string };
}

/** What this much of the paying token, or of the sale token, would return. */
export function quoteExactIn(
  view: PoolMarket,
  swapBaseForQuote: boolean,
  amountIn: bigint,
  slippageBps: number
): SwapNumbers {
  return swapQuoteExactIn(
    view.poolAccount,
    view.configState,
    swapBaseForQuote,
    new BN(amountIn.toString()),
    slippageBps,
    false,
    view.currentPoint,
    // The template Pangu builds leaves the first swap minimum fee off, and
    // loadPool refuses a template that turns it on.
    false
  ) as unknown as SwapNumbers;
}

/** What it would take to end up with this many tokens, and where that lands the curve. */
export function quoteExactOut(
  view: PoolMarket,
  swapBaseForQuote: boolean,
  amountOut: bigint,
  slippageBps: number
): SwapNumbers {
  return swapQuoteExactOut(
    view.poolAccount,
    view.configState,
    swapBaseForQuote,
    new BN(amountOut.toString()),
    slippageBps,
    false,
    view.currentPoint,
    false
  ) as unknown as SwapNumbers;
}

/**
 * What this much would buy when the curve may run out partway through.
 *
 * This is the quote behind the buy that completes a sale: DBC takes as much of
 * the input as the curve can still absorb and leaves the rest. Exact-in refuses
 * that trade outright, which is why the last buyer of every sale needs this.
 */
export function quotePartialFill(
  view: PoolMarket,
  swapBaseForQuote: boolean,
  amountIn: bigint,
  slippageBps: number
): SwapNumbers {
  return swapQuotePartialFill(
    view.poolAccount,
    view.configState,
    swapBaseForQuote,
    new BN(amountIn.toString()),
    slippageBps,
    false,
    view.currentPoint,
    false
  ) as unknown as SwapNumbers;
}
