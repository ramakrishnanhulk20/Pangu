/**
 * Sizing a buy that the sale will actually accept.
 *
 * Two things shrink a buy: the room left under the wallet's cap, and the tokens
 * left on the curve. Meteora's quote refuses an exact-in swap larger than the
 * curve can fill, so a refusal is the signal to halve and try again. The same
 * search the fork test uses, against the live chain.
 */

import type { Connection, PublicKey } from "@solana/web3.js";
import { DOLLAR_SCALE, curvePriceDollars } from "pangu-sdk";
import { buyTransaction, loadPool, type TradeTransaction } from "pangu-sdk/dbc";

/** The two decimal counts a price has to be read through, off the sale's rules. */
export interface TokenDecimals {
  baseDecimals: number;
  quoteDecimals: number;
}

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

/** A built buy, and the paying token it will actually take from the wallet. */
export type SizedBuy = TradeTransaction & { amountIn: bigint };

/**
 * The largest buy this wallet can make: at most `wanted`, and comfortably
 * inside `capRoom` tokens out, and never more than the curve can fill.
 *
 * The amount it settled on comes back with it, so a caller can hand the wallet
 * exactly that much of the paying token and leave no dust behind.
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
): Promise<SizedBuy> {
  const room = capRoom - capRoom / CAP_MARGIN;
  const fits = async (amountIn: bigint): Promise<SizedBuy | null> => {
    if (amountIn <= 0n) {
      return null;
    }
    try {
      const built = await buyTransaction({ connection, buyer, mint, amountIn });
      return built.expectedAmountOut <= room ? { ...built, amountIn } : null;
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
  let best: SizedBuy | null = null;
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

/**
 * How the seeded buys are spread across the demo wallets: eight different
 * sizes, largest second, so a judge sees a real spread of holders rather than
 * eight identical ones. Weights, not shares: what each one comes to depends on
 * how far the seeding is asked to go.
 */
export const SEED_WEIGHTS = [9, 19, 11, 18, 12, 17, 13, 16] as const;

/** How much of the curve one seeded wallet may take, as a share of its cap. */
const SEED_MOST_OF_CAP = 0.95;

/** Raw units of the sale token sold when a curve stands at `target`, 0 to 1. */
export function targetSold(curveTokens: bigint, target: number): bigint {
  return (BigInt(Math.round(target * 1e6)) * curveTokens) / 1_000_000n;
}

/**
 * How much one seeded wallet sells back when the curve stands above its
 * seeding target, in raw units of the sale token.
 *
 * The excess is shared out in proportion to what each seeded wallet holds, so
 * every holder is still a holder afterwards and the spread of sizes survives.
 * Never more than the wallet holds.
 */
export function sellBackSize(held: bigint, excess: bigint, seededTotal: bigint): bigint {
  if (held <= 0n || excess <= 0n || seededTotal <= 0n) {
    return 0n;
  }
  const share = (held * excess) / seededTotal;
  return share > held ? held : share;
}

/**
 * How many of the curve's tokens the next seeded wallet should buy, in raw
 * units of the sale token.
 *
 * Sized in tokens rather than in the paying token, because what the demo is
 * aimed at is a place on the curve: sell this share of it and the price sits
 * where the ceiling can be shown. The weights are normalised over the wallets
 * that are left, so a buy that comes back short is made up by the ones after
 * it, and every wallet stays under its cap.
 *
 * Returns zero when the target is already reached, which is the signal to stop
 * buying.
 */
export function seedBuySize(
  input: {
    /** Raw units of the sale token the curve sells in total. */
    curveTokens: bigint;
    /** Raw units already sold, read off the sale. */
    sold: bigint;
    /** Where the seeding stops, as a share of the curve's tokens, 0 to 1. */
    target: number;
    /** The most one wallet may hold, in raw units. */
    cap: bigint;
  },
  wallet: number
): bigint {
  const weights = SEED_WEIGHTS.slice(wallet);
  const weight = weights[0];
  if (weight === undefined) {
    return 0n;
  }
  const wanted = targetSold(input.curveTokens, input.target);
  if (wanted <= input.sold) {
    return 0n;
  }
  const left = wanted - input.sold;
  const total = weights.reduce((sum, each) => sum + each, 0);
  const share = (left * BigInt(weight)) / BigInt(total);
  const most = BigInt(Math.round(SEED_MOST_OF_CAP * 1_000)) * input.cap / 1_000n;
  return share > most ? most : share;
}

/**
 * A buy of about `tokens` raw units of the sale token, and never more.
 *
 * Two quotes at most. The first is aimed with the pool's own price, which is
 * the price before the buy, so it comes back a little under: the curve rises
 * while it fills. The second only happens if the first came back over the room
 * asked for, and it shrinks by the ratio it was out by.
 *
 * Nothing here treats a failure as "that size does not fit". On a node that is
 * rate limiting, a search that reads every error that way walks itself down to
 * half the size it was asked for, which is what happened on 22 September 2026:
 * the first two seeded buys came out at half their planned share. A quote that
 * will not answer stops the run instead.
 */
export async function sizedBuy(
  connection: Connection,
  buyer: PublicKey,
  mint: PublicKey,
  decimals: TokenDecimals,
  tokens: bigint
): Promise<SizedBuy> {
  let amountIn = await quoteForTokens(connection, mint, decimals, tokens);
  let built = await buyTransaction({ connection, buyer, mint, amountIn });
  if (built.expectedAmountOut > tokens) {
    amountIn = (amountIn * tokens * 98n) / (built.expectedAmountOut * 100n);
    built = await buyTransaction({ connection, buyer, mint, amountIn });
  }
  return { ...built, amountIn };
}

/**
 * What `tokens` raw units of the sale token cost right now, in raw units of the
 * paying token, read off the pool's own square root price.
 *
 * It is the price before the buy, so a buy sized with it comes out a little
 * under the tokens asked for: the curve rises while it fills. That is the safe
 * direction. The wallets after this one make up the difference, because each
 * one is sized from what has actually sold.
 */
export async function quoteForTokens(
  connection: Connection,
  mint: PublicKey,
  decimals: TokenDecimals,
  tokens: bigint
): Promise<bigint> {
  const view = await loadPool(connection, mint);
  const price = curvePriceDollars(
    BigInt(view.poolAccount.poolState.sqrtPrice.toString()),
    decimals.baseDecimals,
    decimals.quoteDecimals
  );
  return (
    (tokens * price * 10n ** BigInt(decimals.quoteDecimals)) /
    (DOLLAR_SCALE * 10n ** BigInt(decimals.baseDecimals))
  );
}
