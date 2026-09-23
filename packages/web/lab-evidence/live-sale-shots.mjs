/**
 * The hero's live line and the ledger's facts at 1440 in the light theme, for
 * whichever sale the page leads with right now.
 *
 *   node lab-evidence/live-sale-shots.mjs http://localhost:3000
 *
 * Playwright is installed globally on this machine, not in this package, so it
 * is required by its full path rather than by name.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
await context.addInitScript(() => window.localStorage.setItem("theme", "light"));
const page = await context.newPage();
await page.goto(base, { waitUntil: "networkidle", timeout: 180_000 });
// The dev overlay is not part of the product.
await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });

const pulse = page.locator("[data-testid=hero-pulse]");
await pulse.waitFor({ timeout: 120_000 });
await page.waitForTimeout(2_500);
console.log(`hero line   : ${(await pulse.innerText()).replace(/\s+/g, " ")}`);
await page.screenshot({ path: "lab-evidence/live-sale-hero-light-1440.png" });
console.log("lab-evidence/live-sale-hero-light-1440.png");

const readout = page.locator("[data-testid=readout]");
await readout.scrollIntoViewIfNeeded();
await page.waitForTimeout(2_000);
const active = page.locator("[data-testid=readout] button[aria-pressed=true]");
console.log(`readout sale: ${(await active.first().innerText()).replace(/\s+/g, " ")}`);

const facts = page.locator("[data-testid=break-facts]");
await facts.waitFor({ timeout: 120_000 });
await page.addStyleTag({ content: "header { display: none !important }" });
await facts.scrollIntoViewIfNeeded();
await page.waitForTimeout(3_000);
console.log(`ledger facts: ${(await facts.innerText()).replace(/\s+/g, " ")}`);
// The facts and the lines under them, as one picture.
const block = facts.locator("xpath=..");
const shut = page.locator("[data-testid=break-exchange-shut]");
console.log(`shut line   : ${(await shut.count()) > 0 ? await shut.innerText() : "not shown"}`);
await block.screenshot({ path: "lab-evidence/live-sale-ledger-facts-light-1440.png" });
console.log("lab-evidence/live-sale-ledger-facts-light-1440.png");
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
console.log(`page wider than the screen by ${overflow}px`);

await browser.close();
