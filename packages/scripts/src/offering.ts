/**
 * When a sale's offering period ends, as the issuer chooses it at launch.
 *
 * There is no default on purpose. A sale with no end keeps every rule until the
 * curve graduates, and a curve that never fills then holds its buyers for good;
 * a sale with an end lifts every rule at that moment, cap and list included.
 * Both are real choices with a real cost, so `launch` refuses to guess.
 */

import { ArgumentError, amount, type Flags } from "./arguments.js";

export const ENDS_IN_FLAG = "ends-in";
export const NO_END_FLAG = "no-end";

/**
 * The shortest offering a launch will open, in hours. Six minutes leaves room
 * for the template and the sale to land before the end the chain checks
 * against, since create_sale refuses an end that has already passed.
 */
export const MIN_OFFERING_HOURS = 0.1;

/** A year. Anything longer reads as a typo for --no-end. */
export const MAX_OFFERING_HOURS = 8_760;

const SECONDS_PER_HOUR = 3_600;

export type OfferingChoice = { kind: "ends-in"; hours: number } | { kind: "no-end" };

/**
 * Reads the one required choice: `--ends-in <hours>` or `--no-end`.
 *
 * Throws ArgumentError when neither is given, when both are, or when the hours
 * are outside six minutes to a year.
 */
export function offeringChoice(flags: Flags): OfferingChoice {
  const endsIn = flags.has(ENDS_IN_FLAG);
  const noEnd = flags.has(NO_END_FLAG);
  if (endsIn && noEnd) {
    throw new ArgumentError(
      `--${ENDS_IN_FLAG} and --${NO_END_FLAG} were both given, and they disagree. Pick one.`
    );
  }
  if (!endsIn && !noEnd) {
    throw new ArgumentError(
      `say when the offering period ends: --${ENDS_IN_FLAG} <hours> lifts every rule that many hours after launch, --${NO_END_FLAG} keeps them until the curve graduates`
    );
  }
  if (noEnd) {
    return { kind: "no-end" };
  }
  return {
    kind: "ends-in",
    hours: amount(flags, ENDS_IN_FLAG, MIN_OFFERING_HOURS, MAX_OFFERING_HOURS, 0),
  };
}

/**
 * The `ends_at` create_sale takes: unix seconds on the chain's own clock, or
 * zero for no end. Counted from the chain clock rather than this machine's,
 * because the chain is what compares against it.
 */
export function endsAtFrom(choice: OfferingChoice, chainNow: number): number {
  if (choice.kind === "no-end") {
    return 0;
  }
  return Math.floor(chainNow + choice.hours * SECONDS_PER_HOUR);
}

/** How sales.json stores an end: an ISO time, or null for none. */
export function endsAtRecord(endsAt: number | null): string | null {
  return endsAt === null || endsAt === 0 ? null : new Date(endsAt * 1_000).toISOString();
}

/** One line for the launch summary. */
export function describeEnd(endsAt: number | null, choice?: OfferingChoice): string {
  const at = endsAtRecord(endsAt);
  if (at === null) {
    return "no end, every rule holds until the curve graduates";
  }
  const after =
    choice !== undefined && choice.kind === "ends-in"
      ? `, ${choice.hours} hours after the chain clock at launch`
      : "";
  return `${at}${after}; every rule lifts then, cap and access included`;
}
