import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { curvePriceDollars, dollars, getSale, isSaleRunning, listBuyerRecords, priceCeiling, readPrice, saleStanding, TOKEN_2022_PROGRAM_ID } from "pangu-sdk";
import { loadPool } from "pangu-sdk/dbc";
import sales from "../../scripts/sales.json" with { type: "json" };

const c = new Connection("https://api.devnet.solana.com", "confirmed");
for (const r of sales) {
  const mint = new PublicKey(r.mint);
  const sale = await getSale(c, mint);
  const running = await isSaleRunning(c, mint);
  console.log(`\n=== ${r.symbol} ${r.mint} mode=${r.mode} running=${running}`);
  if (!sale) { console.log("no sale"); continue; }
  console.log(`cap=${sale.cap} buyers=${sale.buyers} net=${sale.totalNetBought} band=${sale.hasBand}/${sale.bandBps} baseDec=${sale.baseDecimals} quoteDec=${sale.quoteDecimals} access=${sale.accessMode}`);
  const view = await loadPool(c, mint);
  const qm = await getMint(c, view.quoteMint, "confirmed", view.quoteProgram);
  console.log(`quote=${view.quoteMint.toBase58()} prog=${view.quoteProgram.toBase58()} dec=${qm.decimals} mintAuth=${qm.mintAuthority?.toBase58() ?? "none"}`);
  const bm = await getMint(c, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const sqrt = BigInt(view.poolAccount.poolState.sqrtPrice.toString());
  const curve = curvePriceDollars(sqrt, sale.baseDecimals || bm.decimals, sale.quoteDecimals || qm.decimals);
  console.log(`baseMintDec=${bm.decimals} curve=$${dollars(curve).toFixed(6)}`);
  if (sale.hasBand) {
    const p = await readPrice(c, sale);
    console.log(`price usable=${p.usable} err=${p.error} age=${p.ageSecs}s conf=${p.confBps}bps $${p.priceDollars} verified=${p.fullyVerified}`);
    if (p.price > 0n) console.log(`ceiling=$${dollars(priceCeiling(sale, p.price)).toFixed(4)} curveAbove=${curve > priceCeiling(sale, p.price)}`);
  }
  const st = saleStanding(sale, await listBuyerRecords(c, mint));
  console.log(`standing buyers=${st.buyers} largest=${(st.largestShare*100).toFixed(2)}% capShare=${(st.capShare*100).toFixed(2)}% total=${st.totalNetBought}`);
}
