// Turning a failed transaction's logs into a refusal a buyer can read.
//
// Not covered: errors the program never raises. Anchor's own account checks and
// the token program's errors come back as null on purpose, so the caller shows
// the raw message instead of a wrong sentence.

import { describe, expect, it } from "vitest";
import {
  explainPanguError,
  panguErrorFromLogs,
  PANGU_ERRORS,
  PANGU_PROGRAM_ID,
} from "../src/index.js";

const PANGU = PANGU_PROGRAM_ID.toBase58();
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const DBC = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const ASSOCIATED_TOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/**
 * A first buy through DBC, as the runtime prints it: the buyer record is opened
 * by Pangu first, then DBC swaps and Token-2022 calls Pangu's hook. `ending` is
 * whatever happens once the hook has run.
 */
function firstBuyLogs(ending: string[]): string[] {
  return [
    `Program ${ASSOCIATED_TOKEN} invoke [1]`,
    "Program log: CreateIdempotent",
    `Program ${ASSOCIATED_TOKEN} success`,
    `Program ${PANGU} invoke [1]`,
    "Program log: Instruction: OpenBuyerRecord",
    `Program ${PANGU} consumed 9120 of 400000 compute units`,
    `Program ${PANGU} success`,
    `Program ${DBC} invoke [1]`,
    "Program log: Instruction: Swap2",
    `Program ${TOKEN_2022} invoke [2]`,
    "Program log: Instruction: TransferChecked",
    `Program ${PANGU} invoke [3]`,
    "Program log: Instruction: Execute",
    ...ending,
  ];
}

/** DBC refusing the swap after the hook let the tokens through. */
function dbcRefusal(code: number, name: string, message: string): string[] {
  return firstBuyLogs([
    `Program ${PANGU} consumed 21000 of 350000 compute units`,
    `Program ${PANGU} success`,
    `Program ${TOKEN_2022} consumed 30000 of 360000 compute units`,
    `Program ${TOKEN_2022} success`,
    `Program log: AnchorError occurred. Error Code: ${name}. Error Number: ${code}. Error Message: ${message}.`,
    `Program ${DBC} consumed 90000 of 390000 compute units`,
    `Program ${DBC} failed: custom program error: 0x${code.toString(16)}`,
  ]);
}

/** The lines a failing buy really leaves behind: the token program calls Pangu. */
function buyLogs(name: string, code: number, message: string): string[] {
  return [
    `Program ${TOKEN_2022} invoke [1]`,
    "Program log: Instruction: TransferChecked",
    `Program ${PANGU} invoke [2]`,
    "Program log: Instruction: Execute",
    `Program log: AnchorError occurred. Error Code: ${name}. Error Number: ${code}. Error Message: ${message}.`,
    `Program ${PANGU} consumed 24310 of 194000 compute units`,
    `Program ${PANGU} failed: custom program error: 0x${code.toString(16)}`,
    `Program ${TOKEN_2022} failed: custom program error: 0x${code.toString(16)}`,
  ];
}

const tested = [
  "OverCap",
  "NotApproved",
  "PriceOutsideBand",
  "PriceTooUncertain",
  "ReceivingAccountOwnerCanChange",
] as const;

