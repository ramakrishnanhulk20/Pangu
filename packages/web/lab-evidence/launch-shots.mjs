/**
 * The launch page, photographed in both themes at 1440 and 375 wide: the form
 * as it first loads, and filled in with a price ceiling on.
 *
 *   node lab-evidence/launch-shots.mjs http://127.0.0.1:3460
 *
 * Point it at a verification server, never the dev server on 3000. No wallet
 * is connected, so nothing here can sign. The done state is photographed by
 * lab-evidence/test-wallet.mjs, the one run that really launches.
 *
 * Playwright is installed globally on this machine, so it is required by its
 * full path rather than by name.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://127.0.0.1:3460";
const sizes = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
];

export const FILLED = {
  "launch-name": "Apple Series A Share",
  "launch-symbol": "AAPLS",
  "launch-supply": "20",
  "launch-raise": "3710",
  "launch-kept": "45",
  "launch-cap": "10",
  "launch-days": "14",
  "launch-band-percent": "5",
};

/** Scrolls to the foot and back so every section's scroll reveal has run before the picture. */
async function walk(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2_500);
}

const browser = await chromium.launch();

for (const theme of ["light", "dark"]) {
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme: theme });
    await context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), ["theme", theme]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/launch`, { waitUntil: "networkidle", timeout: 120_000 });
    // The sticky nav would be baked into the middle of a full-page picture.
    await page.addStyleTag({ content: "header.sticky, nextjs-portal { display: none !important }" });
    await walk(page);
    await page.screenshot({ path: `lab-evidence/launch-empty-${theme}-${size.width}.png`, fullPage: true });

    await page.getByTestId("launch-band-on").click();
    for (const [id, value] of Object.entries(FILLED)) {
      await page.getByTestId(id).fill(value);
    }
    await page.getByTestId("launch-stock").waitFor({ timeout: 150_000 });
    // The curve redraws once typing pauses, then draws itself in over a second and a half.
    await walk(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `lab-evidence/launch-filled-band-${theme}-${size.width}.png`, fullPage: true });
    const opening = await page.getByTestId("launch-opening").textContent();
    const stock = await page.getByTestId("launch-stock").textContent();
    const rules = await page.getByTestId("launch-rules").innerText();
    console.log(`${theme} ${size.width}: opening ${opening}; ${stock}; sideways overflow ${overflow}px; page errors ${errors.length}${errors.length > 0 ? `: ${errors.join(" | ")}` : ""}`);
    if (size.width === 1440 && theme === "light") {
      console.log(rules);
    }
    await context.close();
  }
}

await browser.close();
