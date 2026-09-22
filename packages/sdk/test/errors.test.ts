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
  "MarketClosed",
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
    expect(PANGU_ERRORS.length).toBe(30);
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
