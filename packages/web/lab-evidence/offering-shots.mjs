/**
 * The offering line under the readout's rule at 1440 in the light theme, and
 * the ledger's facts line at 375, where the offering sits as the last fact.
 *
 *   node lab-evidence/offering-shots.mjs http://localhost:3000
 *
 * Playwright is installed globally on this machine, not in this package, so it
 * is required by its full path rather than by name.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();

async function open(size) {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  await context.addInitScript(() => window.localStorage.setItem("theme", "light"));
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle", timeout: 180_000 });
  // A sticky bar would be baked into the middle of the picture, and the dev
  // overlay is not part of the product.
  await page.addStyleTag({
    content: "header { display: none !important } nextjs-portal { display: none !important }",
  });
  return { context, page };
}

{
  const { context, page } = await open({ width: 1440, height: 900 });
  const line = page.locator("[data-testid=readout-offering]");
  await line.scrollIntoViewIfNeeded();
  await page.waitForTimeout(3_000);
  // The rule line and the offering line under it, as one picture.
  const box = await line.evaluate((node) => {
    const rule = node.previousElementSibling.getBoundingClientRect();
    const own = node.getBoundingClientRect();
    const left = Math.min(rule.left, own.left) - 24;
    const top = rule.top - 24;
    return {
      x: left + window.scrollX,
      y: top + window.scrollY,
      width: Math.max(rule.right, own.right) - left + 48,
      height: own.bottom - top + 48,
    };
  });
  console.log(`readout offering line: ${await line.innerText()}`);
  await page.screenshot({ path: "lab-evidence/offering-readout-light-1440.png", clip: box, fullPage: true });
  console.log("lab-evidence/offering-readout-light-1440.png");
  await context.close();
}

{
  const { context, page } = await open({ width: 375, height: 812 });
  const facts = page.locator("[data-testid=break-facts]");
  await facts.waitFor({ timeout: 120_000 });
  await facts.scrollIntoViewIfNeeded();
  await page.waitForTimeout(3_000);
  console.log(`ledger facts: ${(await facts.innerText()).replace(/\s+/g, " ")}`);
  await facts.screenshot({ path: "lab-evidence/offering-ledger-facts-light-375.png" });
  console.log("lab-evidence/offering-ledger-facts-light-375.png");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`page wider than the screen by ${overflow}px`);
  await context.close();
}

await browser.close();
