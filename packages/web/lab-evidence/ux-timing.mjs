/**
 * How long a visitor with no wallet waits for the attack ledger's facts, and
 * how many errors the console logs on the front page.
 *
 *   node lab-evidence/ux-timing.mjs http://localhost:3412
 *
 * Run it first thing after the server starts: the first load is the cold one,
 * with nothing held on the server. The second waits out the ten second shared
 * reading so the server reads devnet again; the third lands inside it.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3412";
const browser = await chromium.launch();

async function load(label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`page error: ${error.message}`));

  await page.goto(base, { waitUntil: "commit", timeout: 120_000 });
  await page.locator("[data-testid=break-facts], [data-testid=break-failure]").first().waitFor({
    state: "attached",
    timeout: 120_000,
  });
  const at = await page.evaluate(() => Math.round(performance.now()));
  const failed = await page.locator("[data-testid=break-failure]").count();

  // Walk the whole page so every section that draws on scroll has drawn.
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(3_000);
  await context.close();

  console.log(
    `${label}: ledger facts ${failed ? "FAILED" : "shown"} ${at} ms after navigation started; console errors on /: ${errors.length}`
  );
  for (const error of errors) console.log(`  ${error.slice(0, 300)}`);
}

await load("cold load, nothing held on the server");
await new Promise((wake) => setTimeout(wake, 11_000));
await load("load after the shared reading expired, server reads devnet again");
await load("load inside the shared reading");
await browser.close();
