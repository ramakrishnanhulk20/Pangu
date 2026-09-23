// Sizing the next buy when a curve is being filled, the spread of sizes a
// seeded demo sale is given, and the paying token's decimals every size is
// scaled with.
//
// Not covered: buyWithin and buyAtLeast against a live curve. The aiming and
// the retry are tested here against stand-ins; the fork run and the devnet
// graduate, seed and prove runs cover the real quotes.

import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  CurveLimit,
  SEED_WEIGHTS,
  aimAtTokens,
  evenBuySize,
  isCurveLimit,
  nextBuy,
  overCapSize,
  quoteOnceMore,
  seedBuySize,
  sellBackSize,
  targetSold,
  tokensWorth,
} from "../src/buying.js";
import { payingDecimals } from "../src/chain.js";

/** A tenth of a SOL, the threshold the devnet demo curve graduates at. */
const THRESHOLD = 100_000_000n;

describe("sizing the next buy", () => {
  it("asks for a tenth of the threshold while the curve is still filling", () => {
    const { wanted, finishing } = nextBuy(THRESHOLD, 0n);
    expect(wanted).toBe(THRESHOLD / 10n);
    expect(finishing).toBe(false);
  });

  it("keeps saying not finishing until the last fifth is left", () => {
    // 79 percent raised leaves more than a fifth, 81 percent leaves less.
    expect(nextBuy(THRESHOLD, (THRESHOLD * 79n) / 100n).finishing).toBe(false);
    expect(nextBuy(THRESHOLD, (THRESHOLD * 81n) / 100n).finishing).toBe(true);
  });

  it("asks for what is left plus a margin on the buy that finishes it", () => {
    const raised = (THRESHOLD * 9n) / 10n;
    const { wanted, finishing } = nextBuy(THRESHOLD, raised);
    expect(finishing).toBe(true);
    expect(wanted > THRESHOLD - raised).toBe(true);
    expect(wanted < THRESHOLD / 10n + 1_000_000n).toBe(true);
  });

  it("never compares the paying token against a cap counted in sale tokens", () => {
    // The bug this replaces: a cap of 200 million sale tokens against 100
    // million lamports still to raise made every buy a finishing buy, so the
    // first one asked for the whole remainder and was refused OverCap. The
    // answer here depends on the threshold and what is raised, and on nothing
    // else, so a cap of any size cannot reach it.
    expect(nextBuy(THRESHOLD, 0n).finishing).toBe(false);
    expect(nextBuy(THRESHOLD, THRESHOLD / 2n).finishing).toBe(false);
  });

  it("does not go negative when the curve is already full", () => {
    const { wanted, finishing } = nextBuy(THRESHOLD, THRESHOLD * 2n);
    expect(finishing).toBe(true);
    expect(wanted > 0n).toBe(true);
  });
});

describe("sizing a seeded buy", () => {
  /** A curve selling eleven shares of nine decimals, with a ten percent cap. */
  const CURVE = 11_000_000_000n;
  const CAP = CURVE / 10n;
  const TARGET = 0.58;

  const plan = (): bigint[] => {
    let sold = 0n;
    return SEED_WEIGHTS.map((_unused, wallet) => {
      const size = seedBuySize({ curveTokens: CURVE, sold, target: TARGET, cap: CAP }, wallet);
      sold += size;
      return size;
    });
  };

  it("adds up to the share of the curve it was aimed at", () => {
    const total = plan().reduce((sum, each) => sum + each, 0n);
    const wanted = (CURVE * 58n) / 100n;
    expect(total).toBeGreaterThan((wanted * 99n) / 100n);
    expect(total).toBeLessThanOrEqual(wanted);
  });

  it("gives every wallet a different size, and none of them the cap", () => {
    const sizes = plan();
    expect(new Set(sizes.map(String)).size).toBe(sizes.length);
    for (const size of sizes) {
      expect(size).toBeLessThan(CAP);
      expect(size).toBeGreaterThan(CURVE / 100n);
    }
  });

  it("makes up a short buy out of the wallets that come after it", () => {
    // Two wallets in, one of them bought nothing at all. The third is sized
    // from what has really sold, not from what the plan hoped for, so it asks
    // for more.
    const short = seedBuySize({ curveTokens: CURVE, sold: CURVE / 20n, target: TARGET, cap: CAP }, 2);
    const onPlan = seedBuySize(
      { curveTokens: CURVE, sold: CURVE / 5n, target: TARGET, cap: CAP },
      2
    );
    expect(short).toBeGreaterThan(onPlan);
  });

  it("stops at zero once the target has sold", () => {
    expect(
      seedBuySize({ curveTokens: CURVE, sold: (CURVE * 60n) / 100n, target: TARGET, cap: CAP }, 3)
    ).toBe(0n);
  });
});

describe("selling a curve back down to its target", () => {
  it("shares the excess out in proportion to what each wallet holds", () => {
    const total = 1_000n;
    expect(sellBackSize(600n, 100n, total)).toBe(60n);
    expect(sellBackSize(400n, 100n, total)).toBe(40n);
  });

  it("never sells more than a wallet holds, and nothing from an empty one", () => {
    expect(sellBackSize(10n, 5_000n, 100n)).toBe(10n);
    expect(sellBackSize(0n, 100n, 1_000n)).toBe(0n);
    expect(sellBackSize(500n, 0n, 1_000n)).toBe(0n);
  });

  it("names the same place on the curve the buys are aimed at", () => {
    expect(targetSold(11_000_000_000n, 0.52)).toBe(5_720_000_000n);
  });
});

