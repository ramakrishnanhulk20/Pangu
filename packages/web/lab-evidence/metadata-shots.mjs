/**
 * Screenshots and layout checks for the launch page's logo, description and
 * links, without launching anything.
 *
 *   node lab-evidence/metadata-shots.mjs http://127.0.0.1:3480 <mint> <template signature> <sale signature> <metadata uri>
 *
 * Point it at a verification server, never the dev server on 3000.
 *
 * 1. The form, filled as an issuer would with the demo dollar defaults, with
 *    lab-evidence/metadata-logo.png as the logo, at 1440 and 375 in both
 *    themes. At each size the page is measured for anything wider than the
 *    window.
 * 2. The done state for a sale metadata-devnet.mjs already launched, reached
 *    through the page's own resume path: sessionStorage holds that launch's
 *    progress and its stored upload, as a press that lost its page after the
 *    sale landed would leave them. The page fetches the stored logo back from
 *    Irys, and pressing the button reads the sale off devnet. The wallet is
 *    the demo wallet's public key alone, so the page can read a balance; this
 *    script holds no key and the wallet refuses to sign anything.
 */

import { createRequire } from "node:module";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadPool } from "pangu-sdk/dbc";

import { payerKeypair, rpcUrl } from "../../scripts/src/environment.ts";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const [base = "http://127.0.0.1:3480", mint, templateSignature, saleSignature, metadataUri] = process.argv.slice(2);
if (/:3000\b/.test(base)) {
  throw new Error("port 3000 is the running dev server; point this at a verification server");
}

const FORM = {
  name: "Pangu Logo Proof Share",
  symbol: "PLOGO",
  description:
    "A devnet test sale launched from the Pangu launch page to prove the logo, this description and the links are stored on Irys and read back through the mint.",
  website: "https://www.meteora.ag",
  x: "@MeteoraAG",
};

let failures = 0;
function check(label, ok, detail) {
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail === undefined ? "" : `: ${detail}`}`);
}

/**
 * The innermost elements whose right edge passes the window, named by test id
 * or tag and class. The launch section clips its overflow, so the page's own
 * scroll width never shows a column that is too wide; the boxes do.
 */
async function overflow(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const past = (element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.right > width + 1 && getComputedStyle(element).position !== "fixed";
    };
    const wide = [];
    let right = 0;
    for (const element of document.querySelectorAll("[data-testid=launch-page] *")) {
      if (!past(element) || element.closest("svg") !== null) {
        continue;
      }
      right = Math.max(right, Math.round(element.getBoundingClientRect().right));
      if (![...element.children].some(past)) {
        const name = element.getAttribute("data-testid") ?? `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 48)}`;
        wide.push(`${name} "${(element.textContent ?? "").trim().slice(0, 30)}" ${Math.round(element.getBoundingClientRect().right)}px`);
      }
    }
    return { width, right, wide: wide.slice(0, 8) };
  });
}

async function settle(page, theme, width) {
  await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
  await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
  await page.waitForTimeout(900);
}

async function snap(page, testId, path) {
  await page.getByTestId(testId).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo({ left: 0, top: window.scrollY }));
  await page.waitForTimeout(700);
  await page.screenshot({ path });
}

const browser = await chromium.launch();

// The form.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/launch`, { waitUntil: "networkidle", timeout: 120_000 });
  for (const [id, value] of Object.entries({
    "launch-name": FORM.name,
    "launch-symbol": FORM.symbol,
    "launch-description": FORM.description,
    "launch-website": FORM.website,
    "launch-x": FORM.x,
  })) {
    await page.getByTestId(id).fill(value);
  }
  await page.getByTestId("launch-logo").setInputFiles("lab-evidence/metadata-logo.png");
  await page.waitForFunction(() => {
    const image = document.querySelector("[data-testid=launch-identity] img");
    return image !== null && image.complete && image.naturalWidth === 256;
  }, undefined, { timeout: 15_000 });
  await page.getByTestId("launch-storage").filter({ hasText: " SOL" }).waitFor({ timeout: 60_000 });
  await page.addStyleTag({ content: "header.sticky, nextjs-portal { display: none !important }" });

  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 375]) {
      await settle(page, theme, width);
      const measured = await overflow(page);
      check(
        `form, ${theme} ${width}: nothing in the launch page reaches past the window`,
        measured.wide.length === 0,
        measured.wide.length === 0 ? `${measured.width}px` : `reaches ${measured.right}px of ${measured.width}px: ${measured.wide.join(" | ")}`
      );
      await snap(page, "launch-logo-drop", `lab-evidence/metadata-form-${theme}-${width}.png`);
      await snap(page, "launch-identity", `lab-evidence/metadata-preview-${theme}-${width}.png`);
    }
  }

  // A file that is not a picture is refused with a sentence, and the logo box says so.
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("launch-logo").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a logo") });
  const refused = await page.getByTestId("launch-logo-refused").innerText({ timeout: 10_000 });
  check("a text file is refused as a logo", /PNG, JPEG, WEBP or SVG/.test(refused), refused);
  await page.getByTestId("launch-x").fill("https://facebook.com/pangu");
  const xRefusal = await page.getByTestId("launch-refusal-x").first().innerText({ timeout: 10_000 });
  check("a link that is not an X profile is refused", /X link has to be a profile/.test(xRefusal), xRefusal);
  check("no uncaught errors on the form", errors.length === 0, errors.join(" | "));
  await context.close();
}