describe("reading a refusal out of the logs", () => {
  for (const name of tested) {
    const expected = PANGU_ERRORS.find((error) => error.name === name);

    it(`finds ${name} in a captured Anchor log`, () => {
      const found = panguErrorFromLogs(
        buyLogs(name, expected!.code, expected!.message)
      );
      expect(found?.name).toBe(name);
      expect(found?.code).toBe(expected!.code);
      expect(found?.message).toBe(expected!.message);
    });

    it(`finds ${name} from the raw code alone`, () => {
      const hex = `0x${expected!.code.toString(16)}`;
      expect(panguErrorFromLogs([`custom program error: ${hex}`])?.name).toBe(name);
      expect(
        panguErrorFromLogs([
          `Program ${PANGU} invoke [1]`,
          `Program ${PANGU} failed: custom program error: ${hex}`,
        ])?.name
      ).toBe(name);
    });
  }

  it("reads the error number when the name is not printed", () => {
    expect(
      panguErrorFromLogs(["Program log: Error Number: 6009. Error Message: nope."])
        ?.name
    ).toBe("OverCap");
  });

  it("does not name DBC's slippage refusal as Pangu's WrongMint on a first buy", () => {
    const logs = dbcRefusal(6002, "ExceededSlippage", "Exceeded slippage tolerance");
    expect(PANGU_ERRORS.find((error) => error.code === 6002)?.name).toBe("WrongMint");
    expect(panguErrorFromLogs(logs)).toBeNull();
  });

  it("does not name DBC's code 6012 as Pangu's PriceOutsideBand on a first buy", () => {
    const logs = dbcRefusal(6012, "NotEnoughLiquidity", "Not enough liquidity");
    expect(PANGU_ERRORS.find((error) => error.code === 6012)?.name).toBe("PriceOutsideBand");
    expect(panguErrorFromLogs(logs)).toBeNull();
  });

  it("still names Pangu's own refusal inside a DBC swap on a first buy", () => {
    const overCap = PANGU_ERRORS.find((error) => error.name === "OverCap")!;
    const hex = `0x${overCap.code.toString(16)}`;
    const logs = firstBuyLogs([
      `Program log: AnchorError occurred. Error Code: OverCap. Error Number: ${overCap.code}. Error Message: ${overCap.message}.`,
      `Program ${PANGU} consumed 24310 of 350000 compute units`,
      `Program ${PANGU} failed: custom program error: ${hex}`,
      `Program ${TOKEN_2022} consumed 33000 of 360000 compute units`,
      `Program ${TOKEN_2022} failed: custom program error: ${hex}`,
      `Program ${DBC} consumed 95000 of 390000 compute units`,
      `Program ${DBC} failed: custom program error: ${hex}`,
    ]);
    expect(panguErrorFromLogs(logs)?.name).toBe("OverCap");
  });

  it("does not blame Pangu for another program's error code", () => {
    expect(
      panguErrorFromLogs([
        `Program ${TOKEN_2022} invoke [1]`,
        `Program ${TOKEN_2022} failed: custom program error: 0x177b`,
      ])
    ).toBeNull();
  });

  it("returns null for logs that carry no refusal of Pangu's", () => {
    expect(panguErrorFromLogs([])).toBeNull();
    expect(
      panguErrorFromLogs([
        `Program ${PANGU} invoke [1]`,
        "Program log: AnchorError caused by account: rules. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized.",
        `Program ${PANGU} failed: custom program error: 0xbc4`,
      ])
    ).toBeNull();
    expect(panguErrorFromLogs(undefined as unknown as string[])).toBeNull();
  });
});

describe("explaining a refusal", () => {
  it("has a sentence for every error in the IDL", () => {
    const missing = PANGU_ERRORS.filter(
      (error) => explainPanguError(error.name) === explainPanguError("NotAnError")
    );
    expect(missing.map((error) => error.name)).toEqual([]);
    expect(PANGU_ERRORS.length).toBe(33);
  });

  it("tells an issuer what to change for each refusal at creation", () => {
    expect(explainPanguError("BandNeedsDollarQuote")).toMatch(/dollar/);
    expect(explainPanguError("IssuerControlsPayingToken")).toMatch(/freeze authority/);
    expect(explainPanguError("CapCoversWholeSale")).toMatch(/below the curve's supply/);
    expect(explainPanguError("EndInThePast")).toMatch(/later than now/);
  });

  it("keeps every older error at the code it always had", () => {
    // The four new refusals were added at the end, so a code the app already
    // shows, or a devnet transaction already in history, still means the same.
    const codes = Object.fromEntries(PANGU_ERRORS.map((error) => [error.name, error.code]));
    expect(codes.OverCap).toBe(6009);
    expect(codes.WrongLayoutVersion).toBe(6028);
    expect(codes.BandNeedsDollarQuote).toBe(6029);
    expect(codes.IssuerControlsPayingToken).toBe(6030);
    expect(codes.CapCoversWholeSale).toBe(6031);
    expect(codes.EndInThePast).toBe(6032);
  });

  it("says what a buyer should do about the two they will actually hit", () => {
    expect(explainPanguError("OverCap")).toBe(
      "This purchase would take your wallet past the limit for this sale."
    );
    expect(explainPanguError("BuyerRecordMissing")).toMatch(/Open one first/);
  });

  it("does not guess at an error that is not Pangu's", () => {
    expect(explainPanguError("AccountNotInitialized")).toMatch(
      /did not come from this sale's rules/
    );
  });
});