/** A node that knows one mint account and nothing else. */
function nodeWithMint(mint: PublicKey, decimals: number) {
  const data = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 1_000_000_000_000n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data
  );
  return {
    getAccountInfo: async (address: PublicKey) =>
      address.equals(mint)
        ? { owner: TOKEN_PROGRAM_ID, data, lamports: 1_461_600, executable: false, rentEpoch: 0 }
        : null,
  };
}

describe("sizing off the paying mint's own decimals", () => {
  // A sale with no band: its rules hold zero for the quote decimals.
  const sale = { baseDecimals: 6, quoteDecimals: 0 };
  const dollarMint = Keypair.generate().publicKey;

  it("reads six from a six decimal mint where the rules say zero", async () => {
    expect(await payingDecimals(nodeWithMint(dollarMint, 6), dollarMint)).toBe(6);
  });

  it("prices ten shares at four dollars each as forty dollars", async () => {
    const quoteDecimals = await payingDecimals(nodeWithMint(dollarMint, 6), dollarMint);
    // A square root price of 2^65 is four raw units of the paying token per raw
    // unit of the share, which with six decimals on both sides is four dollars.
    const sqrtPrice = 1n << 65n;
    const tenShares = 10_000_000n;
    expect(tokensWorth(tenShares, sqrtPrice, { ...sale, quoteDecimals })).toBe(40_000_000n);
  });

  it("gives the even seeded buy a real size on SOL and on dollars", async () => {
    const sol = await payingDecimals(nodeWithMint(dollarMint, 9), dollarMint);
    // 0.1 SOL threshold, ten percent cap: two fifths of 0.01 SOL.
    expect(evenBuySize(0.1, sol, 1_000)).toBe(4_000_000n);
    expect(evenBuySize(0.1, sale.quoteDecimals, 1_000)).toBe(0n);
    expect(evenBuySize(3_710, 6, 1_000)).toBe(148_400_000n);
  });

  it("refuses an address that is not a mint of either token program", async () => {
    const stranger = Keypair.generate().publicKey;
    await expect(payingDecimals(nodeWithMint(dollarMint, 6), stranger)).rejects.toThrow(
      /no mint account/
    );
    const owned = {
      getAccountInfo: async () => ({
        owner: Keypair.generate().publicKey,
        data: Buffer.alloc(MINT_SIZE),
        lamports: 1,
        executable: false,
        rentEpoch: 0,
      }),
    };
    await expect(payingDecimals(owned, dollarMint)).rejects.toThrow(/not a token program/);
  });
});

describe("sizing the buy that breaks a cap", () => {
  const CAP = 1_100_000_000n;

  it("asks for one raw unit past the room the wallet has left", () => {
    expect(overCapSize(CAP, 10n * CAP)).toEqual({ tokens: CAP + 1n });
    expect(overCapSize(22_000_000n, 10n * CAP)).toEqual({ tokens: 22_000_001n });
  });

  it("skips with the numbers when the curve has fewer tokens left than that", () => {
    const plan = overCapSize(CAP, CAP);
    expect(plan).toHaveProperty("skip");
    expect("skip" in plan ? plan.skip : "").toContain(`${CAP} raw units left`);
  });

  it("lands at or just past the tokens asked for on a curve that steepens", async () => {
    // Out falls behind in proportion as the spend grows, the way a curve does.
    const curve = async (amountIn: bigint) => ({
      expectedAmountOut: (amountIn * 10n ** 12n) / (amountIn + 10n ** 12n),
    });
    const tokens = CAP + 1n;
    const aimed = await aimAtTokens(curve, tokens, tokens);
    expect(aimed.expectedAmountOut >= tokens).toBe(true);
    expect(aimed.expectedAmountOut - tokens <= tokens / 200n + 1n).toBe(true);
  });
});

describe("a failed quote", () => {
  const busy = new Error("429 Too Many Requests: Connection rate limits exceeded");

  it("reads Meteora's three curve refusals as the curve, and a rate limit as not", () => {
    expect(isCurveLimit(new Error("Not enough liquidity"))).toBe(true);
    expect(isCurveLimit(new Error("Insufficient Liquidity"))).toBe(true);
    expect(isCurveLimit(new Error("Virtual pool is completed"))).toBe(true);
    expect(isCurveLimit(busy)).toBe(false);
  });

  it("tries a node error once more and goes on when the second answers", async () => {
    let calls = 0;
    const answer = await quoteOnceMore(async () => {
      calls += 1;
      if (calls === 1) {
        throw busy;
      }
      return 7n;
    }, 0);
    expect(answer).toBe(7n);
    expect(calls).toBe(2);
  });

  it("stops the run loudly when the node fails twice", async () => {
    let calls = 0;
    const run = quoteOnceMore(async () => {
      calls += 1;
      throw busy;
    }, 0);
    await expect(run).rejects.toThrow(/failed twice.*429/);
    expect(calls).toBe(2);
  });

  it("never retries a curve limit, and names it so the row can be skipped", async () => {
    let calls = 0;
    const run = quoteOnceMore(async () => {
      calls += 1;
      throw new Error("Not enough liquidity");
    }, 0);
    await expect(run).rejects.toBeInstanceOf(CurveLimit);
    expect(calls).toBe(1);
  });
});