// A SOL sale's tiny opening price, and a launch with nothing to store.
{
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/launch`, { waitUntil: "networkidle", timeout: 120_000 });
  check("with no logo, description or link the storage step is left out", (await page.getByTestId("launch-step-metadata").count()) === 0);
  check("the logo box says wallets show a blank icon without one", /blank icon/.test(await page.locator("body").innerText()));
  await page.getByTestId("launch-paying-sol").click();
  for (const [id, value] of Object.entries({
    "launch-name": FORM.name,
    "launch-symbol": FORM.symbol,
    "launch-supply": "1000000000",
    "launch-raise": "0.1",
    "launch-kept": "20",
  })) {
    await page.getByTestId(id).fill(value);
  }
  await page.addStyleTag({ content: "header.sticky, nextjs-portal { display: none !important }" });
  for (const theme of ["light", "dark"]) {
    await settle(page, theme, 375);
    const measured = await overflow(page);
    const price = (await page.getByTestId("launch-opening").innerText()).trim();
    const note = await page.getByTestId("launch-opening").locator("xpath=following-sibling::p[1]").innerText();
    console.log(`page says: ${price} / ${note}`);
    check(`SOL sale, ${theme} 375: the opening price is quoted per 1,000 shares`, /1,000 shares/i.test(note));
    check(
      `SOL sale, ${theme} 375: nothing in the launch page reaches past the window`,
      measured.wide.length === 0,
      measured.wide.length === 0 ? `${measured.width}px` : `reaches ${measured.right}px of ${measured.width}px: ${measured.wide.join(" | ")}`
    );
    await snap(page, "launch-opening", `lab-evidence/metadata-sol-price-${theme}-375.png`);
  }
  await page.getByTestId("launch-description").fill("Words only, no logo.");
  await page.getByTestId("launch-step-metadata").waitFor({ timeout: 10_000 });
  check("a description alone brings the storage step back", true);
  check("no uncaught errors on the SOL form", errors.length === 0, errors.join(" | "));
  await context.close();
}

// The done state, through the resume path.
if (mint !== undefined) {
  const connection = new Connection(rpcUrl(), "confirmed");
  const view = await loadPool(connection, new PublicKey(mint));
  const owner = payerKeypair().publicKey.toBase58();
  const progress = {
    form: {
      ...FORM,
      supply: "1000000000",
      paying: "sol",
      raise: "0.1",
      keptBack: "20",
      capPercent: "10",
      access: "open",
      credential: "",
      schema: "",
      band: false,
      feed: "aaplx",
      bandPercent: "5",
      endless: false,
      days: "7",
    },
    curveKey: "replayed",
    config: view.config.toBase58(),
    templateSignature,
    mint,
    pool: view.sale.pool.toBase58(),
    saleSignature,
  };
  const imageUri = JSON.parse(await (await fetch(metadataUri)).text()).image;
  const upload = {
    stored: {
      uri: metadataUri,
      imageUri,
      imageType: "image/png",
      imageSha: "replayed",
      textKey: "replayed",
      priceLamports: 76602,
      fundSignature: null,
      fundLamports: 76602,
    },
    unsentFund: null,
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  let signRequests = 0;
  await context.exposeFunction("__panguRefuse", () => {
    signRequests += 1;
  });
  await context.addInitScript(
    ([name, address, keyBytes, progressText, uploadText]) => {
      window.sessionStorage.setItem(`pangu-launch:${address}`, progressText);
      window.sessionStorage.setItem(`pangu-launch-upload:${address}`, uploadText);
      const account = Object.freeze({
        address,
        publicKey: new Uint8Array(keyBytes),
        chains: ["solana:devnet"],
        features: ["solana:signTransaction", "solana:signMessage"],
      });
      const refuse = async () => {
        await window.__panguRefuse();
        throw new Error("This replay wallet signs nothing.");
      };
      const wallet = {
        version: "1.0.0",
        name,
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iI2M4ZjEzNSIvPjwvc3ZnPg==",
        chains: ["solana:devnet"],
        accounts: [account],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: refuse },
          "solana:signMessage": { version: "1.0.0", signMessage: refuse },
        },
      };
      const register = ({ register: add }) => add(wallet);
      window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
      window.localStorage.setItem("walletName", JSON.stringify(name));
    },
    ["Pangu Test Wallet", owner, Array.from(new PublicKey(owner).toBytes()), JSON.stringify(progress), JSON.stringify(upload)]
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/launch`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByTestId("launch-balance").filter({ hasText: "devnet SOL" }).waitFor({ timeout: 180_000 });
  await page.getByTestId("launch-logo-facts").waitFor({ timeout: 30_000 });
  check(
    "the stored logo comes back from Irys into the logo box after a reload",
    /Already stored by your last try/.test(await page.getByTestId("launch-logo-drop").locator("xpath=..").innerText())
  );
  // The sale itself already landed, so the press only reads it back and the
  // note about using the stored files again would be wrong here.
  check("with the sale already landed the page offers no re-upload note", (await page.getByTestId("launch-upload-kept").count()) === 0);
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-testid=launch-go]");
    return button !== null && !button.disabled && /Check the launch/.test(button.textContent);
  }, undefined, { timeout: 120_000 });
  await page.getByTestId("launch-go").click();
  await page.getByTestId("launch-done").waitFor({ timeout: 180_000 });
  await page.waitForFunction(() => {
    const image = document.querySelector("[data-testid=launch-done-logo] img");
    return image !== null && image.complete && image.naturalWidth === 256;
  }, undefined, { timeout: 30_000 });
  check("the done state shows the sale read back from devnet", (await page.getByTestId("launch-done").getAttribute("data-mint")) === mint);
  check("the done state's logo is the one the mint's link names", (await page.getByTestId("launch-done-logo").locator("img").getAttribute("src")) === imageUri, imageUri);
  check("nothing was signed on the way", signRequests === 0, String(signRequests));
  await page.addStyleTag({ content: "header.sticky, nextjs-portal { display: none !important }" });
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 375]) {
      await settle(page, theme, width);
      await snap(page, "launch-done", `lab-evidence/metadata-done-${theme}-${width}.png`);
    }
  }
  check("no uncaught errors on the done state", errors.length === 0, errors.join(" | "));
  await context.close();
}

await browser.close();
console.log("");
console.log(failures === 0 ? "every check passed" : `${failures} checks failed`);
process.exit(failures === 0 ? 0 : 1);
