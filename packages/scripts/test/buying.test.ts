// Sizing the next buy when a curve is being filled.
//
// Not covered: buyWithin, which needs a live curve to quote against. The fork
// run and the devnet graduate run cover that.

import { describe, expect, it } from "vitest";
import { nextBuy } from "../src/buying.js";

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
