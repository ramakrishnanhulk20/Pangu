import { ACCESS_MODE } from "pangu-sdk";

import { timeUntil, utcMoment } from "@/components/readout/format";
import type { DirectorySale } from "@/lib/directory";
import { feedWords } from "@/lib/feeds";
import { CHAIN } from "@/lib/network";

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

const DAY_MS = 86_400_000;

/** When an offering ends, to the minute, how long is left, and the warning a short one carries. */
export interface OfferingEnd {
  /** "24 Sep 2026, 09:12 UTC". */
  at: string;
  /** "13 minutes left". Null once the end has passed, or while the visitor's clock is unknown. */
  left: string | null;
  /** Set when the whole offering lasts under a day and has not ended yet. */
  short: string | null;
}

/**
 * The end of an offering in words. An offering's whole length is its end less
 * the sale's creation, or less now when the creation is not known: under 24
 * hours in total, the rules that protect a buyer are gone almost at once, so
 * the page says so wherever a buy is offered.
 *
 * `endsAt` is unix seconds, `openedAt` and `now` unix milliseconds.
 */
export function offeringEnd(endsAt: number, openedAt: number | null, now: number | null): OfferingEnd {
  const ends = endsAt * 1000;
  const at = utcMoment(ends);
  const start = openedAt ?? now;
  const notOver = now === null || ends > now;
  return {
    at,
    left: now !== null && ends > now ? `${timeUntil(ends, now)} left` : null,
    short:
      notOver && start !== null && ends - start < DAY_MS
        ? `Short offering: at ${at} every rule lifts and anyone can buy without a cap.`
        : null,
  };
}

/**
 * The state as one word, the line under it, and the short-offering warning
 * when there is one. `now` is unix milliseconds, or null when not yet known.
 */
export function stateWords(
  sale: DirectorySale,
  now: number | null
): { word: string; detail: string; short: string | null } {
  const end = sale.endsAt === null ? null : offeringEnd(sale.endsAt, sale.openedAt, now);
  switch (sale.state) {
    case "graduated":
      return {
        word: "Graduated",
        detail:
          sale.dammPool === null
            ? "curve full, move to DAMM v2 not sent yet"
            : "trades freely on DAMM v2",
        short: null,
      };
    case "offering-over":
      return {
        word: "Offering over",
        detail:
          end === null ? "the rules have lifted" : `rules lifted ${end.at}`,
        short: null,
      };
    case "running":
      return {
        word: "Running",
        detail:
          end === null
            ? "no end date"
            : `offering ends ${end.at}${end.left === null ? "" : `, ${end.left}`}`,
        short: end?.short ?? null,
      };
    default:
      return { word: "Unreadable", detail: `${CHAIN.inSentence} did not say where it stands`, short: null };
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
