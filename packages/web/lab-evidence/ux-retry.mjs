/**
 * The ledger's failure path: the first read of the sale fails, the failure
 * sentence and "try again" show, the one automatic retry lands after about
 * five seconds and the facts appear.
 *
 *   node lab-evidence/ux-retry.mjs http://localhost:3412
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3412";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let asked = 0;
await page.route("**/api/break/sale", (route) => {
  asked += 1;
  return asked === 1 ? route.abort("failed") : route.continue();
});
await page.goto(base, { waitUntil: "commit", timeout: 120_000 });
const failure = page.locator("[data-testid=break-failure]");
await failure.waitFor({ state: "attached", timeout: 60_000 });
const failedAt = await page.evaluate(() => performance.now());
console.log(`failure shown: "${(await failure.locator("p").textContent()).trim()}"`);
console.log(`try again button: ${await failure.getByRole("button", { name: /try again/i }).count()}`);
await page.locator("[data-testid=break-facts]").waitFor({ state: "attached", timeout: 60_000 });
const shownAt = await page.evaluate(() => performance.now());
console.log(`facts shown ${Math.round(shownAt - failedAt)} ms after the failure, after ${asked} reads`);
await browser.close();
