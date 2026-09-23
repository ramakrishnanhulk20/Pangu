// The dollar list a price ceiling needs, per network, as the program's builds carry it.
//
// Not covered: whether the program on chain carries the same list. The SDK fork
// suite and the devnet refusal in docs/measurements/devnet-run.md prove that.

import { describe, expect, it } from "vitest";
import { dollarMints } from "../src/index.js";

const base58 = (network: "devnet" | "mainnet") =>
  dollarMints(network).map((mint) => mint.toBase58());

describe("dollarMints", () => {
  it("lists devnet USDC and the demo dollar for devnet", () => {
    expect(base58("devnet")).toEqual([
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      "2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5",
    ]);
  });

  it("lists only USDC for mainnet", () => {
    expect(base58("mainnet")).toEqual(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]);
  });

  it("does not list wrapped SOL on either network", () => {
    const wrappedSol = "So11111111111111111111111111111111111111112";
    expect(base58("devnet")).not.toContain(wrappedSol);
    expect(base58("mainnet")).not.toContain(wrappedSol);
  });

  it("hands each caller its own copy", () => {
    const first = dollarMints("devnet");
    first.pop();
    expect(dollarMints("devnet")).toHaveLength(2);
  });

  it("refuses a network it has no list for", () => {
    expect(() => dollarMints("testnet" as "devnet")).toThrow(/no dollar list/);
    expect(() => dollarMints("toString" as "devnet")).toThrow(/no dollar list/);
  });
});
