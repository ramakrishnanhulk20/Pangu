/**
 * Launches one real sale on devnet from the launch page with a logo, a
 * description and two links, then reads the mint's metadata link back off
 * the chain, fetches it, and holds every field and the logo's bytes to what
 * the form was given.
 *
 *   node lab-evidence/metadata-devnet.mjs http://127.0.0.1:3480
 *
 * Point it at a verification server, never the dev server on 3000.
 *
 * The wallet is the one lab-evidence/test-wallet.mjs injects, a Wallet
 * Standard wallet whose every signature is asked of this process, with message
 * signing added because Irys has each stored file signed as a message. A
 * throwaway Keypair made here signs. Its secret never enters the page and is
 * never printed or written.
 *
 * The throwaway is funded with 0.1 devnet SOL from the demo wallet, whose key
 * the scripts package loads from the path in .env; what is left is sent back
 * at the end. The logo is a 256 px PNG drawn by this script, saved as
 * lab-evidence/metadata-logo.png.
 *
 * Screenshots: the form with the logo at 1440 and 375 in both themes, and the
 * done state the same way.
 *
 * The sale is not added to packages/scripts/sales.json.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { PANGU_PROGRAM_ID, getSale, saleTokenInfo } from "pangu-sdk";

import { payerKeypair, rpcUrl } from "../../scripts/src/environment.ts";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");
const nacl = require("tweetnacl");

const base = process.argv[2] ?? "http://127.0.0.1:3480";
if (/:3000\b/.test(base)) {
  throw new Error("port 3000 is the running dev server; point this at a verification server");
}

const WALLET_NAME = "Pangu Test Wallet";
const FUND_SOL = 0.1;
const IRYS_NODE = "https://devnet.irys.xyz";
const LAUNCH_TIMEOUT_MS = 8 * 60 * 1000;
const LOGO_PATH = "lab-evidence/metadata-logo.png";

const FORM = {
  name: "Pangu Logo Proof Share",
  symbol: "PLOGO",
  description:
    "A devnet test sale launched from the Pangu launch page to prove the logo, this description and the links are stored on Irys and read back through the mint.",
  website: "https://www.meteora.ag",
  x: "@MeteoraAG",
};

const connection = new Connection(rpcUrl(), "confirmed");
const throwaway = Keypair.generate();
const owner = throwaway.publicKey.toBase58();

let failures = 0;
function check(label, ok, detail) {
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail === undefined ? "" : `: ${detail}`}`);
}

/** An error as text with any endpoint cut out, since the keyed one carries its key. */
function said(error) {
  const text = error instanceof Error ? `${error.name}: ${error.message} ${error.cause?.code ?? ""}` : String(error);
  return text.replace(/https?:\/\/\S+/g, "<endpoint>").replace(/[a-z0-9-]+\.[a-z0-9.-]*quiknode\.pro\S*/gi, "<endpoint>");
}

async function retry(what, read) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      last = error;
      await new Promise((wake) => setTimeout(wake, 3_000));
    }
  }
  throw new Error(`${what} failed six times: ${said(last)}`);
}

async function sol(address) {
  return (await retry("reading a balance", () => connection.getBalance(new PublicKey(address), "confirmed"))) / LAMPORTS_PER_SOL;
}

/** Sends a transfer and waits for its status, never for a blockhash timer alone. */
async function transfer(from, to, lamports) {
  const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await retry("reading a blockhash", () => connection.getLatestBlockhash("confirmed"));
    transaction.recentBlockhash = latest.blockhash;
    transaction.feePayer = from.publicKey;
    transaction.signatures = [];
    transaction.sign(from);
    const signature = await retry("sending a transfer", () =>
      connection.sendRawTransaction(transaction.serialize(), { maxRetries: 5 })
    );
    for (let poll = 0; poll < 90; poll += 1) {
      const status = await retry("reading a status", () =>
        connection.getSignatureStatus(signature, { searchTransactionHistory: true })
      );
      if (status.value !== null && status.value.err === null && status.value.confirmationStatus !== "processed") {
        return signature;
      }
      if (status.value !== null && status.value.err !== null) {
        throw new Error(`the transfer failed on chain: ${JSON.stringify(status.value.err)}`);
      }
      const height = await retry("reading the block height", () => connection.getBlockHeight("confirmed"));
      if (status.value === null && height > latest.lastValidBlockHeight) {
        break;
      }
      await new Promise((wake) => setTimeout(wake, 2_000));
    }
  }
  throw new Error("the transfer never landed after three tries");
}

