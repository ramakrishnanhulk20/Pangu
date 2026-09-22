import { BorshCoder } from "@anchor-lang/core";
import { PANGU_IDL } from "./constants.js";

let cached: BorshCoder | null = null;

/**
 * The borsh coder built from the committed IDL.
 *
 * Built on first use rather than at import, so loading this package on a server
 * costs nothing until something is actually encoded or decoded.
 */
export function panguCoder(): BorshCoder {
  if (cached === null) {
    cached = new BorshCoder(PANGU_IDL);
  }
  return cached;
}
