/**
 * Launches two real sales on devnet from the launch page, the way an issuer
 * would, and reads every term back off the chain.
 *
 *   node lab-evidence/test-wallet.mjs http://127.0.0.1:3460
 *
 * Point it at a verification server, never the dev server on 3000.
 *
 * The browser is headless Chromium with a Wallet Standard wallet injected by
 * an init script, so the page's own wallet adapter finds it the way it finds
 * Phantom. The wallet holds no key: every signature is asked of this process
 * through page.exposeFunction, and a throwaway Keypair made here signs. Its
 * secret never enters the page and is never printed or written.
 *
 * The throwaway is funded with 0.1 devnet SOL from the demo wallet, whose key
 * the scripts package loads from the path in .env, and with demo dollars from
 * the app's own demo dollar route. What is left is sent back at the end.
 *
 *   1. demo dollar, open access, 5 percent ceiling on AAPLx, cap 10 percent,
 *      14 days, with lab-evidence/metadata-logo.png as its logo and a
 *      description, so the logo and the JSON are stored on Irys first. The
 *      wallet signs those two files as messages.
 *   2. devnet SOL, approved list, no ceiling, no end, and no logo, description
 *      or link, so the storage step is left out and the mint's metadata link
 *      is empty. Its sale signature is refused once on purpose, then Launch is
 *      pressed again and the run checks the template from the first press was
 *      reused, not remade.
 *
 * `--second-only` runs launch 2 alone.
 *
 * Neither sale is added to packages/scripts/sales.json.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { ACCESS_MODE, PANGU_PROGRAM_ID, getSale, saleTokenInfo } from "pangu-sdk";
import { capFromShare, loadPool } from "pangu-sdk/dbc";

import { builtCurve } from "../lib/launch-curve.ts";
import { payerKeypair, rpcUrl } from "../../scripts/src/environment.ts";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");
const nacl = require("tweetnacl");
const LOGO_PATH = "lab-evidence/metadata-logo.png";

const base = process.argv[2] ?? "http://127.0.0.1:3460";
// Runs launch 2 alone, for when launch 1 already passed and a later step was
// cut short by the network, rather than opening a third sale.
const secondOnly = process.argv.includes("--second-only");
if (/:3000\b/.test(base)) {
  throw new Error("port 3000 is Ram's dev server; point this at a verification server");
}

const WALLET_NAME = "Pangu Test Wallet";
const FUND_SOL = 0.1;
const DEMO_DOLLAR = "2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5";
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const AAPLX_FEED = "978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675";
const LAUNCH_TIMEOUT_MS = 6 * 60 * 1000;

// Reads and the funding go through the keyed endpoint when .env names one. It
// is never printed.
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

/**
 * This machine's line to devnet drops connections now and then, so every read
 * is tried again a few times before the run gives up on it.
 */
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

