import { PANGU_IDL, PANGU_PROGRAM_ID } from "./constants.js";

/** One of the program's own refusals, matched out of a transaction's logs. */
export interface PanguError {
  code: number;
  name: PanguErrorName;
  /** The program's own message, as written in the IDL. */
  message: string;
}

interface IdlError {
  code: number;
  name: string;
  msg?: string;
}

const idlErrors = (PANGU_IDL as unknown as { errors?: IdlError[] }).errors ?? [];

/**
 * Every error the program can return, read straight out of the IDL so a new one
 * cannot be missed here.
 */
export const PANGU_ERRORS: readonly PanguError[] = Object.freeze(
  idlErrors.map((error) => ({
    code: error.code,
    name: error.name as PanguErrorName,
    message: error.msg ?? error.name,
  }))
);

const byCode = new Map(PANGU_ERRORS.map((error) => [error.code, error]));
const byName = new Map(PANGU_ERRORS.map((error) => [error.name as string, error]));

const PANGU = PANGU_PROGRAM_ID.toBase58();

const INVOKE = /^Program (\S+) invoke \[\d+\]$/;
const SUCCESS = /^Program (\S+) success$/;
const FAILED = /^Program (\S+) failed: (.*)$/;
const ERROR_NAME = /Error Code: ([A-Za-z0-9_]+)/;
const ERROR_NUMBER = /Error Number: (\d+)/;
const CUSTOM = /custom program error: (0x[0-9a-fA-F]+|\d+)/;

function toCode(text: string): number {
  return text.startsWith("0x") || text.startsWith("0X")
    ? Number.parseInt(text.slice(2), 16)
    : Number.parseInt(text, 10);
}

/** The refusal a log line names, by name, then by number, then by bare code. */
function refusalIn(line: string): PanguError | undefined {
  const named = ERROR_NAME.exec(line);
  const byThatName = named === null ? undefined : byName.get(named[1] ?? "");
  if (byThatName !== undefined) {
    return byThatName;
  }
  const numbered = ERROR_NUMBER.exec(line);
  const byThatNumber =
    numbered === null ? undefined : byCode.get(toCode(numbered[1] ?? ""));
  if (byThatNumber !== undefined) {
    return byThatNumber;
  }
  const custom = CUSTOM.exec(line);
  return custom === null ? undefined : byCode.get(toCode(custom[1] ?? ""));
}

/**
 * Finds Pangu's own refusal in a transaction's logs.
 *
 * Covers the two shapes a refusal arrives in: the Anchor line that names the
 * error, and the bare code the runtime prints when the program fails.
 *
 * A code only means something next to the program that raised it: DBC's 6002
 * is its slippage refusal, and Pangu's 6002 is WrongMint. So the lines are
 * walked as the runtime prints them, each "invoke" opening a frame and each
 * "success" or "failed" closing one, and the first "failed" names the program
 * the transaction really stopped in. The runtime aborts on the innermost
 * failure, so every later "failed" is only a caller passing it up. A refusal is
 * Pangu's only when that program is Pangu, and only lines printed inside
 * Pangu's own frame are read for its name. Pangu having run earlier in the same
 * transaction, which it does on every first buy when it opens the buyer
 * record, counts for nothing.
 *
 * A fragment that names no program at all is read as Pangu's, because there is
 * nobody else it could belong to.
 *
 * Does not cover: errors Pangu never raises, such as Anchor's own account checks
 * or the token program's, and logs cut short before the failing line when the
 * frame that failed is not Pangu's. Those come back as null and the caller should
 * show the raw message.
 */
export function panguErrorFromLogs(logs: string[]): PanguError | null {
  if (!Array.isArray(logs)) {
    return null;
  }

  const stack: string[] = [];
  let namedProgram = false;
  let failedProgram: string | null = null;
  let failedReason = "";
  // The last refusal printed inside a Pangu frame that has not succeeded.
  let panguSaid: PanguError | undefined;

  for (const entry of logs) {
    if (typeof entry !== "string") {
      continue;
    }
    const line = entry.trim();

    const invoke = INVOKE.exec(line);
    if (invoke !== null) {
      namedProgram = true;
      stack.push(invoke[1] ?? "");
      continue;
    }

    const succeeded = SUCCESS.exec(line);
    if (succeeded !== null) {
      namedProgram = true;
      stack.pop();
      // A Pangu frame that succeeded refused nothing, whatever it logged.
      if (succeeded[1] === PANGU) {
        panguSaid = undefined;
      }
      continue;
    }

    const failed = FAILED.exec(line);
    if (failed !== null) {
      namedProgram = true;
      if (failedProgram === null) {
        failedProgram = failed[1] ?? "";
        failedReason = failed[2] ?? "";
      }
      stack.pop();
      continue;
    }

    const current = stack[stack.length - 1];
    if (current === PANGU || !namedProgram) {
      panguSaid = refusalIn(line) ?? panguSaid;
    }
  }

  if (!namedProgram) {
    return panguSaid ?? null;
  }
  if (failedProgram === null) {
    // Cut short before any frame closed as failed. Only a refusal printed inside
    // Pangu's own frame, still open, can be trusted as Pangu's.
    return stack.includes(PANGU) ? panguSaid ?? null : null;
  }
  if (failedProgram !== PANGU) {
    return null;
  }
  const custom = CUSTOM.exec(failedReason);
  const byFailedCode =
    custom === null ? undefined : byCode.get(toCode(custom[1] ?? ""));
  return byFailedCode ?? panguSaid ?? null;
}

