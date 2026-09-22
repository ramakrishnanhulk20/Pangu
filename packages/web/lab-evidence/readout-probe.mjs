import { readFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { curvePriceDollars, dollars, listBuyerRecords, saleStanding } from "pangu-sdk";
import { loadPool, saleProgress } from "pangu-sdk/dbc";

const sales = JSON.parse(readFileSync("../scripts/sales.json", "utf8")).filter((s) => s.network === "devnet");
const c = new Connection("https://api.devnet.solana.com", "confirmed");

const Q128 = 1n << 128n;

function livePoints(cfg) {
  const out = [];
  let last = BigInt(cfg.sqrtStartPrice.toString());
  for (const p of cfg.curve) {
    const sqrtPrice = BigInt(p.sqrtPrice.toString());
    const liquidity = BigInt(p.liquidity.toString());
    if (sqrtPrice <= last || liquidity === 0n) break;
    out.push({ sqrtPrice, liquidity });
    last = sqrtPrice;
  }
  return out;
}

function sqrtAt(quote, cfg) {
  const pts = livePoints(cfg);
  let lower = BigInt(cfg.sqrtStartPrice.toString());
  let left = quote;
  for (const p of pts) {
    const span = (p.liquidity * (p.sqrtPrice - lower) + Q128 - 1n) / Q128;
    if (span >= left) return lower + (left << 128n) / p.liquidity;
    left -= span;
    lower = p.sqrtPrice;
  }
  return lower;
}

function quoteFor(sqrt, cfg) {
  let total = 0n;
  const start = BigInt(cfg.sqrtStartPrice.toString());
  const pts = livePoints(cfg);
  let lower = start;
  for (const p of pts) {
    if (sqrt > lower) {
      const upper = sqrt < p.sqrtPrice ? sqrt : p.sqrtPrice;
      const prod = p.liquidity * (upper - lower);
      total += (prod + Q128 - 1n) / Q128;
    }
    lower = p.sqrtPrice;
  }
  return total;
}

function baseFor(sqrt, cfg) {
  let total = 0n;
  const start = BigInt(cfg.sqrtStartPrice.toString());
  const pts = livePoints(cfg);
  let lower = start;
  for (const p of pts) {
    if (sqrt > lower) {
      const upper = sqrt < p.sqrtPrice ? sqrt : p.sqrtPrice;
      total += (p.liquidity * (upper - lower)) / (lower * upper);
    }
    lower = p.sqrtPrice;
  }
  return total;
}

for (const s of sales) {
  console.log("=====", s.name, s.mint, "mode", s.mode);
  const pool = await loadPool(c, new PublicKey(s.mint));
  const cfg = pool.configState;
  const st = pool.poolAccount.poolState;
  console.log("curve points:", cfg.curve.length, cfg.curve.map((p) => p.sqrtPrice.toString() + "/" + p.liquidity.toString()).slice(0, 12));
  console.log("sqrtStart", cfg.sqrtStartPrice.toString(), "sqrtNow", st.sqrtPrice.toString());
  console.log("quoteReserve", st.quoteReserve.toString(), "threshold", cfg.migrationQuoteThreshold.toString(), "isMigrated", st.isMigrated);
  console.log("baseReserve", st.baseReserve.toString());
  console.log("decimals base", pool.sale.baseDecimals, "quote", pool.sale.quoteDecimals, "cap", pool.sale.cap.toString());
  const end = sqrtAt(BigInt(cfg.migrationQuoteThreshold.toString()), cfg);
  console.log("live points", livePoints(cfg).length, "sqrtAtThreshold", end.toString());
  console.log("end sqrt", end.toString(), "quote at end", quoteFor(end, cfg).toString(), "base at end", baseFor(end, cfg).toString());
  console.log("quote at now (mine)", quoteFor(BigInt(st.sqrtPrice.toString()), cfg).toString());
  console.log("base sold at now", baseFor(BigInt(st.sqrtPrice.toString()), cfg).toString());
  const qd = pool.sale.quoteDecimals || 0;
  console.log("price now", dollars(curvePriceDollars(BigInt(st.sqrtPrice.toString()), pool.sale.baseDecimals, qd)));
  const recs = await listBuyerRecords(c, new PublicKey(s.mint));
  const standing = saleStanding(pool.sale, recs);
  console.log("records", recs.length, "buyers", standing.buyers, "largest", standing.largestShare, "capShare", standing.capShare, "totalNet", standing.totalNetBought.toString());
  console.log("wallets", recs.map((r) => r.wallet.toBase58().slice(0, 6) + ":" + r.netBought.toString() + (r.approved ? ":ok" : "")));
  try {
    const prog = await saleProgress(c, new PublicKey(s.mint));
    console.log("progress", prog.quoteRaised.toString(), prog.threshold.toString(), prog.percent, prog.graduated, prog.dammPool?.toBase58() ?? null);
  } catch (e) { console.log("progress failed", e.message); }
}
