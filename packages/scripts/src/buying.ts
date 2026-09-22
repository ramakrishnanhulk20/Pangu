/**
 * Sizing a buy that the sale will actually accept.
 *
 * Two things shrink a buy: the room left under the wallet's cap, and the tokens
 * left on the curve. Meteora's quote refuses an exact-in swap larger than the
 * curve can fill, so a refusal is the signal to halve and try again. The same
 * search the fork test uses, against the live chain.
 */

import type { Connection, PublicKey } from "@solana/web3.js";
import { buyTransaction, type TradeTransaction } from "pangu-sdk/dbc";

/**
 * How much more than what is left the finishing buy reaches for: 101 percent,
 * plus a little, so the fee does not leave the curve a few units short.
 */
const FINISHING_HEADROOM = 10_100n;
const FINISHING_MARGIN = 100_000n;

/** When the buy that is meant to finish a curve starts: the last fifth of it. */
const FINISHING_SHARE = 2n;

/** What one more buyer should spend, and whether that buy is meant to fill the curve. */
export interface NextBuy {
  /** Raw units of the paying token to spend. */
  wanted: bigint;
  /**
   * True when this buy is sized to finish the curve, which is a partial fill:
   * the tokens run out before the paying side does, so Meteora takes what is
   * left and leaves the rest in the buyer's account.
   */
  finishing: boolean;
}

/**
 * Sizes the next buy from what the curve still has to raise.
 *
 * Everything here is in the paying token's raw units, on both sides of every
 * comparison. That is the whole point of the function: the caller used to
 * compare lamports still to raise against a cap counted in sale tokens, which
 * is true for any curve worth filling, so every buy took the finishing path and
 * the first real one was refused OverCap.
 *
 * Away from the end it asks for a tenth of the whole threshold, which
 * `buyWithin` then shrinks to whatever the wallet's cap allows. Inside the last
 * fifth it asks for what is left plus a margin, and says so, so the caller can
 * send it as a partial fill.
 */
export function nextBuy(threshold: bigint, raised: bigint): NextBuy {
  const left = threshold > raised ? threshold - raised : 0n;
  const finishing = left < (threshold * FINISHING_SHARE) / 10n;
  return {
    wanted: finishing
      ? (left * FINISHING_HEADROOM) / 10_000n + FINISHING_MARGIN
      : threshold / 10n,
    finishing,
  };
}

/** Stop halving once the two ends are this close, in raw units of the paying token. */
const SEARCH_PRECISION = 10_000n;

/**
 * How far under the room left the search aims, as a divisor: 50 is two percent.
 *
 * Meteora's quote and the chain's own swap can land a few units apart, and a
 * buy aimed exactly at the cap is refused when they do. Measured on devnet on
 * 22 September 2026: a buy sized to the last unit of the cap came back OverCap.
 */
const CAP_MARGIN = 50n;

/**
 * The largest buy this wallet can make: at most `wanted`, and comfortably
 * inside `capRoom` tokens out, and never more than the curve can fill.
 *
 * Throws when no buy of any size fits, which means the wallet is already at its
 * cap or the curve is finished.
 */
export async function buyWithin(
  connection: Connection,
  buyer: PublicKey,
  mint: PublicKey,
  wanted: bigint,
  capRoom: bigint
): Promise<TradeTransaction> {
  const room = capRoom - capRoom / CAP_MARGIN;
  const fits = async (amountIn: bigint): Promise<TradeTransaction | null> => {
    if (amountIn <= 0n) {
      return null;
    }
    try {
      const built = await buyTransaction({ connection, buyer, mint, amountIn });
      return built.expectedAmountOut <= room ? built : null;
    } catch {
      return null;
    }
  };

  const straight = await fits(wanted);
  if (straight !== null) {
    return straight;
  }

  let low = 0n;
  let high = wanted;
  let best: TradeTransaction | null = null;
  while (high - low > SEARCH_PRECISION) {
    const middle = (low + high) / 2n;
    const built = await fits(middle);
    if (built === null) {
      high = middle;
    } else {
      low = middle;
      best = built;
    }
  }
  if (best === null) {
    throw new Error(
      `no buy fits: ${buyer.toBase58()} has ${capRoom} raw units of room left and the curve could not fill even the smallest try`
    );
  }
  return best;
}