/**
 * One sentence a buyer can read for each refusal.
 *
 * Every name in the IDL has an entry. A name that is not Pangu's gets a sentence
 * that says so, rather than a guess.
 */
const EXPLANATIONS = {
  NotTransferring:
    "This token only moves through a real transfer, and this was not one.",
  ReceivingAccountOwnerCanChange:
    "The account you are buying into could be handed to someone else later, so the sale will not send tokens to it. Use your normal token account for this token.",
  WrongMint: "That account belongs to a different token than this sale.",
  WrongBuyerRecord:
    "The buyer record sent with this transfer belongs to another wallet.",
  BuyerRecordMissing:
    "This wallet has no record in the sale yet. Open one first, then buy.",
  NotApproved: "The issuer has not approved this wallet to buy in this sale.",
  CredentialInvalid:
    "This wallet does not carry a valid approval from the verifier this sale trusts.",
  CredentialExpired: "The verifier's approval for this wallet has run out.",
  CredentialSignerNotAuthorized:
    "The key that signed this wallet's approval is no longer allowed to sign for that verifier.",
  OverCap: "This purchase would take your wallet past the limit for this sale.",
  WalletToWalletDuringSale:
    "This token cannot be sent from one wallet to another while the sale is running.",
  PriceStale:
    "The stock price this sale checks against is too old to use. Refresh it and try again. Outside market hours there is no fresh price to get, so the sale stays shut until the market opens.",
  PriceOutsideBand:
    "This purchase would push the price too far above the real stock price.",
  WrongPriceAccount:
    "The price account sent with this transfer is not the one this sale names.",
  PriceNotFullyVerified:
    "The price update has not been signed by two thirds of Pyth's guardians, and this sale will not price against a half signed number.",
  PriceTooUncertain:
    "Pyth's own publishers disagree about this stock's price by more than this sale allows, so there is no ceiling worth measuring against right now.",
  NotPoolCreator: "Only the wallet that created the pool can open its sale.",
  NotAHookPool:
    "That account is not a Meteora bonding curve pool of the kind Pangu works with.",
  HookProgramMismatch:
    "This token does not name Pangu as its transfer hook, so Pangu cannot hold its rules.",
  MintAuthorityStillSet:
    "This token can still be minted, so Pangu will not open a sale on it. Launch it with the minting power revoked.",
  WrongLaunchTemplate:
    "That launch template is not the one this pool was opened on.",
  FeesNotInQuoteToken:
    "This sale's template collects fees in the sale token, and Pangu only accepts templates that collect them in the paying token.",
  ZeroCap: "A sale needs a per-wallet limit above zero.",
  InvalidAccessMode:
    "That access mode does not exist, or the settings do not match the mode chosen.",
  InvalidBand: "The price band settings are incomplete or out of range.",
  SaleStillRunning:
    "The sale is still running and this record still counts tokens, so it cannot be closed yet. Sell them back or wait for the sale to finish.",
  NotIssuer: "Only the issuer of this sale can do that.",
  MathOverflow: "The sale's counters cannot go any higher.",
  WrongLayoutVersion:
    "These sale rules were written by an older build of the program, so this build will not act on them.",
  BandNeedsDollarQuote:
    "A price band compares the curve with a stock price in dollars, so buyers have to pay in a dollar token. Pick a launch template priced in a dollar stablecoin, or open the sale without a band.",
  IssuerControlsPayingToken:
    "You hold the freeze authority of the token buyers pay in, which would let you stop sellers being paid. Pick a paying token whose freeze authority is not yours.",
  CapCoversWholeSale:
    "The per-wallet limit is as large as everything the curve sells, so one wallet could buy the whole sale. Set a limit below the curve's supply.",
  EndInThePast:
    "The end of the offering period has to be later than now. Pick a future time, or leave it at zero for no end.",
} as const;

export type PanguErrorName = keyof typeof EXPLANATIONS;

export function explainPanguError(name: PanguErrorName | string): string {
  const explanation = (EXPLANATIONS as Record<string, string | undefined>)[name];
  return (
    explanation ??
    "The transaction was refused, and the reason did not come from this sale's rules."
  );
}
