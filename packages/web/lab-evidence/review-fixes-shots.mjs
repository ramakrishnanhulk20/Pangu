/**
 * The exact end of an offering, everywhere a buy is offered, on a
 * verification server at desktop and phone widths, plus the short-offering
 * words held against hand-made moments.
 *
 *   node lab-evidence/review-fixes-shots.mjs http://127.0.0.1:3461 <mint with an end> <wallet holding one>
 *
 * Pages: the directory's rows, the sale's title, its trade panel and the note
 * beside it, and the portfolio's rows for a wallet that holds shares of a
 * sale with an end, read with a wallet that only shows that address and
 * cannot sign. Screenshots go to
 * lab-evidence/review-fixes-*.png. Reads only; sends nothing.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://127.0.0.1:3461";
const mint = process.argv[3];
if (/:3000\b/.test(base)) {
  throw new Error("port 3000 is the running dev server; point this at a verification server");
}
if (mint === undefined) {
  throw new Error("name a sale that has an end date");
}
const holder = process.argv[4];
if (holder === undefined) {
  throw new Error("name a wallet that holds shares of a sale with an end");
}
const EXACT = /\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC/;

let failures = 0;
function check(label, ok, detail) {
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail === undefined ? "" : `: ${detail}`}`);
}

// The words, against moments made by hand.
{
  const web = fileURLToPath(new URL("..", import.meta.url));
  const jiti = createJiti(import.meta.url, { alias: { "@/": web } });
  const { offeringEnd } = await jiti.import("../components/sales/words.ts");
  const now = Date.UTC(2026, 8, 24, 9, 0);
  const tenMinutes = offeringEnd(now / 1000 + 600, null, now);
  check("ten minutes left, creation unknown: exact end", tenMinutes.at === "24 Sep 2026, 09:10 UTC", tenMinutes.at);
  check("ten minutes left: time left", tenMinutes.left === "10 minutes left", tenMinutes.left);
  check(
    "ten minutes left, creation unknown: flagged short",
    tenMinutes.short === "Short offering: at 24 Sep 2026, 09:10 UTC every rule lifts and anyone can buy without a cap.",
    tenMinutes.short
  );
  const oldSale = offeringEnd(now / 1000 + 600, now - 30 * 86_400_000, now);
  check("ten minutes left of a 30 day offering: not flagged", oldSale.short === null && oldSale.left === "10 minutes left");
  const sixHours = offeringEnd(now / 1000 + 6 * 3_600, now - 3_600_000, now);
  check("a seven hour offering: flagged", sixHours.short !== null, sixHours.short);
  const twoWeeks = offeringEnd(now / 1000 + 14 * 86_400, now, now);
  check("a fourteen day offering: not flagged", twoWeeks.short === null && twoWeeks.left === "14 days left", twoWeeks.left);
  const over = offeringEnd(now / 1000 - 60, null, now);
  check("an offering that has ended: no time left, no flag", over.left === null && over.short === null);
  const serverPaint = offeringEnd(now / 1000 + 600, null, null);
  check("before the visitor's clock is known: the exact end only", serverPaint.left === null && serverPaint.short === null);
}

function injectReader([address, keyBytes]) {
  const account = Object.freeze({
    address,
    publicKey: new Uint8Array(keyBytes),
    chains: ["solana:devnet"],
    features: [],
  });
  const wallet = {
    version: "1.0.0",
    name: "Pangu Read Only",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iI2M4ZjEzNSIvPjwvc3ZnPg==",
    chains: ["solana:devnet"],
    accounts: [account],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async () => {
          throw new Error("this wallet only reads");
        },
      },
    },
  };
  const register = ({ register: add }) => add(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  window.localStorage.setItem("walletName", JSON.stringify("Pangu Read Only"));
}

const { PublicKey } = require("@solana/web3.js");
const browser = await chromium.launch();
try {
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 812 }, colorScheme: "dark" });
    await context.addInitScript(injectReader, [holder, Array.from(new PublicKey(holder).toBytes())]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important }";
      document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
    });

    await page.goto(`${base}/sales`, { waitUntil: "networkidle", timeout: 120_000 });
    const row = page.getByTestId("sales-row").filter({ hasText: "offering ends" }).first();
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1_200);
    const rowText = (await row.innerText()).replace(/\n+/g, " / ");
    check(`${width}: a directory row shows the exact end and time left`, EXACT.test(rowText) && / left/.test(rowText), rowText.slice(0, 160));
    await row.screenshot({ path: `lab-evidence/review-fixes-directory-${width}.png` });

    await page.goto(`${base}/sale/${mint}`, { waitUntil: "networkidle", timeout: 120_000 });
    const title = await page.getByTestId("sale-title").innerText();
    check(`${width}: the sale's title shows the exact end`, EXACT.test(title), /offering ends[^\n]*/.exec(title)?.[0]);
    await page.getByTestId("trade-offering-end").waitFor({ timeout: 60_000 });
    const end = await page.getByTestId("trade-offering-end").innerText();
    check(`${width}: the trade panel shows the exact end and time left`, EXACT.test(end) && / left/.test(end), end);
    const note = await page.getByTestId("sale-desk-end").innerText().catch(() => "");
    check(`${width}: the note beside it shows the exact end`, EXACT.test(note), note);
    await page.getByTestId("trade-panel").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1_200);
    await page.getByTestId("sale-desk").screenshot({ path: `lab-evidence/review-fixes-sale-${width}.png` });

    await page.goto(`${base}/portfolio`, { waitUntil: "networkidle", timeout: 120_000 });
    const portfolioRow = page.getByTestId("portfolio-row").filter({ hasText: "offering ends" }).first();
    await portfolioRow.waitFor({ timeout: 120_000 });
    await portfolioRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1_200);
    const portfolioText = (await portfolioRow.innerText()).replace(/\n+/g, " / ");
    check(`${width}: a portfolio row shows the exact end and time left`, EXACT.test(portfolioText) && / left/.test(portfolioText), /offering ends[^/]*/.exec(portfolioText)?.[0]);
    await portfolioRow.screenshot({ path: `lab-evidence/review-fixes-portfolio-${width}.png` });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${width}: no sideways scroll on the portfolio`, overflow <= 0, String(overflow));
    check(`${width}: no uncaught errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
} finally {
  await browser.close();
}

console.log("");
console.log(failures === 0 ? "every check passed" : `${failures} checks failed`);
process.exit(failures === 0 ? 0 : 1);
