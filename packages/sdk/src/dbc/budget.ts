import { ComputeBudgetProgram, type Transaction, type TransactionInstruction } from "@solana/web3.js";
import { PanguInputError } from "../inputs.js";

/** One Solana transaction, signatures included. */
export const TRANSACTION_SIZE_LIMIT = 1232;

/**
 * The compute limits this package asks for, each set from what the same action
 * really used on a fork of mainnet. The measurements are in
 * docs/measurements/fork-test.md. Roughly double the measured cost, because a
 * banded or credential sale reads more accounts than the plain one that was
 * measured, and running out of compute would look to a buyer like a refusal.
 */
export const COMPUTE_LIMIT = {
  /** Measured: 113,000 to 130,000 units for a buy, 83,000 for a sell. */
  swap: 300_000,
  /** Measured: 55,192 for the partner claim, 51,742 for the creator claim. */
  claim: 150_000,
} as const;

export function computeLimit(units: number): TransactionInstruction {
  return ComputeBudgetProgram.setComputeUnitLimit({ units });
}

/**
 * How many bytes this transaction will take on the wire.
 *
 * `serialize()` throws once a transaction passes the limit, and the point of
 * measuring is to find out whether it does, so the size is worked out from the
 * compiled message instead. The fee payer and a blockhash must already be set.
 */
export function transactionBytes(transaction: Transaction): number {
  const message = transaction.compileMessage();
  return (
    message.serialize().length + 1 + 64 * message.header.numRequiredSignatures
  );
}

/** Refuses a transaction that could never be sent, with the action named. */
export function requireOneTransaction(
  transaction: Transaction,
  action: string
): number {
  const bytes = transactionBytes(transaction);
  if (bytes > TRANSACTION_SIZE_LIMIT) {
    throw new PanguInputError(
      `${action} does not fit in one transaction: ${bytes} bytes against the ${TRANSACTION_SIZE_LIMIT} byte limit`
    );
  }
  return bytes;
}
