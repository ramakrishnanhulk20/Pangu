/**
 * Loads the front page at 1440 and 375, walks it top to bottom so every
 * section draws, and prints every console error and page error it logs.
 *
 *   node lab-evidence/ux-console.mjs http://localhost:3412
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3412";
const browser = await chromium.launch();
let total = 0;
for (const width of [1440, 375]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`page error: ${error.message}`));
  await page.goto(base, { waitUntil: "networkidle", timeout: 180_000 });
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(4_000);
  total += errors.length;
  console.log(`${width}px: ${errors.length} console errors`);
  for (const error of errors) console.log(`  ${error.slice(0, 240)}`);
  await page.close();
}
console.log(`total: ${total}`);
await browser.close();
