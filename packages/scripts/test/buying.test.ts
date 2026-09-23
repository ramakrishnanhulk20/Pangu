// Sizing the next buy when a curve is being filled, and the spread of sizes a
// seeded demo sale is given.
//
// Not covered: buyWithin, which needs a live curve to quote against. The fork
// run and the devnet graduate and seed runs cover that.

import { describe, expect, it } from "vitest";
import {
  SEED_WEIGHTS,
  nextBuy,
  seedBuySize,
  sellBackSize,
  targetSold,
} from "../src/buying.js";

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
