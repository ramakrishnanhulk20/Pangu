// The launch command's refusal of a price ceiling on a paying token the devnet
// program does not list as a dollar.
//
// Not covered: the program's own refusal. The SDK fork suite and the devnet
// refusal recorded in docs/measurements/devnet-run.md prove the chain agrees.

import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { explainPanguError } from "pangu-sdk";
import { dollarQuoteRefusal } from "../src/launch.js";

// The price refresher pulls in Pyth's Jito helper, whose ESM build names a file
// without its extension and cannot load under vitest. The refusal never
// refreshes a price, so the module is stood in for.
vi.mock("../src/price-refresh.js", () => ({ refreshFeedPrice: vi.fn() }));

const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const DEMO_DOLLAR = new PublicKey("2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5");
const MAINNET_USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const SENTENCE = explainPanguError("BandNeedsDollarQuote");

describe("a price ceiling at launch", () => {
  it("opens on devnet USDC and on the demo dollar", () => {
    expect(dollarQuoteRefusal(500, DEVNET_USDC)).toBeNull();
    expect(dollarQuoteRefusal(500, DEMO_DOLLAR)).toBeNull();
  });

  it("is refused on wrapped SOL with the sentence the app shows", () => {
    expect(dollarQuoteRefusal(500, NATIVE_MINT)).toBe(SENTENCE);
    expect(SENTENCE).toMatch(/^A price ceiling needs buyers to pay in a dollar token/);
  });

  it("is refused on a fresh mint that merely looks like a dollar", () => {
    expect(dollarQuoteRefusal(1, Keypair.generate().publicKey)).toBe(SENTENCE);
  });

  it("is refused on mainnet USDC, which the devnet program does not list", () => {
    expect(dollarQuoteRefusal(500, MAINNET_USDC)).toBe(SENTENCE);
  });

  it("is no concern without a ceiling, whatever the paying token", () => {
    expect(dollarQuoteRefusal(0, NATIVE_MINT)).toBeNull();
    expect(dollarQuoteRefusal(0, Keypair.generate().publicKey)).toBeNull();
  });
});
