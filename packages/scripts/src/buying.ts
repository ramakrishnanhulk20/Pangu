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
