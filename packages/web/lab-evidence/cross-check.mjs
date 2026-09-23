import { Connection, PublicKey } from "@solana/web3.js";
import { curvePriceDollars, dollars, getSale, listBuyerRecords, priceCeiling, readPrice, saleStanding } from "pangu-sdk";
import { loadPool } from "pangu-sdk/dbc";

// The keyed devnet endpoint lives in the repository root .env. The public one
// stands in when there is none.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No root .env: the public endpoint is used.
}
const c = new Connection(process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const priced = new PublicKey("4vyCQRLeowhSzaZqbPVpdNy7upxVtqaCZdono2z8JeoT");
const listed = new PublicKey("FToBcoyaCZtLpbaGFV8wdomngjwuQp5XShj6fHdzLyGv");

const pool = await loadPool(c, priced);
const sqrt = BigInt(pool.poolAccount.poolState.sqrtPrice.toString());
const price = dollars(curvePriceDollars(sqrt, pool.sale.baseDecimals, pool.sale.quoteDecimals));
const reading = await readPrice(c, pool.sale);
const ceiling = dollars(priceCeiling({ bandBps: pool.sale.bandBps }, reading.price));
const sale = await getSale(c, listed);
const standing = saleStanding(sale, await listBuyerRecords(c, listed));

console.log("curve price      $" + price.toFixed(2) + " a share   (mint 4vyCQRLe..., pool sqrtPrice " + sqrt + ")");
console.log("Apple from Pyth  $" + reading.priceDollars.toFixed(2) + "  usable=" + reading.usable + "  age=" + reading.ageSecs + "s");
console.log("price ceiling    $" + ceiling.toFixed(2) + " a share   (band " + pool.sale.bandBps / 100 + "%)");
console.log("buyers           " + standing.buyers + "   (mint FToBcoya...)");
console.log("largest wallet   " + (standing.largestShare * 100).toFixed(1) + "% of a " + (standing.capShare * 100).toFixed(1) + "% cap");
