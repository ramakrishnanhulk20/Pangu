/**
 * WO-38: the hero at 375 in both themes. Measures how far the share dot (the
 * solid dot and its pale halo) sits from every line of text in the hero, and
 * saves the two pictures.
 *
 * It also walks the curve and counts any point still drawn over a letter or
 * the button.
 *
 *   node lab-evidence/cleanup-hero.mjs http://localhost:3000 [suffix]
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3000";
const suffix = process.argv[3] ?? "";
const browser = await chromium.launch();

for (const theme of ["light", "dark"]) {
  for (const height of [812, 667]) {
    const context = await browser.newContext({
      viewport: { width: 375, height },
      deviceScaleFactor: 2,
      colorScheme: theme,
      hasTouch: true,
      isMobile: true,
    });
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ["theme", theme]
    );
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "networkidle", timeout: 120_000 });
    await page.locator("[data-testid=hero-pulse]").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2_500);
    const measure = () => page.evaluate(() => {
      const hero = document.querySelector("[data-testid=hero]");
      const shown = [...hero.querySelectorAll("svg")].filter(
        (node) => node.getBoundingClientRect().width > 0 && getComputedStyle(node).display !== "none"
      );
      const svg = shown.find((node) => node.querySelector("circle") !== null);
      const circles = [...svg.querySelectorAll("circle")].map((node) => node.getBoundingClientRect());
      const halo = circles.find((box) => box.width === Math.max(...circles.map((c) => c.width)));
      const dot = circles.find((box) => box.width === Math.min(...circles.map((c) => c.width)));
      const lines = [];
      const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.textContent.trim() === "" || node.parentElement.closest("svg")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const box of range.getClientRects()) {
          lines.push({ text: node.textContent.trim().slice(0, 40), box });
        }
      }
      const gap = (circle, box) => {
        const cx = circle.left + circle.width / 2;
        const cy = circle.top + circle.height / 2;
        const r = circle.width / 2;
        const dx = Math.max(box.left - cx, 0, cx - box.right);
        const dy = Math.max(box.top - cy, 0, cy - box.bottom);
        return Math.hypot(dx, dy) - r;
      };
      const nearest = (circle) =>
        lines
          .map((line) => ({ text: line.text, gap: Math.round(gap(circle, line.box) * 10) / 10 }))
          .sort((a, b) => a.gap - b.gap)[0];
      // Walks the curve and counts the points where it is still drawn (not
      // faded out) and lands inside a line of text or the button.
      const curveSvg = shown.find((node) => node.querySelector("path") !== null);
      const path = curveSvg.querySelector("path");
      const frame = curveSvg.parentElement;
      const vars = getComputedStyle(frame);
      const px = (name) => parseFloat(vars.getPropertyValue(name)) || Infinity;
      const shift = parseFloat(vars.getPropertyValue("--share-shift")) || 0;
      const fadeClear = px("--fade-clear");
      const fadeEnd = px("--fade-end");
      const frameTop = frame.getBoundingClientRect().top;
      const button = hero.querySelector("a, button").getBoundingClientRect();
      const blocks = [...lines.map((line) => line.box), button];
      const matrix = path.getScreenCTM();
      const total = path.getTotalLength();
      let crossings = 0;
      for (let at = 0; at <= total; at += total / 4000) {
        const point = path.getPointAtLength(at).matrixTransform(matrix);
        const local = point.y - frameTop - shift;
        const drawn = curveSvg.style.maskImage === "" || local < fadeClear || local > fadeEnd;
        if (drawn && blocks.some((box) => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom)) {
          crossings += 1;
        }
      }
      return {
        crossings,
        heroHeight: Math.round(hero.getBoundingClientRect().height),
        dotCentre: [Math.round(dot.left + dot.width / 2), Math.round(dot.top + dot.height / 2)],
        dot: nearest(dot),
        halo: nearest(halo),
      };
    });
    const report = (found, state) => {
      const clear = found.dot.gap >= 8 && found.halo.gap >= 8;
      console.log(
        `${theme} 375x${height} ${state}: hero ${found.heroHeight}px, dot at ${found.dotCentre}, ` +
          `dot ${found.dot.gap}px from "${found.dot.text}", halo ${found.halo.gap}px from "${found.halo.text}": ` +
          (clear ? "clear" : "TOO CLOSE") +
          `; curve points drawn over text or the button: ${found.crossings}`
      );
    };
    report(await measure(), "live");
    if (height === 812) {
      await page.locator("[data-testid=hero]").screenshot({
        path: `lab-evidence/cleanup-hero-${theme}-375${suffix}.png`,
      });
    }
    // A sale with an offering period adds a fourth cell to the live line. The
    // last cell is copied in twice here to stand for that and for anything
    // taller, and the dot is measured again once the drawing has followed.
    for (const extra of [1, 2]) {
      await page.evaluate(() => {
        const row = document.querySelector("[data-testid=hero-pulse]");
        row.appendChild(row.lastElementChild.cloneNode(true));
      });
      await page.waitForTimeout(400);
      report(await measure(), `live plus ${extra} cell${extra === 1 ? "" : "s"}`);
    }
    await context.close();
  }
}
await browser.close();
