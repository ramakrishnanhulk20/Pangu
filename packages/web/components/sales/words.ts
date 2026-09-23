import { ACCESS_MODE } from "pangu-sdk";

import { utcDay } from "@/components/readout/format";
import type { DirectorySale } from "@/lib/directory";
import { feedWords } from "@/lib/feeds";

/*
 * The words the ledger and the sale page put a sale's facts in. Every word is
 * chosen from a field the chain holds; nothing here decides a fact.
 */

/** Who the rules let buy, in the words a buyer uses. */
export function whoMayBuy(accessMode: number): { short: string; long: string } {
  switch (accessMode) {
    case ACCESS_MODE.open:
      return { short: "Anyone", long: "Any wallet may buy." };
    case ACCESS_MODE.issuerList:
      return {
        short: "Issuer's list",
        long: "Only wallets the issuer approved may buy.",
      };
    case ACCESS_MODE.verifierCredential:
      return {
        short: "Verified wallets",
        long: "Only wallets carrying the verifier's credential may buy.",
      };
    default:
      return { short: `Mode ${accessMode}`, long: `Access mode ${accessMode}, which this app does not know.` };
  }
}

/** The state as one word and the line under it. */
export function stateWords(sale: DirectorySale): { word: string; detail: string } {
  switch (sale.state) {
    case "graduated":
      return {
        word: "Graduated",
        detail:
          sale.dammPool === null
            ? "curve full, move to DAMM v2 not sent yet"
            : "trades freely on DAMM v2",
      };
    case "offering-over":
      return {
        word: "Offering over",
        detail:
          sale.endsAt === null ? "the rules have lifted" : `rules lifted ${utcDay(sale.endsAt * 1000)}`,
      };
    case "running":
      return {
        word: "Running",
        detail: sale.endsAt === null ? "no end date" : `offering ends ${utcDay(sale.endsAt * 1000)}`,
      };
    default:
      return { word: "Unreadable", detail: "devnet did not say where it stands" };
  }
}

/** The price ceiling, when the sale has one. */
export function ceilingWords(sale: DirectorySale): string | null {
  if (!sale.hasBand) {
    return null;
  }
  const over = (sale.bandBps / 100).toFixed(sale.bandBps % 100 === 0 ? 0 : 1);
  return `${over}% over ${feedWords(sale.feedId).price}`;
}
