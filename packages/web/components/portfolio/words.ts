import { ACCESS_MODE } from "pangu-sdk";

import { utcDay } from "@/components/readout/format";
import { CHAIN } from "@/lib/network";
import type { Holding, Total } from "@/lib/portfolio";

/*
 * The words the portfolio puts a wallet's facts in. Every word is chosen from
 * a field the chain holds; nothing here decides a fact.
 */

export type Tone = "accent" | "pending" | "refused" | "muted";

/** Whether the rules let this wallet buy, in one short line and its colour. */
export function accessWords(holding: Holding): { word: string; tone: Tone } {
  if (holding.graduated || holding.offeringOver) {
    return { word: "Rules lifted", tone: "muted" };
  }
  switch (holding.accessMode) {
    case ACCESS_MODE.open:
      return { word: "Open to anyone", tone: "muted" };
    case ACCESS_MODE.issuerList:
      return holding.approved === true
        ? { word: "On the issuer's list", tone: "accent" }
        : { word: "Not on the list", tone: "refused" };
    case ACCESS_MODE.verifierCredential:
      switch (holding.credential) {
        case "valid":
          return { word: "Credential valid", tone: "accent" };
        case "expired":
          return { word: "Credential expired", tone: "refused" };
        case "absent":
          return { word: "No credential", tone: "refused" };
        default:
          return { word: "Credential not read", tone: "pending" };
      }
    default:
      return { word: `Access mode ${holding.accessMode}`, tone: "muted" };
  }
}

/** Why Buy more is not offered, or null when it is. */
export function noBuyReason(holding: Holding): string | null {
  if (holding.graduated) {
    return null;
  }
  if (holding.offeringOver) {
    return null;
  }
  if (holding.state === "unknown") {
    return `${CHAIN.atStart} did not say where this sale stands.`;
  }
  if (BigInt(holding.capRoom) === 0n) {
    return "Your cap is used up. Sell some back to make room.";
  }
  const access = accessWords(holding);
  if (access.tone === "refused") {
    return holding.accessMode === ACCESS_MODE.issuerList
      ? "Ask the issuer to add this wallet to the list."
      : "Ask the sale's verifier for a fresh credential.";
  }
  return null;
}

/** The sale's state and the date under it. */
export function stateLine(sale: {
  state: string;
  endsAt: number | null;
  dammPool: string | null;
}): { word: string; detail: string } {
  switch (sale.state) {
    case "graduated":
      return {
        word: "Graduated",
        detail: sale.dammPool === null ? "move to DAMM v2 not sent yet" : "trades on DAMM v2",
      };
    case "offering-over":
      return {
        word: "Offering over",
        detail: sale.endsAt === null ? "the rules have lifted" : `ended ${utcDay(sale.endsAt * 1000)}`,
      };
    case "running":
      return {
        word: "Running",
        detail: sale.endsAt === null ? "no end date" : `offering ends ${utcDay(sale.endsAt * 1000)}`,
      };
    default:
      return { word: "Unreadable", detail: `${CHAIN.inSentence} did not say where it stands` };
  }
}

/** What a total is counted in: the demo dollar says so, so it is never read as real money. */
export function totalUnit(total: Total): string {
  if (total.money === "SOL") {
    return `in ${CHAIN.sol}`;
  }
  if (total.money !== "dollars") {
    return `in ${total.money}`;
  }
  return total.demoDollar ? "in demo dollars" : "in dollars";
}
