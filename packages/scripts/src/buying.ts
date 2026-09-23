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
  return tokensWorth(tokens, BigInt(view.poolAccount.poolState.sqrtPrice.toString()), decimals);
}

/**
 * What `tokens` raw units of the sale token cost at a square root price, in raw
 * units of the paying token.
 *
 * `decimals.quoteDecimals` has to be the paying mint's own, from
 * `payingDecimals`. The sale's rules read zero for it on any sale without a
 * band, and a zero here is the million-fold undersizing a dollar sale suffered.
 */
export function tokensWorth(tokens: bigint, sqrtPrice: bigint, decimals: TokenDecimals): bigint {
  const price = curvePriceDollars(sqrtPrice, decimals.baseDecimals, decimals.quoteDecimals);
  return (
    (tokens * price * 10n ** BigInt(decimals.quoteDecimals)) /
    (DOLLAR_SCALE * 10n ** BigInt(decimals.baseDecimals))
  );
}

/**
 * What one wallet's whole cap is worth when a curve has raised its threshold,
 * in raw units of the paying token.
 *
 * `threshold` is in whole units of the paying token, as sales.json records it,
 * and `quoteDecimals` is the paying mint's own. Whole numbers all the way
 * through, because a dollar threshold is bigger than a float carries to the
 * last unit.
 */
export function capWorthAtThreshold(
  threshold: number,
  quoteDecimals: number,
  capShareBps: number
): bigint {
  return (
    (BigInt(Math.round(threshold * 100)) * 10n ** BigInt(quoteDecimals) * BigInt(capShareBps)) /
    1_000_000n
  );
}

/** What each of the six even seeded buys aims at: two fifths of the cap's worth. */
export function evenBuySize(threshold: number, quoteDecimals: number, capShareBps: number): bigint {
  return (capWorthAtThreshold(threshold, quoteDecimals, capShareBps) * 2n) / 5n;
}

/**
 * Whether a failed quote or build means the curve itself cannot do this.
 *
 * These are the three refusals Meteora's quote functions give for a curve that
 * is too short or already full, in dynamic-bonding-curve-sdk 1.5.12: not
 * enough liquidity, insufficient liquidity, and a completed pool. Anything
 * else, a rate limited node above all, is not the curve talking and must not
 * be read as "that size does not fit".
 */
export function isCurveLimit(error: unknown): boolean {
  const said = error instanceof Error ? error.message : String(error);
  return /not enough liquidity|insufficient liquidity|virtual pool is completed/i.test(said);
}

/** The curve cannot fill what was asked for. A limit of the sale, never of the node. */
export class CurveLimit extends Error {
  constructor(said: string) {
    super(`the curve cannot fill this buy: ${said}`);
    this.name = "CurveLimit";
  }
}

/** How long to wait before the one retry a failed request gets. */
const RETRY_WAIT_MS = 2_000;

function saidBy(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs a quote or a build, and once more if it failed for any reason other than
 * the curve.
 *
 * A curve limit is thrown straight away as a `CurveLimit`, because asking again
 * will not change it. Any other failure gets one retry after a short wait, and a
 * second failure stops the run with the node's own words: a size worked out
 * from a request that never answered is a guess.
 */
export async function quoteOnceMore<T>(
  run: () => Promise<T>,
  waitMs: number = RETRY_WAIT_MS
): Promise<T> {
  try {
    return await run();
  } catch (first) {
    if (isCurveLimit(first)) {
      throw new CurveLimit(saidBy(first));
    }
    await new Promise((wake) => setTimeout(wake, waitMs));
    try {
      return await run();
    } catch (second) {
      if (isCurveLimit(second)) {
        throw new CurveLimit(saidBy(second));
      }
      throw new Error(
        `the node failed twice while this buy was being built, so the run stops rather than guess at a size: ${saidBy(second)}`
      );
    }
  }
}

/** How many builds a buy aimed at a number of tokens may take. */
const AIM_TRIES = 6;

/** How far past the tokens asked for an aimed buy may land: half a percent. */
const AIM_SLACK_PART = 200n;

/**
 * A buy that returns at least `tokens` raw units of the sale token, and not
 * much more.
 *
 * The SDK builds a buy from what it spends, so the spend is worked back from
 * the tokens: `start` first, then scaled by how far each build missed. The
 * price climbs through a buy, so a build aimed with the price before it comes
 * back a little short, and the scale plus a small nudge closes the gap from
 * below in two or three builds.
 *
 * Throws when no build reached the tokens asked for.
 */
export async function aimAtTokens<T extends { expectedAmountOut: bigint }>(
  build: (amountIn: bigint) => Promise<T>,
  start: bigint,
  tokens: bigint
): Promise<T & { amountIn: bigint }> {
  const slack = tokens / AIM_SLACK_PART + 1n;
  let amountIn = start > 0n ? start : 1n;
  let best: (T & { amountIn: bigint }) | null = null;
  let closest = 0n;
  for (let tries = 0; tries < AIM_TRIES; tries += 1) {
    const built = await build(amountIn);
    const out = built.expectedAmountOut;
    closest = out;
    if (out >= tokens) {
      if (best === null || out < best.expectedAmountOut) {
        best = { ...built, amountIn };
      }
      if (out - tokens <= slack) {
        return best;
      }
    }
    if (out === 0n) {
      amountIn *= 2n;
      continue;
    }
    const scaled = (amountIn * tokens) / out;
    amountIn = scaled + scaled / 4_000n + 1n;
  }
  if (best !== null) {
    return best;
  }
  throw new Error(
    `could not aim a buy at ${tokens} raw units in ${AIM_TRIES} builds: the closest returned ${closest}`
  );
}

/**
 * A buy of at least `tokens` raw units of the sale token, built for `buyer`.
 *
 * Throws `CurveLimit` when the curve cannot fill that many, and a plain error
 * when the node failed twice.
 */
export async function buyAtLeast(
  connection: Connection,
  buyer: PublicKey,
  mint: PublicKey,
  decimals: TokenDecimals,
  tokens: bigint
): Promise<SizedBuy> {
  const start = await quoteOnceMore(() => quoteForTokens(connection, mint, decimals, tokens));
  return aimAtTokens(
    (amountIn) => quoteOnceMore(() => buyTransaction({ connection, buyer, mint, amountIn })),
    start,
    tokens
  );
}

/**
 * How many tokens the smallest buy that breaks a cap asks for: the room this
 * wallet has left plus one raw unit. Or why no such buy exists here.
 *
 * Sized in sale tokens, never as a multiple of what the cap is worth. On a
 * banded sale a buy worth several caps walks the curve past the ceiling, and
 * the hook judges the band before the cap, so the answer was PriceOutsideBand
 * and said nothing about the cap.
 */
export function overCapSize(
  room: bigint,
  tokensLeft: bigint
): { tokens: bigint } | { skip: string } {
  const tokens = room + 1n;
  if (tokens > tokensLeft) {
    return {
      skip: `the curve has ${tokensLeft} raw units left, fewer than this wallet's ${room} of room plus one, so no single buy can cross the cap`,
    };
  }
  return { tokens };
}