async function chainNow() {
  const info = await retry("reading the clock", () => connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed"));
  return Number(Buffer.from(info.data).readBigInt64LE(32));
}

async function sol(address) {
  return (await retry("reading a balance", () => connection.getBalance(new PublicKey(address), "confirmed"))) / LAMPORTS_PER_SOL;
}

/**
 * Sends a transfer and waits for it by asking for its status, never by a
 * blockhash timer alone: a transfer that outlives its timer can still land,
 * and the first run of this script lost 0.1 SOL to a throwaway that way.
 */
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

console.log(`network  : devnet`);
console.log(`program  : ${PANGU_PROGRAM_ID.toBase58()}`);
console.log(`site     : ${base}/launch`);
console.log(`issuer   : ${owner}, a throwaway made for this run`);

// Funding. The demo key is copied into this package's web3 class and used for
// the one transfer; nothing about it is printed but its public key.
{
  const payer = Keypair.fromSecretKey(payerKeypair().secretKey);
  const signature = await transfer(payer, throwaway.publicKey, Math.round(FUND_SOL * LAMPORTS_PER_SOL));
  console.log(`funded   : ${FUND_SOL} SOL from the demo wallet ${payer.publicKey.toBase58()}`);
  console.log(`           https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}
{
  const answer = await fetch(`${base}/api/break/dollars`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: owner }),
  });
  const body = await answer.json();
  console.log(
    answer.ok
      ? `dollars  : ${Number(body.amount) / 10 ** body.decimals} demo dollars of ${body.mint}, https://explorer.solana.com/tx/${body.signature}?cluster=devnet`
      : `dollars  : the route answered ${answer.status}: ${body.reason}`
  );
  check("demo dollars granted through the app's route", answer.ok && body.mint === DEMO_DOLLAR);
}

// The wallet, in Node. The page hands over serialized transactions and gets
// them back signed. `rejectSale` turns down the next transaction that calls
// Pangu, which is the sale step, exactly as a person pressing Reject would.
let rejectSale = false;
let signRequests = 0;
async function signInNode(encoded) {
  signRequests += 1;
  const signed = [];
  for (const text of encoded) {
    const transaction = Transaction.from(Buffer.from(text, "base64"));
    const callsPangu = transaction.instructions.some((instruction) => instruction.programId.equals(PANGU_PROGRAM_ID));
    if (callsPangu && rejectSale) {
      rejectSale = false;
      throw new Error("User rejected the request.");
    }
    transaction.partialSign(throwaway);
    signed.push(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"));
  }
  return signed;
}

/** Irys has each stored file signed as a message; the signature goes back as a string of byte values. */
let messageRequests = 0;
async function signMessageInNode(encoded) {
  messageRequests += 1;
  return nacl.sign.detached(Buffer.from(encoded, "base64"), throwaway.secretKey).reduce((text, byte) => text + String.fromCharCode(byte), "");
}

/**
 * Runs inside the page before any of its scripts. It registers a Wallet
 * Standard wallet the adapter lists beside the injected ones, and every
 * signature it gives is asked of this process.
 */
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

async function open() {
  await page.goto(`${base}/launch`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByTestId("launch-go").waitFor({ timeout: 60_000 });
  await page.getByTestId("launch-balance").filter({ hasText: "devnet SOL" }).waitFor({ timeout: 180_000 });
}

async function fill(values) {
  for (const [id, value] of Object.entries(values)) {
    await page.getByTestId(id).fill(value);
  }
}

async function press() {
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-testid=launch-go]");
    return button !== null && !button.disabled;
  }, undefined, { timeout: 150_000 });
  await page.getByTestId("launch-go").click();
}

/**
 * Waits for the done state or a failed step. A failure the driver did not ask
 * for, such as devnet dropping a read, is logged and Launch is pressed again,
 * which is the page's own resume path; every retry is printed.
 */
async function landed(label) {
  for (let round = 1; round <= 4; round += 1) {
    const result = await outcome();
    if (result.mint !== undefined || round === 4) {
      return result;
    }
    console.log(`retry    : ${label} stopped on its own (${result.step}): ${result.failure.replace(/\n+/g, " / ")}`);
    await press();
  }
  return outcome();
}

/** Waits for the done state or a failed step, whichever comes first. */
async function outcome() {
  await page.waitForSelector("[data-testid=launch-done], [data-testid^=launch-failure-]", { timeout: LAUNCH_TIMEOUT_MS });
  const done = page.getByTestId("launch-done");
  if ((await done.count()) > 0) {
    return { mint: await done.getAttribute("data-mint"), text: await done.innerText() };
  }
  const failed = page.locator("[data-testid^=launch-failure-]").first();
  return { failure: await failed.innerText(), step: await failed.getAttribute("data-testid") };
}

async function stepStatus(id) {
  return page.getByTestId(`launch-step-${id}`).getAttribute("data-status");
}

/** Reads the sale and its template off the chain and holds each term to what the form asked for. */
async function readBack(label, mint, wanted, launchedAt) {
  const sale = await getSale(connection, new PublicKey(mint));
  check(`${label}: the sale's rules read back from devnet`, sale !== null);
  if (sale === null) {
    return null;
  }
  const view = await loadPool(connection, new PublicKey(mint));
  const config = view.configState;
  const built = builtCurve(wanted.shape);

  check(`${label}: issuer is the throwaway wallet`, sale.issuer.toBase58() === owner, sale.issuer.toBase58());
  check(`${label}: paid in ${wanted.quoteName}`, config.quoteMint.toBase58() === wanted.quoteMint, config.quoteMint.toBase58());
  check(`${label}: sale records the same paying token`, sale.quoteMint?.toBase58() === wanted.quoteMint);
  check(
    `${label}: tokens on the curve match ${wanted.shape.supply} shares, ${wanted.shape.threshold} to raise, ${wanted.shape.migrationPercent} percent kept`,
    BigInt(config.swapBaseAmount.toString()) === built.swapBaseAmount,
    config.swapBaseAmount.toString()
  );
  const cap = capFromShare(BigInt(config.swapBaseAmount.toString()), wanted.capPercent * 100);
  check(`${label}: cap is ${wanted.capPercent} percent of the curve`, sale.cap === cap, `${sale.cap} raw units`);
  check(`${label}: access is ${wanted.accessName}`, sale.accessMode === wanted.accessMode, String(sale.accessMode));
  if (wanted.bandBps === null) {
    check(`${label}: no price ceiling`, !sale.hasBand);
  } else {
    check(`${label}: ceiling ${wanted.bandBps / 100} percent`, sale.hasBand && sale.bandBps === wanted.bandBps, String(sale.bandBps));
    check(`${label}: ceiling follows AAPLx`, sale.priceFeedId === wanted.feedId, sale.priceFeedId);
  }
  if (wanted.days === null) {
    check(`${label}: no end to the offering`, sale.endsAt === null, String(sale.endsAt));
  } else {
    const expected = launchedAt + wanted.days * 86_400;
    // The end is counted from the chain clock when the sale step was built,
    // which is between the two chain readings this run took around it.
    const ok = sale.endsAt !== null && sale.endsAt >= expected - 5 && sale.endsAt <= (await chainNow()) + wanted.days * 86_400 + 5;
    check(`${label}: offering ends ${wanted.days} days after launch`, ok, sale.endsAt === null ? "none" : new Date(sale.endsAt * 1000).toISOString());
  }
  return { sale, view, config };
}

