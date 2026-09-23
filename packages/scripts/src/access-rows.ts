/**
 * The rows of `prove` that depend on who a sale lets buy, for each of the three
 * access modes, and the one row that proves the exit.
 *
 * The chain is reached only through `AccessChain`, which `prove` implements
 * against devnet, so which rows each mode runs, in what order, and what each
 * one expects can be tested without a network.
 */

import type { AttackReport } from "./attack-table.js";

export type SaleAccess = "open" | "list" | "credential";

/** One transaction a row sent, as the chain answered it. */
export interface Tried {
  succeeded: boolean;
  /** Pangu's own error name when Pangu refused it, otherwise null. */
  refusal: string | null;
  /** The last log line, for a failure that was not Pangu's. */
  lastLine: string;
  signature: string | null;
  link: string | null;
}

export interface AccessChain {
  /** A buy from a wallet that has never touched the sale, with its record opening taken out. */
  buyWithoutRecord(): Promise<Tried>;
  /** The same wallet's buy with the record opening left in: on no list and holding no attestation. */
  buyAsOutsider(): Promise<Tried>;
  /** Puts the attacking wallets on the issuer's list. List mode only. */
  approveAttackers(): Promise<void>;
  /** Has the sale's verifier attest the attacking wallets. Credential mode only. */
  attestAttackers(): Promise<void>;
  /** A small buy by an admitted attacking wallet, well under its cap. */
  buyUnderCap(): Promise<Tried>;
  /** A wallet `seed` bought with sells part of it back, or null when none holds anything. */
  sellAsSeededBuyer(): Promise<Tried | null>;
  /** The filled wallet loses its approval and sells part back, or null when it holds nothing. */
  revokeAndSell(): Promise<Tried | null>;
  /** An attested attacking wallet sells part of what it holds back, or null when none holds anything. */
  sellAsAttested(): Promise<Tried | null>;
}

const GOES_THROUGH = "it goes through";

export function skippedRow(
  attack: string,
  invariant: string,
  expected: string,
  why: string
): AttackReport {
  return { attack, invariant, expected, actual: why, verdict: "skipped", signature: null, link: null };
}

/** A row for something the rules must refuse, judged by Pangu's own error name. */
export function refusedRow(
  attack: string,
  invariant: string,
  expected: string,
  tried: Tried
): AttackReport {
  return {
    attack,
    invariant,
    expected,
    actual: tried.succeeded
      ? "it went through"
      : (tried.refusal ?? `refused, but not by Pangu: ${tried.lastLine}`),
    verdict: tried.succeeded ? "allowed" : "refused",
    signature: tried.signature,
    link: tried.link,
  };
}

/** A row for something the rules promise will work. */
export function passedRow(attack: string, invariant: string, tried: Tried): AttackReport {
  return {
    attack,
    invariant,
    expected: GOES_THROUGH,
    actual: tried.succeeded ? GOES_THROUGH : `refused with ${tried.refusal ?? tried.lastLine}`,
    verdict: tried.succeeded ? "allowed" : "refused",
    signature: tried.signature,
    link: tried.link,
  };
}

export interface AccessOptions {
  /** False when the band shuts every buy right now, or no attacking wallet can be admitted. */
  canBuy: boolean;
  /** Why no buy can land, for the rows that need one. */
  shut: string;
  /** Credential mode only: why this run cannot attest a wallet, or null when it can. */
  cannotAttest?: string | null;
}

/**
 * The access rows, in the order they run, with the setup each mode needs in
 * between: the list is filled after the refusal it has to show, and so are the
 * attestations.
 */
export async function accessRows(
  access: SaleAccess,
  chain: AccessChain,
  options: AccessOptions
): Promise<AttackReport[]> {
  const rows: AttackReport[] = [
    refusedRow("buy with no buyer record", "C2", "BuyerRecordMissing", await chain.buyWithoutRecord()),
  ];

  if (access === "open") {
    rows.push(
      skippedRow(
        "buy while not on the approved list",
        "C6",
        "NotApproved",
        "this sale has open access, so there is no list to be left off"
      )
    );
    return rows;
  }

  if (access === "list") {
    rows.push(
      refusedRow("buy while not on the approved list", "C6", "NotApproved", await chain.buyAsOutsider())
    );
    await chain.approveAttackers();
    return rows;
  }

  // The hook finds no attestation at the one address it derives for this
  // wallet, and an account the attestation service does not own is refused as
  // CredentialInvalid before anything in it is read.
  rows.push(
    refusedRow(
      "buy with no attestation from the sale's verifier",
      "C2",
      "CredentialInvalid",
      await chain.buyAsOutsider()
    )
  );
  const underCap = "an attested wallet buys under the cap";
  if (options.cannotAttest !== undefined && options.cannotAttest !== null) {
    rows.push(skippedRow(underCap, "C3", GOES_THROUGH, options.cannotAttest));
    return rows;
  }
  await chain.attestAttackers();
  rows.push(
    options.canBuy
      ? passedRow(underCap, "C3", await chain.buyUnderCap())
      : skippedRow(underCap, "C3", GOES_THROUGH, options.shut)
  );
  return rows;
}

/** The exit row: somebody holding the sale token sells part of it back to the pool. */
export async function exitRow(
  access: SaleAccess,
  chain: AccessChain,
  shut: string
): Promise<AttackReport> {
  if (access === "open") {
    // Open access has no approval to revoke, so the exit is proven with one of
    // the wallets that seeded this sale.
    const attack = "a seeded buyer sells part of it back to the pool";
    const tried = await chain.sellAsSeededBuyer();
    return tried === null
      ? skippedRow(attack, "C5", GOES_THROUGH, "no seeded wallet is holding anything to sell")
      : passedRow(attack, "C5", tried);
  }
  if (access === "list") {
    const attack = "a revoked wallet sells back to the pool";
    const tried = await chain.revokeAndSell();
    return tried === null ? skippedRow(attack, "C5", GOES_THROUGH, shut) : passedRow(attack, "C5", tried);
  }
  const attack = "an attested wallet sells back to the pool";
  const tried = await chain.sellAsAttested();
  return tried === null ? skippedRow(attack, "C5", GOES_THROUGH, shut) : passedRow(attack, "C5", tried);
}
