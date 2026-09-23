/**
 * The end of every sale's offering period, read three ways side by side: the
 * raw bytes of its rules account at offset 331, pangu-sdk's decoded Sale and
 * standing helper, and, for the sales the page still lists, the page's own
 * readout.
 *
 *   node lab-evidence/offering-check.mjs [http://localhost:3000]
 *
 * The raw read uses nothing from pangu-sdk: the account is fetched by the
 * address the scripts wrote into sales.json and the bytes are read by hand, so
 * a decoder that looked in the wrong place would show up as a disagreement.
 */

import { readFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { getSale, saleStanding } from "pangu-sdk";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No root .env: the public endpoint below answers instead.
}

const base = process.argv[2] ?? null;
const rpc =
  process.env.DEVNET_RPC_URL ??
  process.env.NEXT_PUBLIC_DEVNET_RPC_URL ??
  "https://api.devnet.solana.com";

// The connection from this machine to devnet drops now and then, so a call
// that could not connect is tried again before the check gives up on a sale.
async function patientFetch(input, init) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (attempt >= 8) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}

const connection = new Connection(rpc, { commitment: "confirmed", fetch: patientFetch });

// Byte offsets in the SaleRules account, counted from the start of the
// account, discriminator included. Source: programs/pangu/src/state.rs.
const LAYOUT_VERSION_AT = 298;
const ENDS_AT_AT = 331;

const sales = JSON.parse(
  readFileSync(new URL("../../scripts/sales.json", import.meta.url), "utf8")
).filter((sale) => sale.network === "devnet");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shown(value) {
  return value === null ? "null" : String(value);
}

let mismatches = 0;
const now = Math.floor(Date.now() / 1000);
console.log(`read at ${new Date(now * 1000).toISOString()} (unix ${now})`);
console.log(`endpoint ${new URL(rpc).hostname}`);

for (const [index, opened] of sales.entries()) {
  if (index > 0) {
    await pause(1_500);
  }
  const rules = new PublicKey(opened.rules);
  const account = await connection.getAccountInfo(rules, "confirmed");
  console.log(`\n-- ${opened.symbol} ${opened.name}${opened.retiredAt ? " (retired)" : ""}`);
  console.log(`rules account          ${rules.toBase58()}`);
  if (account === null) {
    console.log("raw                    no account at this address");
    mismatches += 1;
    continue;
  }

  const bytes = account.data;
  const version = bytes[LAYOUT_VERSION_AT];
  const rawEnd = bytes.readBigInt64LE(ENDS_AT_AT);
  // Version 1 kept these bytes as spare zeros, and zero means no end on
  // version 2, so both read as null.
  const rawEndsAt = version >= 2 && rawEnd !== 0n ? Number(rawEnd) : null;
  const rawOver = rawEndsAt !== null && now >= rawEndsAt;

  const sale = await getSale(connection, new PublicKey(opened.mint));
  const sdkEndsAt = sale === null ? "no sale" : sale.endsAt;
  const sdkOver = sale === null ? "no sale" : saleStanding(sale, [], now).offeringOver;

  const hex = bytes.subarray(ENDS_AT_AT, ENDS_AT_AT + 8).toString("hex");
  console.log(`layout version         byte ${LAYOUT_VERSION_AT} = ${version}`);
  console.log(`bytes 331..338         ${hex}`);
  console.log(`ends at                raw ${shown(rawEndsAt)}   sdk ${shown(sdkEndsAt)}`);
  console.log(`offering over          raw ${rawOver}   sdk ${sdkOver}`);
  let agree = rawEndsAt === sdkEndsAt && rawOver === sdkOver;

  if (base !== null && opened.retiredAt === undefined) {
    const answer = await patientFetch(`${base}/api/readout/${opened.mint}`, { cache: "no-store" });
    const page = await answer.json();
    console.log(`page readout           endsAt ${shown(page.endsAt)}   offeringOver ${page.offeringOver}`);
    agree = agree && page.endsAt === rawEndsAt && page.offeringOver === rawOver;
  }

  console.log(agree ? "MATCH" : "MISMATCH");
  if (!agree) {
    mismatches += 1;
  }
}

console.log(`\n${sales.length} sales checked, ${mismatches} mismatches`);
process.exitCode = mismatches === 0 ? 0 : 1;
