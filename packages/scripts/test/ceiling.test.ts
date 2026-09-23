// The search for the smallest buy that pushes a curve past its price ceiling.
//
// Does NOT cover: Meteora's quote itself, which priceAfterOnPool calls with the
// same arguments preflightBuy uses. The devnet prove run checks the size it
// finds against preflightBuy and the chain.

import { describe, expect, it } from "vitest";
import { smallestCrossing, type PriceAfter } from "../src/ceiling.js";

/** A curve whose price starts at 100 and rises by one per token, with 10,000 tokens on it. */
const straight: PriceAfter = (tokens) => (tokens > 10_000n ? null : 100n + tokens);

describe("the smallest buy over the ceiling", () => {
  it("lands on the first size whose price is over, with the one before it still under", () => {
    const found = smallestCrossing(straight, 4_321n, 1_000_000n);
    expect(found).toEqual({ tokens: 4_222n, price: 4_322n });
    expect(straight(4_221n)).toBe(4_321n);
  });

  it("is one token when the curve already stands over the ceiling", () => {
    expect(smallestCrossing(straight, 50n, 1_000_000n)).toEqual({ tokens: 1n, price: 101n });
  });

  it("says the curve cannot reach a ceiling above where it ends, and how high it gets", () => {
    expect(smallestCrossing(straight, 1_000_000n, 1_000_000n)).toEqual({
      tokens: null,
      highest: 10_100n,
    });
  });
});
