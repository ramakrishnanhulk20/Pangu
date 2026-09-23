/**
 * Proves the price refresh route against devnet.
 *
 *   node lab-evidence/price-refresh-check.mjs
 *
 * It needs a verification server of this app on its own port, never the dev
 * server on 3000, with DEMO_DOLLAR_MINT_AUTHORITY and PYTH_API_KEY set (on this
 * machine both come from the repository root .env). Neither key is read here.
 *
 * The route is called twice in a row for every live sale with a price band.
 * The first call posts a fresh Pyth price when the stored one is over ten
 * minutes old, or says it is fresh, or says the market is closed. The second
 * must not post again: it says fresh, closed, or rate limited.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";

const BASE = process.env.REFRESH_BASE_URL ?? "http://127.0.0.1:3452";
const ROUTE = `${BASE}/api/price/refresh`;
const RPC = "https://api.devnet.solana.com";

const tx = (signature) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const utc = (seconds) => new Date(seconds * 1000).toISOString();

const sales = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "scripts", "sales.json"), "utf8")
).filter((sale) => sale.network === "devnet" && sale.retiredAt === undefined && sale.bandBps !== null);

async function ask(mint, label) {
  const started = Date.now();
  const response = await fetch(ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mint }),
  });
  const body = await response.json();
  console.log("");
  console.log(`${label}: HTTP ${response.status} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(JSON.stringify(body, null, 2));
  if (body.status === "posted") {
    for (const signature of body.signatures) {
      console.log(`signature : ${tx(signature)}`);
    }
    console.log(`published : ${utc(body.publishedAt)}, price ${body.price}`);
  }
  if (body.status === "closed") {
    console.log(`closed    : Pyth's last price was published ${utc(body.lastPublishedAt)}`);
  }
  return { status: response.status, body };
}

/** What the sale's price account holds now, read off devnet by this script, not the route. */
async function stored(priceAccount) {
  const connection = new Connection(RPC, "confirmed");
  const info = await connection.getAccountInfo(new PublicKey(priceAccount), "confirmed");
  if (info === null) {
    return "no account";
  }
  // Full verification is tag 1 at byte 40 and the message starts one byte on;
  // publish time sits 52 bytes into the message. See pangu-sdk decodePriceUpdate.
  const message = 40 + (info.data[40] === 1 ? 1 : 2);
  const published = Number(info.data.readBigInt64LE(message + 52));
  return `${utc(published)}, ${Math.floor(Date.now() / 1000) - published} seconds ago`;
}

console.log(`route     : POST ${ROUTE}`);
let broken = false;
for (const sale of sales) {
  console.log("");
  console.log(`sale      : ${sale.name}, ${sale.mint}`);
  console.log(`account   : ${sale.priceAccount}`);
  console.log(`            https://explorer.solana.com/address/${sale.priceAccount}?cluster=devnet`);
  console.log(`stored    : ${await stored(sale.priceAccount)} (before)`);

  const first = await ask(sale.mint, "first call ");
  const second = await ask(sale.mint, "second call");
  console.log("");
  console.log(`stored    : ${await stored(sale.priceAccount)} (after)`);

  const firstOk = ["posted", "fresh", "closed"].includes(first.body.status);
  const secondOk = ["fresh", "closed", "limited"].includes(second.body.status);
  if (!firstOk || !secondOk) {
    broken = true;
  }
  console.log(
    `verdict   : ${firstOk && secondOk ? "as expected, the second call posted nothing" : "NOT as expected"}`
  );
}

const refused = await fetch(ROUTE, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mint: "So11111111111111111111111111111111111111112" }),
});
console.log("");
console.log(`a mint that is not one of the app's sales: HTTP ${refused.status}`);
console.log(JSON.stringify(await refused.json()));

console.log("");
console.log(`run at ${new Date().toISOString()}`);
process.exit(broken ? 1 : 0);