/** A 256 px PNG: the site's lime disc on near black, with a darker band through it, drawn pixel by pixel. */
function drawLogo() {
  const size = 256;
  const table = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c;
  });
  const crc = (bytes) => {
    let c = -1;
    for (const byte of bytes) {
      c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    }
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      const dx = x - 128;
      const dy = y - 128;
      const inside = dx * dx + dy * dy < 96 * 96;
      const band = Math.abs(dy + dx * 0.35) < 14;
      const [r, g, b] = inside ? (band ? [20, 20, 15] : [200, 241, 53]) : [11, 11, 10];
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const logoBytes = drawLogo();
writeFileSync(LOGO_PATH, logoBytes);
const logoSha = createHash("sha256").update(logoBytes).digest("hex");

console.log(`network  : devnet`);
console.log(`program  : ${PANGU_PROGRAM_ID.toBase58()}`);
console.log(`site     : ${base}/launch`);
console.log(`storage  : ${IRYS_NODE}, Irys's devnet node, keeps files about 60 days`);
console.log(`issuer   : ${owner}, a throwaway made for this run`);
console.log(`logo     : ${LOGO_PATH}, 256 x 256 PNG, ${logoBytes.length} bytes, sha256 ${logoSha}`);

{
  const payer = Keypair.fromSecretKey(payerKeypair().secretKey);
  const signature = await transfer(payer, throwaway.publicKey, Math.round(FUND_SOL * LAMPORTS_PER_SOL));
  console.log(`funded   : ${FUND_SOL} SOL from the demo wallet ${payer.publicKey.toBase58()}`);
  console.log(`           https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

let signRequests = 0;
let messageRequests = 0;
async function signInNode(encoded) {
  signRequests += 1;
  const signed = [];
  for (const text of encoded) {
    const transaction = Transaction.from(Buffer.from(text, "base64"));
    transaction.partialSign(throwaway);
    signed.push(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"));
  }
  return signed;
}
async function signMessageInNode(encoded) {
  messageRequests += 1;
  return nacl.sign.detached(Buffer.from(encoded, "base64"), throwaway.secretKey).reduce((text, byte) => text + String.fromCharCode(byte), "");
}

/** Runs inside the page before its scripts: a Wallet Standard wallet that signs transactions and messages through this process. */
function injectWallet([name, address, keyBytes]) {
  const toBase64 = (bytes) => {
    let text = "";
    for (const byte of bytes) {
      text += String.fromCharCode(byte);
    }
    return btoa(text);
  };
  const fromBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
  const account = Object.freeze({
    address,
    publicKey: new Uint8Array(keyBytes),
    chains: ["solana:devnet"],
    features: ["solana:signTransaction", "solana:signMessage"],
  });
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
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs) => {
          const signed = await window.__panguTestSign(inputs.map((input) => toBase64(input.transaction)));
          return signed.map((text) => ({ signedTransaction: fromBase64(text) }));
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs) =>
          Promise.all(
            inputs.map(async (input) => {
              const raw = await window.__panguTestSignMessage(toBase64(input.message));
              return { signedMessage: input.message, signature: Uint8Array.from(raw, (character) => character.charCodeAt(0)) };
            })
          ),
      },
    },
  };
  const register = ({ register: add }) => add(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  window.localStorage.setItem("walletName", JSON.stringify(name));
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
await context.exposeFunction("__panguTestSign", signInNode);
await context.exposeFunction("__panguTestSignMessage", signMessageInNode);
await context.addInitScript(injectWallet, [WALLET_NAME, owner, Array.from(throwaway.publicKey.toBytes())]);
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

async function press() {
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-testid=launch-go]");
    return button !== null && !button.disabled;
  }, undefined, { timeout: 150_000 });
  await page.getByTestId("launch-go").click();
}

async function outcome() {
  await page.waitForSelector("[data-testid=launch-done], [data-testid^=launch-failure-]", { timeout: LAUNCH_TIMEOUT_MS });
  const done = page.getByTestId("launch-done");
  if ((await done.count()) > 0) {
    return { mint: await done.getAttribute("data-mint"), text: await done.innerText() };
  }
  const failed = page.locator("[data-testid^=launch-failure-]").first();
  return { failure: await failed.innerText(), step: await failed.getAttribute("data-testid") };
}

/** A failure the driver did not ask for is logged and Launch pressed again, the page's own resume path. */
async function landed() {
  for (let round = 1; round <= 4; round += 1) {
    const result = await outcome();
    if (result.mint !== undefined || round === 4) {
      return result;
    }
    console.log(`retry    : stopped on its own (${result.step}): ${result.failure.replace(/\n+/g, " / ")}`);
    await press();
  }
  return outcome();
}

async function shoot(name, locator) {
  await page.addStyleTag({ content: "header.sticky, nextjs-portal { display: none !important }" });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
      await page.waitForTimeout(900);
      await locator().scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `lab-evidence/metadata-${name}-${theme}-${width}.png` });
    }
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function fetchJson(uri) {
  const answer = await fetch(uri, { redirect: "follow" });
  return { status: answer.status, type: answer.headers.get("content-type"), body: await answer.text() };
}

let mint = null;
try {
  await page.goto(`${base}/launch`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByTestId("launch-go").waitFor({ timeout: 60_000 });
  await page.getByTestId("launch-balance").filter({ hasText: "devnet SOL" }).waitFor({ timeout: 180_000 });

  await page.getByTestId("launch-paying-sol").click();
  for (const [id, value] of Object.entries({
    "launch-name": FORM.name,
    "launch-symbol": FORM.symbol,
    "launch-description": FORM.description,
    "launch-website": FORM.website,
    "launch-x": FORM.x,
    "launch-supply": "1000000000",
    "launch-raise": "0.1",
    "launch-kept": "20",
    "launch-cap": "10",
    "launch-days": "7",
  })) {
    await page.getByTestId(id).fill(value);
  }
  await page.getByTestId("launch-logo").setInputFiles(LOGO_PATH);
  await page.getByTestId("launch-logo-facts").waitFor({ timeout: 20_000 });
  console.log(`page says: ${(await page.getByTestId("launch-logo-facts").innerText()).trim()}`);
  // The preview swaps the site's mark out before the logo comes in, so the
  // check waits for the swap rather than reading the first frame.
  const previewShown = await page
    .waitForFunction(
      (name) => {
        const element = document.querySelector("[data-testid=launch-identity]");
        const image = element?.querySelector("img");
        return image != null && image.complete && image.naturalWidth === 256 && element.textContent.includes(name);
      },
      FORM.name,
      { timeout: 15_000 }
    )
    .then(() => true, () => false);
  check("the preview shows the logo beside the name", previewShown);
  await page.getByTestId("launch-storage").filter({ hasText: " SOL" }).waitFor({ timeout: 60_000 });
  const priced = (await page.getByTestId("launch-step-metadata-cost").innerText()).trim();
  const storageLine = (await page.getByTestId("launch-storage").innerText()).split("\n").find((line) => / SOL/.test(line));
  console.log(`page says: ${storageLine}`);
  console.log(`page says: ${priced}`);

  await shoot("form", () => page.getByTestId("launch-logo-drop"));
  await shoot("preview", () => page.getByTestId("launch-identity"));

  const before = await sol(owner);
  console.log("");
  console.log(`launch   : ${FORM.symbol}, devnet SOL, open, cap 10 percent, 7 days, logo, description, website and X`);
  await press();
  const result = await landed();
  check("the launch reached the done state", result.mint !== undefined, result.failure);
  if (result.mint !== undefined) {
    mint = result.mint;
    const spent = before - (await sol(owner));
    console.log(`mint     : ${mint}`);
    console.log(`           https://explorer.solana.com/address/${mint}?cluster=devnet`);
    console.log(`cost     : ${spent.toFixed(6)} SOL for the whole launch, storage included, read off devnet before and after`);
    console.log(`asked    : ${signRequests} transaction signatures, ${messageRequests} message signatures`);
    check("the wallet signed two files as messages", messageRequests === 2, String(messageRequests));

    const links = await page.getByTestId("launch-done").locator("a").evaluateAll((anchors) =>
      anchors.map((anchor) => ({ text: anchor.textContent.trim(), href: anchor.href }))
    );
    for (const link of links) {
      if (/tx\/|irys/.test(link.href)) {
        console.log(`link     : ${link.text}: ${link.href}`);
      }
    }

    const fund = links.find((link) => link.text === "payment to Irys");
    if (fund !== undefined) {
      const signature = /tx\/([1-9A-HJ-NP-Za-km-z]+)/.exec(fund.href)[1];
      const detail = await retry("reading the Irys payment", () =>
        connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      );
      const keys = detail.transaction.message.getAccountKeys().staticAccountKeys.map((key) => key.toBase58());
      const irysAddress = (await (await fetch(`${IRYS_NODE}/info`)).json()).addresses.solana;
      const to = keys.indexOf(irysAddress);
      const paid = to < 0 ? null : detail.meta.postBalances[to] - detail.meta.preBalances[to];
      console.log(`irys     : ${paid} lamports to Irys's devnet address ${irysAddress}, fee ${detail.meta.fee} lamports`);
      check("the payment went to the Irys devnet node's own address", paid !== null && paid > 0);
    } else {
      console.log("irys     : no payment this run; the Irys balance already covered it");
    }
    const irysLeft = (await (await fetch(`${IRYS_NODE}/account/balance/solana?address=${owner}`)).json()).balance;
    console.log(`irys     : ${irysLeft} lamports left in the throwaway's Irys balance after both uploads`);

    // The round trip: the chain, then the link it carries, then the picture that link names.
    const sale = await retry("reading the sale", () => getSale(connection, new PublicKey(mint)));
    check("the sale's rules read back from devnet", sale !== null && sale.issuer.toBase58() === owner);
    const token = await retry("reading the mint's metadata", () => saleTokenInfo(connection, new PublicKey(mint)));
    check("the mint carries a metadata link", token !== null && token.uri !== "", token?.uri);
    if (token !== null) {
      console.log(`uri      : ${token.uri}`);
      check("the mint's name is the form's", token.name === FORM.name, token.name);
      check("the mint's symbol is the form's", token.symbol === FORM.symbol, token.symbol);
      check("the link is on Irys's devnet node", token.uri.startsWith(`${IRYS_NODE}/`));
      const json = await fetchJson(token.uri);
      check("the link loads as JSON", json.status === 200 && /json/.test(json.type ?? ""), `${json.status} ${json.type}`);
      const body = JSON.parse(json.body);
      console.log(`json     : ${json.body}`);
      check("json name", body.name === FORM.name);
      check("json symbol", body.symbol === FORM.symbol);
      check("json description", body.description === FORM.description);
      check("json external_url is the website", body.external_url === "https://www.meteora.ag/", body.external_url);
      check("json extensions carry the website and the X profile", body.extensions?.website === "https://www.meteora.ag/" && body.extensions?.twitter === "https://x.com/MeteoraAG", JSON.stringify(body.extensions));
      check("json image is on Irys", typeof body.image === "string" && body.image.startsWith(`${IRYS_NODE}/`), body.image);
      check("json properties.files names the image as a PNG", body.properties?.files?.[0]?.uri === body.image && body.properties.files[0].type === "image/png");
      check("json properties.category is image", body.properties?.category === "image");
      const picture = await fetch(body.image, { redirect: "follow" });
      const pictureBytes = Buffer.from(await picture.arrayBuffer());
      console.log(`image    : ${body.image}, ${picture.status} ${picture.headers.get("content-type")}, ${pictureBytes.length} bytes`);
      check("the stored logo is the exact PNG the form was given", createHash("sha256").update(pictureBytes).digest("hex") === logoSha);
      check("the stored logo is served as image/png", picture.headers.get("content-type") === "image/png");

      const shown = await page.getByTestId("launch-done-logo").locator("img").evaluate((image) => ({
        src: image.getAttribute("src"),
        alt: image.alt,
        width: image.naturalWidth,
      }));
      check("the done state shows the logo from the mint's link", shown.src === body.image && shown.width === 256, `${shown.src} ${shown.width}px`);
      check("the done state's logo carries the token name as alt text", shown.alt === FORM.name);
      check("the done state says the logo came back through the mint", /read back through the link the mint carries/i.test(await page.getByTestId("launch-done-metadata").innerText()));
      check("the done state shows the description from the JSON", (await page.getByTestId("launch-done-description").innerText()).trim() === FORM.description);
    }
    const stored = await page.evaluate((key) => [window.sessionStorage.getItem(`pangu-launch:${key}`), window.sessionStorage.getItem(`pangu-launch-upload:${key}`)], owner);
    check("sessionStorage is cleared after the launch", stored[0] === null && stored[1] === null);

    await shoot("done", () => page.getByTestId("launch-done"));
  }
  check("no uncaught errors on the page", pageErrors.length === 0, pageErrors.join(" | "));
} catch (error) {
  failures += 1;
  console.log(`FAIL  the run stopped: ${said(error)}`);
} finally {
  await browser.close();
  try {
    const left = await retry("reading the throwaway's balance", () => connection.getBalance(throwaway.publicKey, "confirmed"));
    const back = left - 5_000;
    if (back > 0) {
      await transfer(throwaway, new PublicKey(payerKeypair().publicKey.toBase58()), back);
      console.log("");
      console.log(`returned : ${(back / LAMPORTS_PER_SOL).toFixed(6)} SOL to the demo wallet`);
    }
  } catch (error) {
    failures += 1;
    console.log(`FAIL  could not return the throwaway's SOL: ${said(error)}`);
  }
}

console.log("");
console.log(`${failures === 0 ? "every check passed" : `${failures} checks failed`}; mint ${mint}; not in sales.json`);
process.exit(failures === 0 ? 0 : 1);
