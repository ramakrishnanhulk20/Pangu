import { PublicKey } from "@solana/web3.js";

/**
 * Thrown before anything is built when an input could never pass on chain.
 *
 * Every message names the rule and the value, because the caller is usually a
 * form in the app and the text goes straight to the person filling it in.
 */
export class PanguInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PanguInputError";
  }
}

export function requirePublicKey(value: unknown, field: string): PublicKey {
  if (!(value instanceof PublicKey)) {
    throw new PanguInputError(`${field} must be a PublicKey`);
  }
  return value;
}

/** A key that is present and is not the all zero address the program reads as "unset". */
export function requireRealPublicKey(value: unknown, field: string): PublicKey {
  const key = requirePublicKey(value, field);
  if (key.equals(PublicKey.default)) {
    throw new PanguInputError(`${field} must not be the all zero address`);
  }
  return key;
}

export function requireAbsent(value: unknown, field: string, reason: string): void {
  if (value !== undefined && value !== null) {
    throw new PanguInputError(`${field} ${reason}`);
  }
}

/** An unsigned whole number inside the range the program's own field can hold. */
export function requireWholeNumber(
  value: unknown,
  field: string,
  low: number,
  high: number
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new PanguInputError(`${field} must be a whole number`);
  }
  if (value < low || value > high) {
    throw new PanguInputError(`${field} must be between ${low} and ${high}, got ${value}`);
  }
  return value;
}

export function requireBigint(value: unknown, field: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value);
  }
  throw new PanguInputError(`${field} must be a bigint`);
}
