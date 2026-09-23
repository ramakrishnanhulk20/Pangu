/**
 * The readout when devnet stops answering, photographed.
 *
 *   node lab-evidence/readout-stale-shots.mjs http://localhost:3931 3932
 *
 * The app under test must be started with DEVNET_RPC_URL=http://127.0.0.1:3932,
 * the second argument. This script runs a small relay on that port which passes
 * every call to the public devnet endpoint, so the server takes one real
 * reading. Then the relay is shut, which turns the server's RPC address into a
 * host that refuses every connection, and the page is photographed after its
 * next poll and again after a reload.
 *
 * Playwright is installed globally on this machine, not in this package, so it
 * is required by its full path rather than by name.
 */

import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3931";
const relayPort = Number(process.argv[3] ?? 3932);
const upstream = "https://api.devnet.solana.com";

const sockets = new Set();
let relayed = 0;
const statuses = {};
const relay = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  try {
    // The public node answers 429 under load. The relay stands in for a keyed
    // endpoint, so it waits and asks again rather than passing the 429 on.
    let answer;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      answer = await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: Buffer.concat(chunks),
      });
      if (answer.status !== 429) {
        break;
      }
      statuses.retried429 = (statuses.retried429 ?? 0) + 1;
      await new Promise((resolve) => setTimeout(resolve, 1_000 + attempt * 1_000));
    }
    const body = Buffer.from(await answer.arrayBuffer());
    relayed += 1;
    statuses[answer.status] = (statuses[answer.status] ?? 0) + 1;
    response.writeHead(answer.status, { "content-type": "application/json" });
    response.end(body);
  } catch {
    response.writeHead(502);
    response.end();
  }
});
relay.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
await new Promise((resolve) => relay.listen(relayPort, "127.0.0.1", resolve));
console.log(`relay up on ${relayPort}`);

const hide = {
  content: "header { display: none !important } nextjs-portal { display: none !important }",
};

const browser = await chromium.launch();
const shots = [
  { theme: "dark", width: 1440, height: 900 },
  { theme: "light", width: 1440, height: 900 },
  { theme: "dark", width: 390, height: 844 },
];

const pages = [];
for (const shot of shots) {
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
    colorScheme: shot.theme,
  });
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ["theme", shot.theme]
  );
  const page = await context.newPage();
  // Only a page showing a real reading proves anything once devnet goes quiet.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.goto(base, { waitUntil: "networkidle", timeout: 180_000 });
    if ((await page.locator("[data-testid=readout] svg[role=img]").count()) > 0) {
      break;
    }
    await page.waitForTimeout(12_000);
  }
  await page.addStyleTag(hide);
  await page.locator("[data-testid=readout]").scrollIntoViewIfNeeded();
  pages.push({ shot, page });
}

const liveText = await pages[0].page.locator("[data-testid=readout]").innerText();
console.log(`live reading taken through the relay (${relayed} calls relayed)`);
console.log(`devnet answers through the relay, by status: ${JSON.stringify(statuses)}`);
for (const { shot, page } of pages) {
  const line = page.locator("[data-testid=readout-stale]");
  const text = (await line.count()) > 0 ? await line.innerText() : "none";
  console.log(`before the outage, ${shot.theme} ${shot.width}: stale line ${text}`);
}

// Devnet goes quiet: the relay stops listening and drops what it holds open.
await new Promise((resolve) => {
  relay.close(resolve);
  for (const socket of sockets) {
    socket.destroy();
  }
});
console.log("relay shut, the server's RPC address now refuses connections");

// One full poll interval and a little more, so every page has asked again.
await pages[0].page.waitForTimeout(20_000);

for (const { shot, page } of pages) {
  const line = page.locator("[data-testid=readout-stale]");
  const text = (await line.count()) > 0 ? await line.innerText() : "(no stale line)";
  const name = `lab-evidence/readout-stale-${shot.theme}-${shot.width}x${shot.height}.png`;
  await page.locator("[data-testid=readout]").screenshot({ path: name });
  console.log(`${name}: ${text}`);
}

const afterText = await pages[0].page.locator("[data-testid=readout]").innerText();
const kept = ["raised so far", "buyers", "the largest wallet"].every((label) =>
  afterText.toLowerCase().includes(label)
);
console.log(`numbers kept after the failed poll: ${kept}`);
console.log(`curve kept after the failed poll: ${(await pages[0].page.locator("[data-testid=readout] svg[role=img]").count()) > 0}`);
console.log(`live text had the same stat labels: ${liveText.toLowerCase().includes("raised so far")}`);

// A fresh visit while devnet is still silent: the server hands back the
// reading it kept, marked stale, instead of an empty section.
const { page } = pages[0];
await page.reload({ waitUntil: "networkidle", timeout: 180_000 });
await page.addStyleTag(hide);
await page.locator("[data-testid=readout]").scrollIntoViewIfNeeded();
await page.waitForTimeout(3_000);
const reloadLine = page.locator("[data-testid=readout-stale]");
const reloadName = "lab-evidence/readout-stale-reload-dark-1440x900.png";
await page.locator("[data-testid=readout]").screenshot({ path: reloadName });
console.log(
  `${reloadName}: ${(await reloadLine.count()) > 0 ? await reloadLine.innerText() : "(no stale line)"}`
);
const picker = await page.locator("[data-testid=readout] button[aria-pressed]").allInnerTexts();
console.log(`picker after reload: ${picker.map((text) => text.replace(/\s+/g, " ")).join(" | ")}`);

await browser.close();
