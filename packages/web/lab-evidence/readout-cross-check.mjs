/**
 * Every number the readout shows, read again in a separate process straight
 * through pangu-sdk, and the page's own answer for the same sale at the same
 * second beside it.
 *
 *   node lab-evidence/readout-cross-check.mjs http://localhost:3300
 *
 * No browser and no wallet. If a number on the page is not on the chain, the
 * two columns disagree.
 */

import { readFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  curvePriceDollars,
  dollars,
  listBuyerRecords,
  priceCeiling,
  readPrice,
  saleStanding,
} from "pangu-sdk";
import { loadPool, saleProgress } from "pangu-sdk/dbc";

const base = process.argv[2] ?? "http://localhost:3300";
// The public devnet node does not always answer from this machine, so the
// keyed endpoint in the repository root .env is read first when there is one.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No root .env: the endpoints below stand in.
}
const rpc =
  process.env.DEVNET_RPC_URL ??
  process.env.NEXT_PUBLIC_DEVNET_RPC_URL ??
  "https://api.devnet.solana.com";
// The connection from this machine to devnet drops now and then, so a call
// that could not connect is tried again, as offering-check.mjs does.
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

const sales = JSON.parse(
  readFileSync(new URL("../../scripts/sales.json", import.meta.url), "utf8")
).filter((sale) => sale.network === "devnet");

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

function fixed(value, digits) {
  return Number(value).toFixed(digits);
}

// The public devnet endpoint answers 429 when one process asks for about ten
// accounts twice over, so the sales are read one after the other, not at once.
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const [index, opened] of sales.entries()) {
  if (index > 0) {
    await pause(10_000);
  }
  const mint = new PublicKey(opened.mint);
  const view = await loadPool(connection, mint);
  const sale = view.sale;
  const state = view.poolAccount.poolState;

  const quoteDecimals =
    sale.quoteDecimals > 0
      ? sale.quoteDecimals
      : (await connection.getAccountInfo(view.quoteMint)).data[44];
  const sqrtPrice = BigInt(state.sqrtPrice.toString());
  const price = dollars(
    curvePriceDollars(sqrtPrice, sale.baseDecimals, quoteDecimals)
  );

  const records = await listBuyerRecords(connection, mint);
  const standing = saleStanding(sale, records);
  const progress = await saleProgress(connection, mint);
  const unit = opened.quoteMint === WRAPPED_SOL ? "SOL" : "dollars";

  const answer = await fetch(`${base}/api/readout/${opened.mint}`, {
    cache: "no-store",
  });
  const page = await answer.json();

  console.log(`-- ${opened.name}, read at ${new Date().toISOString()} --`);
  console.log(`paid for in            ${unit}`);
  console.log(
    `price on the curve     sdk ${price}   page ${page.priceNow}   (pool sqrtPrice ${sqrtPrice})`
  );
  console.log(
    `raised of threshold    sdk ${Number(progress.quoteRaised) / 10 ** quoteDecimals} of ${
      Number(progress.threshold) / 10 ** quoteDecimals
    }   page ${page.raised} of ${page.threshold}`
  );
  console.log(
    `buyers                 sdk ${standing.buyers}   page ${page.buyers}`
  );
  console.log(
    `largest wallet         sdk ${fixed(standing.largestShare * 100, 2)}% of a ${fixed(
      standing.capShare * 100,
      2
    )}% cap   page ${fixed(page.largestShare * 100, 2)}% of a ${fixed(
      page.capOfSold * 100,
      2
    )}% cap`
  );
  console.log(
    `cap on one wallet      sdk ${Number(sale.cap) / 10 ** sale.baseDecimals} shares   page ${
      page.cap
    } shares, ${fixed(page.capOfSale * 100, 2)}% of the sale`
  );
  console.log(
    `graduated              sdk ${progress.graduated}   page ${page.graduated}`
  );
  console.log(
    `damm v2 pool           sdk ${progress.dammPool?.toBase58() ?? "none yet"}   page ${
      page.dammPool ?? "none yet"
    }`
  );

  if (sale.hasBand) {
    const reading = await readPrice(connection, sale);
    const ceiling =
      reading.price > 0n
        ? dollars(priceCeiling({ bandBps: sale.bandBps }, reading.price))
        : null;
    console.log(
      `apple from pyth        sdk $${fixed(reading.priceDollars, 2)}  usable=${
        reading.usable
      } age=${reading.ageSecs}s   page $${fixed(page.stockDollars, 2)}`
    );
    console.log(
      `buys stop above        sdk $${fixed(ceiling, 2)}   page $${fixed(
        page.ceilingDollars,
        2
      )}`
    );
  }

  console.log(`the binding rule       page: ${page.rule}`);
  console.log(
    `the curve              page: ${page.curve.length} points, ${page.curve[0].price} to ${
      page.curve[page.curve.length - 1].price
    } over ${page.saleSize} shares`
  );
  console.log("");
}
