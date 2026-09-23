// The end of the offering period, as launch reads it off the command line.
//
// Does NOT cover: the chain refusing an end that has passed (EndInThePast),
// which the program's own tests prove, or launch sending anything.

import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { ArgumentError, readFlags } from "../src/arguments.js";
import { chainTime } from "../src/chain.js";
import {
  NO_END_FLAG,
  describeEnd,
  endsAtFrom,
  endsAtRecord,
  offeringChoice,
} from "../src/offering.js";

const read = (argv: string[]) => readFlags(argv, ["ends-in", "mode"], [NO_END_FLAG]);

describe("the offering period choice", () => {
  it("refuses a launch that says nothing about when the offering ends", () => {
    expect(() => offeringChoice(read(["--mode", "list"]))).toThrow(ArgumentError);
    expect(() => offeringChoice(read([]))).toThrow(/--ends-in <hours>.*--no-end/);
  });

  it("refuses both at once, because they disagree", () => {
    expect(() => offeringChoice(read(["--ends-in", "24", "--no-end"]))).toThrow(/both given/);
  });

  it("reads --ends-in as hours, fractions included", () => {
    expect(offeringChoice(read(["--ends-in", "48"]))).toEqual({ kind: "ends-in", hours: 48 });
    expect(offeringChoice(read(["--ends-in=0.5"]))).toEqual({ kind: "ends-in", hours: 0.5 });
  });

  it("refuses an offering shorter than six minutes or longer than a year", () => {
    expect(() => offeringChoice(read(["--ends-in", "0.05"]))).toThrow(/between/);
    expect(() => offeringChoice(read(["--ends-in", "9000"]))).toThrow(/between/);
    expect(() => offeringChoice(read(["--ends-in", "soon"]))).toThrow(/must be a number/);
  });

  it("reads --no-end as no end", () => {
    expect(offeringChoice(read(["--no-end"]))).toEqual({ kind: "no-end" });
  });
});

describe("ends_at", () => {
  it("reads the chain's clock off the clock sysvar, not this machine", async () => {
    const data = Buffer.alloc(40);
    data.writeBigInt64LE(1_900_000_123n, 32);
    const node = {
      getAccountInfo: async () => ({
        data,
        owner: PublicKey.default,
        lamports: 1,
        executable: false,
        rentEpoch: 0,
      }),
    };
    expect(await chainTime(node)).toBe(1_900_000_123);
    await expect(chainTime({ getAccountInfo: async () => null })).rejects.toThrow(/no clock/);
  });

  it("counts from the chain clock, in whole seconds", () => {
    expect(endsAtFrom({ kind: "ends-in", hours: 2 }, 1_900_000_000)).toBe(1_900_007_200);
    expect(endsAtFrom({ kind: "ends-in", hours: 0.25 }, 1_900_000_000.9)).toBe(1_900_000_900);
  });

  it("is zero for no end, which the program reads as no end", () => {
    expect(endsAtFrom({ kind: "no-end" }, 1_900_000_000)).toBe(0);
  });

  it("is stored in sales.json as an ISO time, or null", () => {
    expect(endsAtRecord(1_900_000_000)).toBe("2030-03-17T17:46:40.000Z");
    expect(endsAtRecord(0)).toBeNull();
    expect(endsAtRecord(null)).toBeNull();
    expect(describeEnd(0)).toMatch(/no end/);
    expect(describeEnd(1_900_000_000, { kind: "ends-in", hours: 48 })).toMatch(/48 hours after/);
  });
});
