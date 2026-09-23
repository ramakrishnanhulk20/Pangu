/**
 * The pictures WO-34 asks for: the readout headline at 1440 in light, both
 * 404 pages, a diagram at 375 in the column and full size, and the hero at 375
 * in both themes with the cap line along the top. It also measures the
 * headline's lines and tries the hero with scripts turned off.
 *
 *   node lab-evidence/ux-shots.mjs http://localhost:3412
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3412";
const browser = await chromium.launch();

async function open(width, height, theme, extra = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: theme,
    ...extra,
  });
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ["theme", theme]
  );
  return { context, page: await context.newPage() };
}

{
  const { context, page } = await open(1440, 900, "light");
  await page.goto(base, { waitUntil: "networkidle", timeout: 120_000 });
  const readout = page.locator("[data-testid=readout]");
  await readout.scrollIntoViewIfNeeded();
  await page.waitForTimeout(3_000);
  const heading = readout.locator("h2");
  const lines = await heading.evaluate((node) => {
    const style = getComputedStyle(node);
    return Math.round(node.getBoundingClientRect().height / parseFloat(style.lineHeight));
  });
  console.log(`readout headline at 1440: ${lines} lines`);
  // The sticky nav is hidden so it does not sit over the heading.
  await page.addStyleTag({ content: "header { display: none !important }" });
  await readout.evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY));
  await page.waitForTimeout(800);
  await page.screenshot({ path: "lab-evidence/ux-readout-headline-light-1440.png" });
  await context.close();
}

for (const [path, name] of [
  ["/no-such-page", "site"],
  ["/docs/no-such-page", "docs"],
]) {
  for (const width of [1440, 375]) {
    const { context, page } = await open(width, width === 375 ? 812 : 900, "dark");
    const answer = await page.goto(base + path, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: `lab-evidence/ux-404-${name}-dark-${width}.png` });
    console.log(`${path} at ${width}: HTTP ${answer.status()}`);
    await context.close();
  }
}

{
  const { context, page } = await open(375, 812, "light", { hasTouch: true, isMobile: true });
  await page.goto(base + "/docs/how-it-works", { waitUntil: "networkidle", timeout: 120_000 });
  const diagram = page.locator("[data-diagram]").first();
  await diagram.scrollIntoViewIfNeeded();
  await diagram.locator("svg").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
  const fit = await diagram.evaluate((node) => ({
    frame: Math.round(node.getBoundingClientRect().width),
    drawing: Math.round(node.querySelector("svg").getBoundingClientRect().width),
    scrolls: node.scrollWidth > node.clientWidth,
  }));
  console.log(`diagram at 375: frame ${fit.frame}px, drawing ${fit.drawing}px, sideways scroll ${fit.scrolls}`);
  await diagram.screenshot({ path: "lab-evidence/ux-mermaid-light-375.png" });
  await diagram.getByRole("button", { name: /full size/i }).click();
  await page.waitForTimeout(800);
  const open375 = await page.locator("dialog[open]").count();
  const viewport = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.content ?? "none");
  console.log(`diagram dialog open: ${open375 === 1}; viewport meta: ${viewport}`);
  await page.screenshot({ path: "lab-evidence/ux-mermaid-full-light-375.png" });
  await context.close();
}

for (const theme of ["light", "dark"]) {
  const { context, page } = await open(375, 812, theme);
  await page.goto(base, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(2_500);
  await page.locator("[data-testid=hero]").screenshot({ path: `lab-evidence/ux-hero-${theme}-375.png` });
  await context.close();
}

{
  const { context, page } = await open(1440, 900, "dark", { javaScriptEnabled: false });
  await page.goto(base, { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(1_500);
  const opacity = await page.locator("[data-testid=hero] h1").evaluate(
    (node) => getComputedStyle(node.closest(".pangu-rise")).opacity
  );
  console.log(`hero title with scripts off, 1.5 s after load: opacity ${opacity}`);
  await page.locator("[data-testid=hero]").screenshot({ path: "lab-evidence/ux-hero-no-script-dark-1440.png" });
  await context.close();
}

await browser.close();
