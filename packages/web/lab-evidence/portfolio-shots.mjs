/**
 * Screenshots of /portfolio at 1440 and 375, in both themes, for one wallet.
 *
 *   node lab-evidence/portfolio-shots.mjs http://127.0.0.1:3472 <wallet> <name> [folder]
 *
 * The wallet is injected with its public key only and refuses every signature,
 * so any address can be looked at and nothing can be signed. Without a wallet
 * address ("none") the page shows its connect prompt.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");
const { PublicKey } = require("@solana/web3.js");

const BASE = process.argv[2] ?? "http://127.0.0.1:3472";
const WALLET = process.argv[3] ?? "none";
const NAME = process.argv[4] ?? "portfolio";
const FOLDER = process.argv[5] ?? "lab-evidence";
if (/:3000\b/.test(BASE)) {
  throw new Error("port 3000 is Ram's dev server; point this at another server");
}

function injectReadOnly({ address, publicKey }) {
  window.localStorage.setItem("walletName", JSON.stringify("Pangu Read Only"));
  const account = Object.freeze({
    address,
    publicKey: Uint8Array.from(publicKey),
    chains: ["solana:devnet"],
    features: ["solana:signTransaction"],
  });
  const wallet = {
    version: "1.0.0",
    name: "Pangu Read Only",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzdhYTZmZiIvPjwvc3ZnPg==",
    chains: ["solana:devnet"],
    accounts: [account],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async () => {
          throw new Error("User rejected the request.");
        },
      },
    },
  };
  const register = ({ register: add }) => add(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

const browser = await chromium.launch();
const errors = [];
for (const theme of ["dark", "light"]) {
  for (const width of [1440, 375]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 1440 ? 900 : 812 },
      colorScheme: theme,
      deviceScaleFactor: 1,
    });
    if (WALLET !== "none") {
      await context.addInitScript(injectReadOnly, {
        address: WALLET,
        publicKey: Array.from(new PublicKey(WALLET).toBytes()),
      });
    }
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${theme} ${width}: ${error.message.slice(0, 160)}`));
    await page.goto(`${BASE}/portfolio`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    await page.waitForSelector(WALLET === "none" ? "[data-testid=portfolio-connect]" : "[data-testid=portfolio]", {
      timeout: 180_000,
    });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });
    // Every row enters on scroll, so the page is walked once before the full-page shot.
    const height = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < height; y += 300) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(1_500);
    // Back to the top, so the sticky nav sits where it belongs in the full-page shot.
    await page.mouse.wheel(0, -height - 1_000);
    await page.waitForTimeout(2_000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(`${theme} ${width}: sideways overflow ${overflow}px`);
    await page.screenshot({ path: `${FOLDER}/${NAME}-${theme}-${width}.png`, fullPage: true });
    await context.close();
  }
}
await browser.close();
console.log(errors.length === 0 ? "no page errors" : errors.join("\n"));
