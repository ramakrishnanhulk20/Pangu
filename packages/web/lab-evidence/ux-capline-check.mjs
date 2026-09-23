/**
 * Where the ledger's dotted cap line sits against the text around it, at 1440
 * and 375: the bottom of the heading block above and the top of the facts below.
 *
 *   node lab-evidence/ux-capline-check.mjs http://localhost:3411
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3411";
const browser = await chromium.launch();
for (const width of [1440, 375]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("[data-testid=break-facts]").waitFor({ timeout: 60_000 });
  const found = await page.evaluate(() => {
    const section = document.querySelector("[data-testid=break-section]");
    const top = section.getBoundingClientRect().top;
    const header = section.querySelector("header").getBoundingClientRect();
    const facts = section.querySelector("[data-testid=break-facts]").getBoundingClientRect();
    const line = [...section.querySelectorAll("div")].find((node) =>
      node.style.backgroundImage.includes("radial-gradient")
    ).getBoundingClientRect();
    return {
      headerBottom: Math.round(header.bottom - top),
      lineTop: Math.round(line.top - top),
      lineBottom: Math.round(line.bottom - top),
      factsTop: Math.round(facts.top - top),
    };
  });
  const clear = found.lineTop > found.headerBottom && found.lineBottom < found.factsTop;
  console.log(`${width}px: heading block ends ${found.headerBottom}, cap line ${found.lineTop} to ${found.lineBottom}, facts start ${found.factsTop}: ${clear ? "clear of text" : "CROSSES TEXT"}`);
  await page.close();
}
await browser.close();
