// The table `prove` prints, what counts as a deviation, and the exit code.
//
// Does NOT cover: the attacks themselves, which only mean anything against the
// live program, or how a refusal is read out of a transaction's logs.

import { describe, expect, it } from "vitest";
import {
  deviated,
  exitCode,
  renderLinks,
  renderTable,
  summarise,
  summaryLine,
  type AttackReport,
} from "../src/attack-table.js";

function report(over: Partial<AttackReport> = {}): AttackReport {
  return {
    attack: "buy past the cap in one go",
    invariant: "C3",
    expected: "OverCap",
    actual: "OverCap",
    verdict: "refused",
    signature: "5Qy6oUUd",
    link: "https://explorer.solana.com/tx/5Qy6oUUd?cluster=devnet",
    ...over,
  };
}

describe("deviated", () => {
  it("is false when what happened is what the rules promise", () => {
    expect(deviated(report())).toBe(false);
  });

  it("is true when an attack went through", () => {
    expect(deviated(report({ actual: "it went through", verdict: "allowed" }))).toBe(
      true
    );
  });

  it("is true when the refusal came from somewhere other than the sale's rules", () => {
    expect(deviated(report({ actual: "refused, but not by Pangu: no logs" }))).toBe(true);
  });

  it("is never true for an attack that was not run", () => {
    const notRun = report({
      verdict: "skipped",
      actual: "this sale has open access",
      signature: null,
      link: null,
    });
    expect(deviated(notRun)).toBe(false);
  });
});

describe("the summary", () => {
  const reports = [
    report(),
    report({ attack: "a revoked wallet sells back", expected: "it goes through", actual: "it goes through", verdict: "allowed" }),
    report({ attack: "not applicable here", verdict: "skipped", actual: "no band", signature: null, link: null }),
  ];

  it("counts what ran, what was refused, and what was allowed", () => {
    expect(summarise(reports)).toEqual({
      attempted: 2,
      refusedAsExpected: 1,
      allowedAsExpected: 1,
      skipped: 1,
      deviations: 0,
    });
  });

  it("reads as one sentence", () => {
    expect(summaryLine(summarise(reports))).toBe(
      "2 attacks run, 1 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard"
    );
  });

  it("exits zero only when nothing deviated", () => {
    expect(exitCode(reports)).toBe(0);
    expect(exitCode([...reports, report({ actual: "it went through", verdict: "allowed" })])).toBe(1);
  });
});

describe("the table", () => {
  it("says ok, DEVIATION or skipped on every line, and lines the columns up", () => {
    const text = renderTable([
      report(),
      report({ attack: "wallet to wallet", actual: "it went through", verdict: "allowed" }),
      report({ attack: "the band", verdict: "skipped", actual: "no band", signature: null, link: null }),
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^Attack +Invariant +Expected +Actual +Result +Proof$/);
    expect(lines[2]).toContain("ok");
    expect(lines[3]).toContain("DEVIATION");
    expect(lines[4]).toContain("skipped");
    expect(lines[4]).toContain("not run");
  });

  it("lists a link only for the attacks that landed on chain", () => {
    const links = renderLinks([
      report(),
      report({ verdict: "skipped", signature: null, link: null }),
    ]);
    expect(links.split("\n")).toHaveLength(1);
    expect(links).toContain("?cluster=devnet");
  });
});
