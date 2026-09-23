/**
 * The offering sentences' dates and counts, worked out by the readout's own
 * format functions for fixed moments, since every sale on devnet today is a
 * version 1 sale with no end date and only the null sentence shows live.
 *
 *   node lab-evidence/offering-format.mjs
 *
 * Node strips the TypeScript types itself, so the file the page imports is the
 * file run here.
 */

import { importApp } from "./app-imports.mjs";

const { timeUntil, utcDay, utcMoment } = await importApp("components/readout/format.ts");

const endsAt = Date.UTC(2026, 9, 7, 9, 12);
const cases = [
  ["13 days 4 hours before", endsAt - (13 * 1440 + 4 * 60) * 60_000],
  ["13 days exactly before", endsAt - 13 * 1440 * 60_000],
  ["1 day 1 hour before", endsAt - 25 * 60 * 60_000],
  ["4 hours 12 minutes before", endsAt - (4 * 60 + 12) * 60_000],
  ["1 minute before", endsAt - 60_000],
  ["30 seconds before", endsAt - 30_000],
  ["10 seconds after, before the next poll", endsAt + 10_000],
];

console.log(`utcMoment  Offering ends ${utcMoment(endsAt)}`);
console.log(`utcDay     Offering over since ${utcDay(endsAt)}`);
for (const [label, from] of cases) {
  console.log(
    `${label.padEnd(40)} readout "in ${timeUntil(endsAt, from)}"   hero "ends in ${timeUntil(endsAt, from, true)}"`
  );
}