let firstMint = null;
let secondMint = null;

try {
// Launch 1.
if (!secondOnly) {
await open();
await page.getByTestId("launch-band-on").click();
await page.getByTestId("launch-feed-aaplx").click();
await fill({
  "launch-name": "Pangu Launch Page Share",
  "launch-symbol": "PLAUNCH",
  "launch-supply": "20",
  "launch-raise": "3710",
  "launch-kept": "45",
  "launch-cap": "10",
  "launch-days": "14",
  "launch-band-percent": "5",
  "launch-description": "A devnet test sale launched from the Pangu launch page, with a logo stored on Irys.",
});
await page.getByTestId("launch-logo").setInputFiles(LOGO_PATH);
await page.getByTestId("launch-logo-facts").waitFor({ timeout: 20_000 });
check("launch 1: the storage step is listed", (await page.getByTestId("launch-step-metadata").count()) === 1);
await page.getByTestId("launch-stock").waitFor({ timeout: 150_000 });
console.log("");
console.log("launch 1 : PLAUNCH, demo dollar, open, 5 percent over AAPLx, cap 10 percent, 14 days");
console.log(`preview  : opens at ${await page.getByTestId("launch-opening").innerText()}, ${await page.getByTestId("launch-stock").innerText()}`);
const before1 = await sol(owner);
const clock1 = await chainNow();
await press();
const first = await landed("launch 1");
check("launch 1 reached the done state", first.mint !== undefined, first.failure);
if (first.mint !== undefined) {
  firstMint = first.mint;
  const spent1 = before1 - (await sol(owner));
  console.log(`mint     : ${firstMint}`);
  console.log(`           https://explorer.solana.com/address/${firstMint}?cluster=devnet`);
  for (const line of first.text.split("\n").filter((line) => /cost|SOL/i.test(line))) {
    console.log(`page says: ${line}`);
  }
  console.log(`cost     : ${spent1.toFixed(6)} SOL, the wallet's balance read off devnet before and after`);
  await readBack("launch 1", firstMint, {
    shape: { quoteDecimals: 6, baseDecimals: 9, supply: 20, migrationPercent: 45, threshold: 3710 },
    quoteMint: DEMO_DOLLAR,
    quoteName: "the demo dollar",
    capPercent: 10,
    accessMode: ACCESS_MODE.open,
    accessName: "open",
    bandBps: 500,
    feedId: AAPLX_FEED,
    days: 14,
  }, clock1);
  check("launch 1: the wallet signed the logo and the JSON as messages", messageRequests === 2, String(messageRequests));
  const token1 = await retry("reading launch 1's metadata", () => saleTokenInfo(connection, new PublicKey(firstMint)));
  console.log(`uri      : ${token1?.uri}`);
  const json1 = token1 === null || token1.uri === "" ? null : await (await fetch(token1.uri)).json();
  check("launch 1: the mint's link loads JSON naming the token", json1?.name === "Pangu Launch Page Share" && json1?.symbol === "PLAUNCH");
  const picture = json1?.image === undefined ? null : Buffer.from(await (await fetch(json1.image)).arrayBuffer());
  check(
    "launch 1: the JSON's image is the logo the form was given",
    picture !== null && picture.equals(readFileSync(LOGO_PATH)),
    json1?.image
  );
  await page.waitForFunction(() => {
    const image = document.querySelector("[data-testid=launch-done-logo] img");
    return image !== null && image.complete && image.naturalWidth > 0;
  }, undefined, { timeout: 30_000 });
  check("launch 1: the done state shows the logo", true);

  // The done state, in both themes at both widths. The theme is switched on
  // the attribute next-themes writes, so the launch result stays on screen.
  await page.addStyleTag({ content: "header.sticky, nextjs-portal { display: none !important }" });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
      await page.waitForTimeout(800);
      await page.getByTestId("launch-done").scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `lab-evidence/launch-done-${theme}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
}

// Launch 2, with the sale signature refused once.
await open();
await page.getByTestId("launch-paying-sol").click();
await page.getByTestId("launch-access-list").click();
await page.getByTestId("launch-end-none").click();
await fill({
  "launch-name": "Pangu Launch Page List",
  "launch-symbol": "PLAUNCHL",
  "launch-supply": "1000000000",
  "launch-raise": "0.1",
  "launch-kept": "20",
  "launch-cap": "10",
});
check("launch 2: with nothing to store the storage step is left out", (await page.getByTestId("launch-step-metadata").count()) === 0);
console.log("");
console.log("launch 2 : PLAUNCHL, devnet SOL, approved list, no ceiling, no end, no logo, description or link");
const before2 = await sol(owner);
const clock2 = await chainNow();
rejectSale = true;
const requestsBefore = signRequests;
await press();
const refused = await outcome();
check("launch 2, first press: the sale step stops when the wallet turns it down", refused.step === "launch-failure-sale", refused.step ?? "done");
check("launch 2, first press: the template landed before it", (await stepStatus("template")) === "done");
console.log(`page says: ${(refused.failure ?? "").replace(/\n+/g, " / ")}`);
const saved = await page.evaluate((key) => window.sessionStorage.getItem(key), `pangu-launch:${owner}`);
const firstPressConfig = saved === null ? null : JSON.parse(saved).config;
check("launch 2, first press: sessionStorage holds the template's address and no secret", saved !== null && firstPressConfig !== null && !/secret/i.test(saved));
check("launch 2, first press: the button now offers to finish", (await page.getByTestId("launch-go").innerText()).includes("Finish"));
await page.getByTestId("launch-resume").waitFor({ timeout: 10_000 });

await press();
await page.waitForSelector("[data-testid=launch-step-template][data-status=reused]", { timeout: LAUNCH_TIMEOUT_MS });
check("launch 2, second press: the template step says reused", true);
const second = await landed("launch 2");
check("launch 2 reached the done state on the second press", second.mint !== undefined, second.failure);
check(
  "launch 2: the wallet was asked three times in all, template, refused sale, sale",
  signRequests - requestsBefore === 3,
  String(signRequests - requestsBefore)
);
if (second.mint !== undefined) {
  secondMint = second.mint;
  const spent2 = before2 - (await sol(owner));
  console.log(`mint     : ${secondMint}`);
  console.log(`           https://explorer.solana.com/address/${secondMint}?cluster=devnet`);
  console.log(`cost     : ${spent2.toFixed(6)} SOL across both presses, the refused one included`);
  const read = await readBack("launch 2", secondMint, {
    shape: { quoteDecimals: 9, baseDecimals: 6, supply: 1_000_000_000, migrationPercent: 20, threshold: 0.1 },
    quoteMint: WRAPPED_SOL,
    quoteName: "wrapped SOL",
    capPercent: 10,
    accessMode: ACCESS_MODE.issuerList,
    accessName: "the issuer's list",
    bandBps: null,
    days: null,
  }, clock2);
  const token2 = await retry("reading launch 2's metadata", () => saleTokenInfo(connection, new PublicKey(secondMint)));
  check("launch 2: the mint's metadata link is empty", token2 !== null && token2.uri === "", JSON.stringify(token2?.uri));
  check(
    "launch 2: the done state says the token launched without a logo",
    /launched without a logo/i.test(await page.getByTestId("launch-done-metadata").innerText())
  );
  if (read !== null) {
    check(
      "launch 2: the pool was opened on the template the first press made, so it was reused",
      read.view.config.toBase58() === firstPressConfig,
      read.view.config.toBase58()
    );
  }
}

check("no uncaught errors on the page", pageErrors.length === 0, pageErrors.join(" | "));
} catch (error) {
  failures += 1;
  console.log(`FAIL  the run stopped: ${said(error)}`);
} finally {
  await browser.close();
  // Whatever SOL is left goes back to the demo wallet, whether the run passed or not.
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
console.log(`${failures === 0 ? "every check passed" : `${failures} checks failed`}; mints ${firstMint} and ${secondMint}; neither is in sales.json`);
process.exit(failures === 0 ? 0 : 1);
