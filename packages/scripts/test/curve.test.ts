// The shape of a demo sale's bonding curve, worked out before anything is sent.
//
// Does NOT cover: what Meteora's own buildCurve does with the shape. The devnet
// run is what proves the opening price it prints is the price the pool opens at.

import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { TokenDecimal } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  DEFAULT_SUPPLY,
  graduationPrice,
  openingPrice,
  shareSoldAtPrice,
  type CurveShape,
} from "../src/curve.js";
import { bandQuoteRefusal } from "../src/feeds.js";

/** Stands in for the dollar token mint-dollars makes. */
const DOLLARS = Keypair.generate().publicKey;

/** The shape the fourth devnet run opened its banded dollar sale with. */
const BILLION: CurveShape = {
  quoteDecimals: TokenDecimal.SIX,
  baseDecimals: TokenDecimal.NINE,
  supply: DEFAULT_SUPPLY,
  migrationPercent: 40,
  threshold: 360_000_000_000,
};

/** Twenty shares reaching the same price on a raise somebody could fill. */
const TWENTY: CurveShape = { ...BILLION, supply: 20, migrationPercent: 45, threshold: 3_710 };

describe("the opening price", () => {
  it("matches the billion share curve the devnet run measured at 400 dollars", () => {
    expect(openingPrice(BILLION)).toBeCloseTo(400, 6);
  });

  it("reads the supply from the shape rather than assuming a billion", () => {
    expect(openingPrice(TWENTY)).toBeCloseTo(275.95, 2);
    expect(openingPrice({ ...TWENTY, supply: 40 })).toBeCloseTo(openingPrice(TWENTY) / 2, 6);
  });

  it("ends higher than it opens, by the square of what is kept back", () => {
    expect(graduationPrice(BILLION)).toBeCloseTo(900, 6);
    expect(graduationPrice(TWENTY)).toBeGreaterThan(openingPrice(TWENTY));
  });
});

describe("where a price ceiling bites", () => {
  it("says what share of the curve sells before the ceiling is reached", () => {
    // Apple at 345 dollars with a 5 percent band is a ceiling of 362.25.
    expect(shareSoldAtPrice(TWENTY, 362.25, DOLLARS)).toBeCloseTo(0.7, 2);
  });

  it("answers below zero when the curve opens above the ceiling", () => {
    expect(shareSoldAtPrice(BILLION, 362.25, DOLLARS)).toBeLessThan(0);
  });

  it("answers above one when the curve ends below the ceiling", () => {
    expect(shareSoldAtPrice({ ...TWENTY, threshold: 500 }, 362.25, DOLLARS)).toBeGreaterThan(1);
  });
});

describe("a band on a sale paid in SOL", () => {
  it("is refused at launch with a sentence that says what to pass instead", () => {
    expect(bandQuoteRefusal(500, NATIVE_MINT)).toMatch(/paid in SOL.*--quote/);
  });

  it("is no problem without a band, or with a band on a dollar token", () => {
    expect(bandQuoteRefusal(0, NATIVE_MINT)).toBeNull();
    expect(bandQuoteRefusal(500, DOLLARS)).toBeNull();
  });

  it("is never worked out as a place on the curve", () => {
    expect(() => shareSoldAtPrice({ ...TWENTY, quoteDecimals: TokenDecimal.NINE }, 362.25, NATIVE_MINT)).toThrow(
      /paid in SOL/
    );
  });
});
