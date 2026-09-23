/**
 * The directory and one sale page, photographed in both themes at both widths.
 *
 *   node lab-evidence/sale-shots.mjs http://localhost:3461
 *
 * Playwright is installed globally on this machine, not in this package, so it
 * is required by its full path rather than by name. Every page is scrolled to
 * its foot once first, so everything that reveals on scroll has revealed.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3461";
const PAAPLX = "8FaBUEjMfkpYAzZLmLKwYHxd15BNC1ZBFkgTgN2WCQvK";
const pages = [
  { name: "sales", path: "/sales" },
  { name: "sale-paaplx", path: `/sale/${PAAPLX}` },
];
const sizes = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
];

const browser = await chromium.launch();

for (const theme of ["light", "dark"]) {
  for (const size of sizes) {
    for (const target of pages) {
      const context = await browser.newContext({ viewport: size, colorScheme: theme });
      await context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), ["theme", theme]);
      const page = await context.newPage();
      await page.goto(base + target.path, { waitUntil: "networkidle", timeout: 180_000 });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 300) {
          window.scrollTo(0, y);
          await new Promise((wake) => setTimeout(wake, 100));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(2_500);
      const file = `lab-evidence/sale-shot-${target.name}-${theme}-${size.width}.png`;
      await page.screenshot({ path: file, fullPage: true });
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      console.log(`${file}  page width ${width}px at a ${size.width}px viewport`);
      await context.close();
    }
  }
}

await browser.close();
