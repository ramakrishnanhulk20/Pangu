/**
 * Holds lib/launch-curve.ts against the three curves the terminal launch opened
 * on devnet, and exits non-zero on the first number that does not match.
 *
 *   node lab-evidence/launch-curve-check.mjs
 *
 * For each shape it checks three things. The opening price the page computes is
 * the one the terminal printed at launch (docs/measurements/devnet-run.md; the
 * PLIST launch's price line was not kept, so that row is held to the chain
 * only). Meteora's builder, run here, makes the same curve the chain holds:
 * the same start price and the same number of tokens on the curve. And the cap
 * the page would show is the cap sales.json recorded off the chain.
 *
 * It reads three launch templates from devnet and sends nothing. Node 22.18 and
 * later strip the types off the TypeScript file on load.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { capFromShare } from "pangu-sdk/dbc";

import {
  builtCurve,
  graduationPrice,
  openingPrice,
  priceAtShare,
  shareSoldAtPrice,
} from "../lib/launch-curve.ts";

const RPC = process.env.NEXT_PUBLIC_DEVNET_RPC_URL || "https://api.devnet.solana.com";
const client = new DynamicBondingCurveClient(new Connection(RPC, "confirmed"), "confirmed");

let failed = 0;
let passed = 0;

function expect(label, actual, wanted) {
  if (actual === wanted) {
    passed += 1;
    console.log(`ok    ${label}: ${actual}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}: got ${actual}, wanted ${wanted}`);
  }
}

function near(label, actual, wanted, tolerance) {
  const ok = Math.abs(actual - wanted) <= tolerance;
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
  }
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}: ${actual} against ${wanted}, within ${tolerance}`);
}

// The flags each launch was run with, from sales.json and devnet-run.md.
const LAUNCHES = [
  {
    symbol: "PLIST",
    flags: "--mode list --cap-share-bps 1000",
    config: "HLQMKN3jKvCVjUxi3pvCYPiFpUXRFRQCy7XdcL2oHgMs",
    shape: { quoteDecimals: 9, baseDecimals: 6, supply: 1_000_000_000, migrationPercent: 20, threshold: 0.1 },
    printed: null,
    cap: "79999967072171",
  },
  {
    symbol: "PBAND2",
    flags: "--supply 20 --threshold 3710 --migration-percent 45 --base-decimals 9, paid in the demo dollar",
    config: "62bUtSuLDFJu3fvoeGJqZtpCAEKHBDfwgSSsNWoqxYhb",
    shape: { quoteDecimals: 6, baseDecimals: 9, supply: 20, migrationPercent: 45, threshold: 3710 },
    printed: 275.95041322314046,
    cap: "1099999999",
  },
  {
    symbol: "PAAPLX",
    flags: "--supply 20 --threshold 3710 --migration-percent 45 --base-decimals 9, paid in the demo dollar",
    config: "HprPCqAneB8YphVPz2gNkzgNinuvGxBA7oqwer9PQyTJ",
    shape: { quoteDecimals: 6, baseDecimals: 9, supply: 20, migrationPercent: 45, threshold: 3710 },
    printed: 275.95041322314046,
    cap: "1099999999",
  },
];

for (const launch of LAUNCHES) {
  console.log("");
  console.log(`${launch.symbol}: ${launch.flags}`);
  const price = openingPrice(launch.shape);
  if (launch.printed === null) {
    console.log(`note  the terminal's price line for this launch was not kept; the page computes ${price}`);
  } else {
    expect(`${launch.symbol} opening price, page against what the launch printed`, price, launch.printed);
  }

  const built = builtCurve(launch.shape);
  const onChain = await client.state.getPoolConfig(new PublicKey(launch.config));
  if (onChain === null) {
    failed += 1;
    console.log(`FAIL  ${launch.symbol} template ${launch.config} did not read from devnet`);
    continue;
  }
  expect(
    `${launch.symbol} tokens on the curve, built here against the template on devnet`,
    built.swapBaseAmount.toString(),
    onChain.swapBaseAmount.toString()
  );
  const chainSqrt = Number(BigInt(onChain.sqrtStartPrice.toString())) / 2 ** 64;
  const chainPrice =
    chainSqrt * chainSqrt * 10 ** (launch.shape.baseDecimals - launch.shape.quoteDecimals);
  near(
    `${launch.symbol} opening price, builder's rounding against the template on devnet`,
    built.openingPrice,
    chainPrice,
    chainPrice * 1e-12
  );
  near(
    `${launch.symbol} opening price, the page's formula against the template on devnet`,
    price,
    chainPrice,
    chainPrice * 1e-6
  );
  expect(
    `${launch.symbol} cap at 10 percent, page against sales.json`,
    capFromShare(built.swapBaseAmount, 1000).toString(),
    launch.cap
  );
}

// The same anchors packages/scripts/test/curve.test.ts holds the terminal to.
console.log("");
const BILLION = { quoteDecimals: 6, baseDecimals: 9, supply: 1_000_000_000, migrationPercent: 40, threshold: 360_000_000_000 };
const TWENTY = { ...BILLION, supply: 20, migrationPercent: 45, threshold: 3_710 };
near("billion share curve opens at 400", openingPrice(BILLION), 400, 1e-6);
near("billion share curve ends at 900", graduationPrice(BILLION), 900, 1e-6);
near("a 362.25 ceiling bites 70 percent into the twenty share curve", shareSoldAtPrice(TWENTY, 362.25), 0.7, 0.005);
expect("a ceiling under the opening price is below zero", shareSoldAtPrice(BILLION, 362.25) < 0, true);
near("the drawing's price at a share inverts shareSoldAtPrice", priceAtShare(TWENTY, shareSoldAtPrice(TWENTY, 362.25)), 362.25, 1e-9);
near("the drawing ends at the graduation price", priceAtShare(TWENTY, 1), graduationPrice(TWENTY), 1e-9);

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
