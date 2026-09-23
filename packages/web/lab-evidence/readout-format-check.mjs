/**
 * Asserts the rules numbers are written by on the readout and the break panel,
 * and exits non-zero on the first one that does not hold.
 *
 *   node lab-evidence/readout-format-check.mjs
 *
 * The web package has no test runner, so this imports the two TypeScript files
 * directly: Node 22.18 and later strip the types on load.
 */

import { importApp } from "./app-imports.mjs";

const { tokenAmount } = await importApp("lib/format.ts");
const { clock, money, percent, shares } = await importApp("components/readout/format.ts");

let failed = 0;
let passed = 0;

function expect(label, actual, wanted) {
  if (actual === wanted) {
    passed += 1;
    console.log(`ok    ${label}: ${actual}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}: got "${actual}", wanted "${wanted}"`);
  }
}

// Raw token units, six decimals like the demo shares.
expect("tokenAmount zero", tokenAmount(0n, 6), "0");
expect("tokenAmount a sliver is never zero", tokenAmount(1n, 6), "under 0.0001");
expect("tokenAmount 0.0001", tokenAmount(100n, 6), "0.0001");
expect("tokenAmount half a share", tokenAmount(500_000n, 6), "0.5");
expect("tokenAmount four places below one", tokenAmount(123_456n, 6), "0.1234");
expect("tokenAmount two places from one", tokenAmount(1_500_000n, 6), "1.5");
expect("tokenAmount two places up to 1000", tokenAmount(999_999_999n, 6), "999.99");
expect("tokenAmount exactly 1000", tokenAmount(1_000_000_000n, 6), "1,000");
expect("tokenAmount rounds down above 1000", tokenAmount(1_000_400_000n, 6), "1,000");
expect("tokenAmount rounds up above 1000", tokenAmount(1_234_567_890n, 6), "1,235");
expect("tokenAmount no decimals", tokenAmount(5n, 0), "5");
expect("tokenAmount a negative sliver", tokenAmount(-1n, 6), "just below 0");

// Share counts on the readout.
expect("shares zero", shares(0), "0");
expect("shares a sliver is never zero", shares(0.00005), "under 0.0001");
expect("shares half a share", shares(0.5), "0.5");
expect("shares four places below one", shares(0.12345), "0.1234");
expect("shares never rounds up to one", shares(0.99999), "0.9999");
expect("shares two places from one", shares(12.345), "12.34");
expect("shares exactly 1000 keeps its form", shares(1000), "1,000");
expect("shares whole above 1000", shares(1000.4), "1,000");
expect("shares rounds above 1000", shares(1234.6), "1,235");
expect("shares compact from 100k", shares(250_000), "250K");

// Money.
expect("dollars under a cent", money(0.004, "dollars"), "under $0.01");
expect("dollars zero", money(0, "dollars"), "$0.00");
expect("dollars one cent", money(0.01, "dollars"), "$0.01");
expect("dollars a price", money(212.5, "dollars"), "$212.50");
expect("SOL keeps significant digits", money(0.00000123, "SOL"), "0.0000012 SOL");
expect("SOL zero", money(0, "SOL"), "0 SOL");

// Percentages are never clamped.
expect("percent half", percent(0.5), "50.0%");
expect("percent past 100", percent(1.25), "125.0%");
expect("percent exactly 100", percent(1), "100.0%");

// The quiet line's times, always UTC and labelled.
const at = Date.UTC(2026, 8, 23, 14, 5);
expect("clock same day", clock(at), "14:05 UTC");
expect("clock same day as the reading", clock(at, Date.UTC(2026, 8, 23, 23, 59)), "14:05 UTC");
expect("clock another day names it", clock(at, Date.UTC(2026, 8, 24, 0, 1)), "23 Sep 14:05 UTC");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
