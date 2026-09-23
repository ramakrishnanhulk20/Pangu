// Which access rows prove runs for each sale mode, against a fake chain that
// answers the way the program does and records what it was asked to do.
//
// Does NOT cover: the devnet transactions behind each call, the cap and
// ceiling rows, or whether the real program returns these error names. The
// fork tests and a live prove run cover those.

import { describe, expect, it } from "vitest";
import {
  accessRows,
  exitRow,
  type AccessChain,
  type SaleAccess,
  type Tried,
} from "../src/access-rows.js";
import { summarise } from "../src/attack-table.js";

const landed = (succeeded: boolean, refusal: string | null = null): Tried => ({
  succeeded,
  refusal,
  lastLine: succeeded ? "success" : "Program failed",
  signature: "sig",
  link: "https://explorer.solana.com/tx/sig?cluster=devnet",
});

/** A chain that behaves like the program: what each mode refuses, and what it lets through. */
function fakeChain(access: SaleAccess, overrides: Partial<AccessChain> = {}) {
  const calls: string[] = [];
  let admitted = access === "open";
  const chain: AccessChain = {
    buyWithoutRecord: async () => {
      calls.push("buyWithoutRecord");
      return landed(false, "BuyerRecordMissing");
    },
    buyAsOutsider: async () => {
      calls.push("buyAsOutsider");
      if (access === "list") return landed(false, "NotApproved");
      if (access === "credential") return landed(false, "CredentialInvalid");
      return landed(true);
    },
    approveAttackers: async () => {
      calls.push("approveAttackers");
      admitted = true;
    },
    attestAttackers: async () => {
      calls.push("attestAttackers");
      admitted = true;
    },
    buyUnderCap: async () => {
      calls.push("buyUnderCap");
      return admitted ? landed(true) : landed(false, "CredentialInvalid");
    },
    sellAsSeededBuyer: async () => {
      calls.push("sellAsSeededBuyer");
      return landed(true);
    },
    revokeAndSell: async () => {
      calls.push("revokeAndSell");
      return landed(true);
    },
    sellAsAttested: async () => {
      calls.push("sellAsAttested");
      return landed(true);
    },
    ...overrides,
  };
  return { chain, calls };
}

const open = { canBuy: true, shut: "shut" };

describe("the access rows per mode", () => {
  it("open: no record is refused, and the list row says there is no list", async () => {
    const { chain, calls } = fakeChain("open");
    const rows = await accessRows("open", chain, open);
    expect(rows.map((row) => [row.attack, row.expected, row.verdict])).toEqual([
      ["buy with no buyer record", "BuyerRecordMissing", "refused"],
      ["buy while not on the approved list", "NotApproved", "skipped"],
    ]);
    expect(calls).toEqual(["buyWithoutRecord"]);
    expect(summarise(rows).deviations).toBe(0);
  });

  it("list: an unapproved wallet is refused NotApproved before the attackers are approved", async () => {
    const { chain, calls } = fakeChain("list");
    const rows = await accessRows("list", chain, open);
    expect(rows.map((row) => [row.attack, row.expected, row.actual])).toEqual([
      ["buy with no buyer record", "BuyerRecordMissing", "BuyerRecordMissing"],
      ["buy while not on the approved list", "NotApproved", "NotApproved"],
    ]);
    expect(calls).toEqual(["buyWithoutRecord", "buyAsOutsider", "approveAttackers"]);
  });

  it("credential: unattested is refused by the program's error, then an attested wallet buys under the cap", async () => {
    const { chain, calls } = fakeChain("credential");
    const rows = await accessRows("credential", chain, open);
    expect(rows.map((row) => [row.attack, row.invariant, row.expected, row.actual])).toEqual([
      ["buy with no buyer record", "C2", "BuyerRecordMissing", "BuyerRecordMissing"],
      [
        "buy with no attestation from the sale's verifier",
        "C2",
        "CredentialInvalid",
        "CredentialInvalid",
      ],
      ["an attested wallet buys under the cap", "C3", "it goes through", "it goes through"],
    ]);
    expect(calls).toEqual(["buyWithoutRecord", "buyAsOutsider", "attestAttackers", "buyUnderCap"]);
    expect(calls).not.toContain("approveAttackers");
    expect(summarise(rows).deviations).toBe(0);
  });

  it("credential: an unattested buy that goes through is a deviation", async () => {
    const { chain } = fakeChain("credential", { buyAsOutsider: async () => landed(true) });
    const rows = await accessRows("credential", chain, open);
    expect(rows[1]?.actual).toBe("it went through");
    expect(summarise(rows).deviations).toBe(1);
  });

  it("credential: a refusal that is not Pangu's is never read as the rule working", async () => {
    const { chain } = fakeChain("credential", { buyAsOutsider: async () => landed(false, null) });
    const rows = await accessRows("credential", chain, open);
    expect(rows[1]?.actual).toMatch(/not by Pangu/);
    expect(summarise(rows).deviations).toBe(1);
  });

  it("credential: a verifier this run cannot sign for skips the buy and attests nobody", async () => {
    const { chain, calls } = fakeChain("credential");
    const rows = await accessRows("credential", chain, {
      canBuy: false,
      shut: "shut",
      cannotAttest: "someone else's verifier",
    });
    expect(rows[2]).toMatchObject({ verdict: "skipped", actual: "someone else's verifier" });
    expect(calls).not.toContain("attestAttackers");
    expect(calls).not.toContain("buyUnderCap");
  });

  it("credential: a band that shuts every buy skips the under-cap buy after attesting", async () => {
    const { chain, calls } = fakeChain("credential");
    const rows = await accessRows("credential", chain, { canBuy: false, shut: "price is stale" });
    expect(rows[2]).toMatchObject({ verdict: "skipped", actual: "price is stale" });
    expect(calls).toContain("attestAttackers");
    expect(calls).not.toContain("buyUnderCap");
  });
});

describe("the exit row per mode", () => {
  it("each mode sells back its own way, and every one must go through", async () => {
    const expected: Record<SaleAccess, [string, string]> = {
      open: ["a seeded buyer sells part of it back to the pool", "sellAsSeededBuyer"],
      list: ["a revoked wallet sells back to the pool", "revokeAndSell"],
      credential: ["an attested wallet sells back to the pool", "sellAsAttested"],
    };
    for (const access of ["open", "list", "credential"] as const) {
      const { chain, calls } = fakeChain(access);
      const row = await exitRow(access, chain, "shut");
      expect(row).toMatchObject({
        attack: expected[access][0],
        invariant: "C5",
        expected: "it goes through",
        verdict: "allowed",
      });
      expect(calls).toEqual([expected[access][1]]);
    }
  });

  it("a refused sell is a deviation, and nobody holding anything is a skip", async () => {
    const refused = fakeChain("credential", {
      sellAsAttested: async () => landed(false, "CredentialInvalid"),
    });
    const row = await exitRow("credential", refused.chain, "shut");
    expect(row.actual).toBe("refused with CredentialInvalid");
    expect(summarise([row]).deviations).toBe(1);

    const empty = fakeChain("credential", { sellAsAttested: async () => null });
    expect(await exitRow("credential", empty.chain, "nothing held")).toMatchObject({
      verdict: "skipped",
      actual: "nothing held",
    });
  });
});
