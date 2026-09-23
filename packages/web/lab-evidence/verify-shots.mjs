/**
 * The /verify pictures: 1440 and 375, dark and light, full page.
 *
 *   node lab-evidence/verify-shots.mjs http://localhost:3446
 *
 * The page is shown connected, as the demo wallet would see it: that wallet
 * runs the verifier the demo credential sale checks, so step 01 shows its real
 * credential and schema and step 03 lists the credentials it has really issued.
 * Only the demo wallet's public address is handed to the page. The injected
 * wallet cannot sign, and nothing is sent. The checker is then run on the first
 * listed wallet, so its verdict is in the picture too.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3446";
const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "..", "..", "..", ".env"));
const demo = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.DEVNET_PAYER_KEYPAIR, "utf8")))
).publicKey;

const browser = await chromium.launch();

for (const theme of ["dark", "light"]) {
  for (const width of [1440, 375]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 1440 ? 900 : 812 },
      deviceScaleFactor: width === 1440 ? 1 : 2,
      colorScheme: theme,
    });
    await context.addInitScript(
      ({ address, publicKey, theme: chosen }) => {
        window.localStorage.setItem("theme", chosen);
        window.localStorage.setItem("walletName", JSON.stringify("Demo Wallet, read only"));
        const account = {
          address,
          publicKey: Uint8Array.from(publicKey),
          chains: ["solana:devnet"],
          features: ["solana:signTransaction"],
        };
        const wallet = {
          version: "1.0.0",
          name: "Demo Wallet, read only",
          icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
          chains: ["solana:devnet"],
          accounts: [],
          features: {
            "standard:connect": {
              version: "1.0.0",
              connect: async () => {
                wallet.accounts = [account];
                return { accounts: wallet.accounts };
              },
            },
            "standard:events": { version: "1.0.0", on: () => () => {} },
            "solana:signTransaction": {
              version: "1.0.0",
              supportedTransactionVersions: ["legacy", 0],
              signTransaction: async () => {
                throw new Error("this wallet only lends its address to the pictures");
              },
            },
          },
        };
        const register = ({ register: add }) => add(wallet);
        window.addEventListener("wallet-standard:app-ready", ({ detail }) => register(detail));
        window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
      },
      { address: demo.toBase58(), publicKey: Array.from(demo.toBytes()), theme }
    );

    const page = await context.newPage();
    await page.goto(`${base}/verify`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await page.locator('[data-testid="verify-pair-credential"]').waitFor({ timeout: 240_000 });
    const rows = page.locator('[data-testid="verify-row"]');
    await page.locator('[data-testid="verify-list-count"]').waitFor({ timeout: 240_000 });

    const listed = await rows.count();
    if (listed > 0) {
      const first = await rows.first().getAttribute("data-wallet");
      await page.locator('[data-testid="verify-check-wallet"]').fill(first);
      await page.locator('[data-testid="verify-check-button"]').click();
      await page.locator('[data-testid="verify-check-result"][data-turn="1"]').waitFor({ timeout: 240_000 });
    }

    // Every reveal is scrolled past once so the full-page picture shows it risen.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((wake) => setTimeout(wake, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1_500);
    const file = `lab-evidence/verify-${theme}-${width}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${file}: ${listed} issued credentials listed`);
    await context.close();
  }
}

await browser.close();
