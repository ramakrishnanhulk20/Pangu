// Flag reading for the devnet commands.
//
// Does NOT cover: anything that touches the network, the keypair file, or what
// a command does with the values once it has them.

import { describe, expect, it } from "vitest";
import {
  ArgumentError,
  amount,
  choice,
  readFlags,
  requiredText,
  text,
  wholeNumber,
} from "../src/arguments.js";

const KNOWN = ["mode", "band", "threshold-sol"];

describe("readFlags", () => {
  it("reads both ways of writing a flag", () => {
    const flags = readFlags(["--mode", "list", "--band=500"], KNOWN);
    expect(flags.get("mode")).toBe("list");
    expect(flags.get("band")).toBe("500");
  });

  it("refuses a flag the command does not take", () => {
    expect(() => readFlags(["--mod", "list"], KNOWN)).toThrow(ArgumentError);
  });

  it("refuses the same flag twice, because the two would disagree", () => {
    expect(() => readFlags(["--mode", "list", "--mode", "open"], KNOWN)).toThrow(
      /twice/
    );
  });

  it("refuses a flag with nothing after it", () => {
    expect(() => readFlags(["--mode"], KNOWN)).toThrow(/needs a value/);
    expect(() => readFlags(["--mode", "--band", "500"], KNOWN)).toThrow(/needs a value/);
  });

  it("refuses a bare word", () => {
    expect(() => readFlags(["list"], KNOWN)).toThrow(/is not a flag/);
  });

  it("reads nothing at all as no flags", () => {
    expect(readFlags([], KNOWN).size).toBe(0);
  });

  it("reads a switch with no value, and refuses one given a value", () => {
    const flags = readFlags(["--no-end", "--mode", "list"], KNOWN, ["no-end"]);
    expect(flags.get("no-end")).toBe("true");
    expect(flags.get("mode")).toBe("list");
    expect(() => readFlags(["--no-end=yes"], KNOWN, ["no-end"])).toThrow(/takes no value/);
    expect(() => readFlags(["--no-end", "soon"], KNOWN, ["no-end"])).toThrow(/is not a flag/);
  });
});

describe("reading one flag", () => {
  it("falls back when it was not given", () => {
    const flags = readFlags([], KNOWN);
    expect(text(flags, "mode", "list")).toBe("list");
    expect(wholeNumber(flags, "band", 1, 5_000, 0)).toBe(0);
    expect(amount(flags, "threshold-sol", 0.01, 100, 0.1)).toBe(0.1);
    expect(choice(flags, "mode", ["open", "list"] as const, "list")).toBe("list");
  });

  it("refuses a word that is not one of the choices", () => {
    const flags = readFlags(["--mode", "sideways"], KNOWN);
    expect(() => choice(flags, "mode", ["open", "list"] as const, "list")).toThrow(
      /must be one of/
    );
  });

  it("refuses a number outside its range or with a fraction", () => {
    expect(() =>
      wholeNumber(readFlags(["--band", "9000"], KNOWN), "band", 1, 5_000, 0)
    ).toThrow(/between 1 and 5000/);
    expect(() =>
      wholeNumber(readFlags(["--band", "1.5"], KNOWN), "band", 1, 5_000, 0)
    ).toThrow(/whole number/);
    expect(() =>
      amount(readFlags(["--threshold-sol", "500"], KNOWN), "threshold-sol", 0.01, 100, 0.1)
    ).toThrow(/between/);
  });

  it("names the flag when something needed is missing", () => {
    expect(() => requiredText(readFlags([], KNOWN), "mode", "a sale needs one")).toThrow(
      /--mode is needed/
    );
  });
});
