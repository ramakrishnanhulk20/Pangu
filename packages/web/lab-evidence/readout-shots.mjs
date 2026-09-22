/**
 * The readout, photographed in both themes at both widths.
 *
 *   node lab-evidence/readout-shots.mjs http://localhost:3300
 *
 * Playwright is installed globally on this machine, not in this package, so it
 * is required by its full path rather than by name.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/Ram/AppData/Roaming/npm/node_modules/playwright"
);

const base = process.argv[2] ?? "http://localhost:3300";
const sizes = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

const browser = await chromium.launch();

for (const theme of ["light", "dark"]) {
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: size,
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ["theme", theme]
    );

    const page = await context.newPage();
    await page.goto(base, { waitUntil: "networkidle", timeout: 120_000 });

    // The section is taller than the viewport, so a sticky bar would be baked
    // into the middle of the picture, and the dev overlay is not part of the
    // product. Neither changes the section's own layout.
    await page.addStyleTag({
      content: "header { display: none !important } nextjs-portal { display: none !important }",
    });
    await page.locator("[data-testid=readout]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(4_000);

    const name = `lab-evidence/readout-${theme}-${size.width}x${size.height}.png`;
    await page.locator("[data-testid=readout]").screenshot({ path: name });
    console.log(name);

    // The other sale, the one that finished, through the picker itself.
    if (size.width === 1440) {
      await page.getByRole("button", { name: /listed share/i }).click();
      await page.waitForTimeout(4_000);
      const second = `lab-evidence/readout-graduated-${theme}-1440x900.png`;
      await page.locator("[data-testid=readout]").screenshot({ path: second });
      console.log(second);
    }

    await context.close();
  }
}

await browser.close();
