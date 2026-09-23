/**
 * Proves /portfolio against devnet, from the pages themselves.
 *
 *   node lab-evidence/portfolio-devnet.mjs http://127.0.0.1:3471 <scratch folder>
 *
 * Needs a server of this app answering at the address given, never the dev
 * server on 3000, and the repository root .env with DEVNET_PAYER_KEYPAIR (the
 * demo wallet, issuer of the demo sales) and DEVNET_RPC_URL. Neither key nor
 * endpoint is printed.
 *
 * 1. A throwaway wallet is made and funded with 0.05 devnet SOL from the demo
 *    wallet. Its secret is written to the scratch folder, outside the repo,
 *    until its SOL is swept back, then deleted.
 * 2. Demo dollars from the app's own route, asked once more after 30 seconds
 *    if devnet refuses the mint, then a buy on PAAPLX and on PBAND2 through
 *    each sale page's own buttons, signed by the injected test wallet. A sale
 *    whose stock price is too old has it brought up to date through the app's
 *    price refresh route first.
 * 3. /portfolio, as that wallet: each row's holding is held to an independent
 *    read of the chain through pangu-sdk and spl-token.
 * 4. Part of PAAPLX is sold back from its sale page, and /portfolio is watched
 *    until its row matches the chain again.
 * 5. /portfolio as the demo wallet, with a wallet that carries only the public
 *    key and refuses to sign: the issued ledger is held to the directory.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { installTestWallet } from "./sale-test-wallet.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");
const { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { getBuyerRecord } = require("pangu-sdk");

const BASE = process.argv[2] ?? "http://127.0.0.1:3471";
const SCRATCH = process.argv[3];
if (/:3000\b/.test(BASE)) {
  throw new Error("port 3000 is Ram's dev server; point this at another server");
}
if (SCRATCH === undefined) {
  throw new Error("name a scratch folder outside the repository for the throwaway key");
}

const PAAPLX = "8FaBUEjMfkpYAzZLmLKwYHxd15BNC1ZBFkgTgN2WCQvK";
const PBAND2 = "5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo";
const FUND_SOL = 0.05;
const BUY_SHARES = "0.05";
const SELL_SHARES = "0.02";
const LANDING_MS = 240_000;

process.loadEnvFile(new URL("../../../.env", import.meta.url));
const demo = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.DEVNET_PAYER_KEYPAIR, "utf8"))));
const connection = new Connection(process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const buyer = Keypair.generate();
mkdirSync(SCRATCH, { recursive: true });
const keyFile = path.join(SCRATCH, `portfolio-throwaway-${buyer.publicKey.toBase58()}.json`);
writeFileSync(keyFile, JSON.stringify(Array.from(buyer.secretKey)));

let failures = 0;
function check(label, ok, detail) {
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail === undefined ? "" : `: ${detail}`}`);
}

/** An error as text with any endpoint cut out, since the keyed one carries its key. */
function said(error) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
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

/**
 * Sends a transfer and waits on its status by polling. Answers null when the
 * blockhash ran out before it landed, so a retry can never pay twice.
 */
async function transfer(from, to, lamports) {
  const fresh = await retry("reading a blockhash", () => connection.getLatestBlockhash("confirmed"));
  const transaction = new Transaction({ feePayer: from.publicKey, ...fresh }).add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports })
  );
  transaction.sign(from);
  const signature = await retry("sending a transfer", () => connection.sendRawTransaction(transaction.serialize()));
  for (;;) {
    const status = (await retry("reading a status", () => connection.getSignatureStatuses([signature]))).value[0];
    if (status?.err) {
      throw new Error(`the transfer failed on chain: ${signature}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return signature;
    }
    if ((await retry("reading the height", () => connection.getBlockHeight("confirmed"))) > fresh.lastValidBlockHeight) {
      return null;
    }
    await new Promise((wake) => setTimeout(wake, 2_000));
  }
}

/** The independent read: the wallet's own holding account and its buyer record, off the chain. */
async function chainRead(mint) {
  const key = new PublicKey(mint);
  const account = getAssociatedTokenAddressSync(key, buyer.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const held = await retry("reading the holding", () =>
    getAccount(connection, account, "confirmed", TOKEN_2022_PROGRAM_ID).then(
      (found) => found.amount,
      (error) => (error?.name === "TokenAccountNotFoundError" ? 0n : Promise.reject(error))
    )
  );
  const record = await retry("reading the buyer record", () => getBuyerRecord(connection, key, buyer.publicKey));
  return { held, netBought: record?.netBought ?? 0n };
}

/** A wallet that carries only a public key and refuses every signature. */
async function installReadOnlyWallet(context, address) {
  await context.addInitScript(
    ({ address: owner, publicKey }) => {
      window.localStorage.setItem("walletName", JSON.stringify("Pangu Read Only"));
      const account = Object.freeze({
        address: owner,
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
              window.__panguSignAsked = (window.__panguSignAsked ?? 0) + 1;
              throw new Error("User rejected the request.");
            },
          },
        },
      };
      const register = ({ register: add }) => add(wallet);
      window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
    },
    { address, publicKey: Array.from(new PublicKey(address).toBytes()) }
  );
}

async function settled(page, testId) {
  await page.waitForFunction(
    (id) => {
      const nodes = document.querySelectorAll(`[data-testid=${id}]`);
      const node = nodes[nodes.length - 1];
      return node !== undefined && nodes.length === 1 && ["landed", "refused", "failed"].includes(node.getAttribute("data-step"));
    },
    testId,
    { timeout: LANDING_MS }
  );
  const status = page.locator(`[data-testid=${testId}]`).last();
  const step = await status.getAttribute("data-step");
  const text = (await status.innerText()).replace(/\s+/g, " ").trim();
  const href = await status.locator("a").first().getAttribute("href").catch(() => null);
  const signature = href === null ? null : /\/tx\/([^?]+)/.exec(href)?.[1] ?? null;
  console.log(`  ${step}: ${text}`);
  if (signature !== null) {
    console.log(`  signature ${signature}`);
  }
  return { step, signature };
}

/** Presses an action's button and waits for it to settle, pressing again after a rate limit. */
async function act(page, button, statusId) {
  for (let attempt = 1; ; attempt += 1) {
    await page.click(`[data-testid=${button}]`);
    await page.waitForFunction(
      (id) => {
        const nodes = document.querySelectorAll(`[data-testid=${id}]`);
        const node = nodes[nodes.length - 1];
        return node !== undefined && ["checking", "signing", "pending"].includes(node.getAttribute("data-step"));
      },
      statusId,
      { timeout: 15_000 }
    );
    const result = await settled(page, statusId);
    if (result.step === "landed" || result.step === "refused") {
      return result;
    }
    const text = await page.locator(`[data-testid=${statusId}]`).last().innerText();
    if (!/rate limiting|did not answer/.test(text) || attempt === 4) {
      throw new Error(`${button} did not land: ${text.replace(/\s+/g, " ").trim()}`);
    }
    console.log("  waiting 30 seconds for the node, then pressing again");
    await page.waitForTimeout(30_000);
  }
}

/** The rules' answer to the amount typed, before anything is signed. */
async function verdictOf(page) {
  await page.waitForSelector("[data-testid=trade-check] [data-verdict]", { timeout: 120_000 });
  const verdict = page.locator("[data-testid=trade-check] [data-verdict]");
  const word = await verdict.getAttribute("data-verdict");
  console.log(`  rules before signing: ${word}, "${(await verdict.innerText()).replace(/\s+/g, " ").trim()}"`);
  return word;
}

async function holdingLine(page) {
  await page.waitForFunction(() => /You hold/.test(document.querySelector("[data-testid=trade-holding]")?.textContent ?? ""), null, {
    timeout: 120_000,
  });
  return (await page.locator("[data-testid=trade-holding]").innerText()).trim();
}

let lastRefresh = 0;

/**
 * Asks the app's own route to bring a sale's stock price up to date. The route
 * takes one post a minute, so a second ask waits out the rest of that minute.
 */
async function refreshPrice(mint) {
  const wait = lastRefresh + 62_000 - Date.now();
  if (wait > 0) {
    await new Promise((wake) => setTimeout(wake, wait));
  }
  lastRefresh = Date.now();
  const answer = await fetch(`${BASE}/api/price/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mint }),
  });
  const body = await answer.json().catch(() => ({}));
  console.log(`  price refresh through the app's route: ${answer.status} ${body.signature ?? body.reason ?? body.state ?? ""}`);
}

/** Buys on one sale page. Answers the signature, or null when the rules would refuse. */
async function buyOn(page, mint, label) {
  console.log("");
  console.log(`${label} ${mint}`);
  await page.goto(`${BASE}/sale/${mint}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  console.log(`  before: ${await holdingLine(page)}`);
  await page.fill("[data-testid=trade-amount]", BUY_SHARES);
  let word = await verdictOf(page);
  const stale = /too old/.test(await page.locator("[data-testid=trade-check]").innerText());
  if (word !== "pass" && stale) {
    await refreshPrice(mint);
    await page.waitForTimeout(8_000);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 180_000 });
    await holdingLine(page);
    await page.fill("[data-testid=trade-amount]", BUY_SHARES);
    word = await verdictOf(page);
  }
  if (word !== "pass") {
    return null;
  }
  const result = await act(page, "trade-buy", "trade-status");
  await page.waitForTimeout(3_000);
  console.log(`  after: ${await holdingLine(page)}`);
  return result.step === "landed" ? result.signature : null;
}

/** Reads every row /portfolio shows: mint, raw holding and raw net bought. */
async function portfolioRows(page) {
  return page.$$eval("[data-testid=portfolio-row]", (rows) =>
    rows.map((row) => ({
      mint: row.getAttribute("data-mint"),
      held: row.getAttribute("data-held-raw"),
      netBought: row.getAttribute("data-net-bought-raw"),
      text: row.innerText.replace(/\s+/g, " ").trim(),
    }))
  );
}

async function openPortfolio(page) {
  await page.goto(`${BASE}/portfolio`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector("[data-testid=portfolio]", { timeout: 180_000 });
}

console.log(`server ${BASE}, devnet`);
console.log(`demo wallet ${demo.publicKey.toBase58()}`);
console.log(`throwaway ${buyer.publicKey.toBase58()}, its key kept in the session scratch folder until the sweep`);

const browser = await chromium.launch();
const bought = {};
try {
  let fund = null;
  for (let attempt = 1; fund === null && attempt <= 3; attempt += 1) {
    fund = await transfer(demo, buyer.publicKey, Math.round(FUND_SOL * LAMPORTS_PER_SOL));
  }
  console.log(`funded the throwaway with ${FUND_SOL} SOL: ${fund}`);

  let answer = null;
  let grant = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    answer = await fetch(`${BASE}/api/break/dollars`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: buyer.publicKey.toBase58() }),
    });
    grant = await answer.json();
    if (answer.ok || attempt === 2) {
      break;
    }
    console.log(`  the demo dollars route answered ${answer.status}: ${grant.reason} Asking again in 30 seconds.`);
    await new Promise((wake) => setTimeout(wake, 30_000));
  }
  check(
    "demo dollars granted through the app's route",
    answer.ok,
    answer.ok ? `${Number(grant.amount) / 10 ** grant.decimals} demo dollars, ${grant.signature}` : grant.reason
  );
  await new Promise((wake) => setTimeout(wake, 4_000));

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await installTestWallet(context, buyer);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 200)));

  bought.PAAPLX = await buyOn(page, PAAPLX, "PAAPLX");
  check("PAAPLX buy landed", bought.PAAPLX !== null);
  bought.PBAND2 = await buyOn(page, PBAND2, "PBAND2");
  if (bought.PBAND2 === null) {
    console.log("  PBAND2's rules would not take the buy right now, so only PAAPLX is in this run");
  } else {
    check("PBAND2 buy landed", true);
  }
  const mints = [PAAPLX, ...(bought.PBAND2 === null ? [] : [PBAND2])];

  console.log("");
  console.log("/portfolio as the throwaway");
  await openPortfolio(page);
  await page.waitForFunction(
    (count) => document.querySelectorAll("[data-testid=portfolio-row]").length >= count,
    mints.length,
    { timeout: 120_000 }
  );
  console.log(`  totals: ${(await page.locator("[data-testid=portfolio-totals]").innerText()).replace(/\s+/g, " ").trim()}`);
  let rows = await portfolioRows(page);
  for (const mint of mints) {
    const row = rows.find((entry) => entry.mint === mint);
    const chain = await chainRead(mint);
    console.log(`  row: ${row?.text ?? "missing"}`);
    check(
      `${mint === PAAPLX ? "PAAPLX" : "PBAND2"} held on /portfolio equals the chain`,
      row !== undefined && row.held === chain.held.toString(),
      `page ${row?.held} raw, chain ${chain.held} raw`
    );
    check(
      `${mint === PAAPLX ? "PAAPLX" : "PBAND2"} net bought on /portfolio equals the buyer record`,
      row !== undefined && row.netBought === chain.netBought.toString(),
      `page ${row?.netBought} raw, record ${chain.netBought} raw`
    );
  }
  check("the throwaway issued nothing, and the page says so", (await page.locator("[data-testid=portfolio-issued-row]").count()) === 0);

  console.log("");
  console.log(`sell ${SELL_SHARES} PAAPLX back from its sale page, reached through the row's Sell back`);
  await page.locator(`[data-testid=portfolio-row][data-mint="${PAAPLX}"] [data-testid=portfolio-sell-back]`).click();
  await page.waitForURL(`**/sale/${PAAPLX}**`, { timeout: 60_000 });
  console.log(`  before: ${await holdingLine(page)}`);
  await page.click("[data-testid=trade-mode-sell]");
  await page.fill("[data-testid=trade-amount]", SELL_SHARES);
  const sold = await act(page, "trade-sell", "trade-status");
  check("the sell landed", sold.step === "landed");
  const afterSell = await chainRead(PAAPLX);

  await openPortfolio(page);
  const started = Date.now();
  await page.waitForFunction(
    ({ mint, held }) =>
      document.querySelector(`[data-testid=portfolio-row][data-mint="${mint}"]`)?.getAttribute("data-held-raw") === held,
    { mint: PAAPLX, held: afterSell.held.toString() },
    { timeout: 120_000, polling: 1_000 }
  );
  rows = await portfolioRows(page);
  const updated = rows.find((entry) => entry.mint === PAAPLX);
  check(
    "after the sell, /portfolio's PAAPLX row equals the chain",
    updated?.held === afterSell.held.toString() && updated?.netBought === afterSell.netBought.toString(),
    `page ${updated?.held} raw held, ${updated?.netBought} raw net; chain ${afterSell.held}, ${afterSell.netBought}; ${Math.round((Date.now() - started) / 1000)} s after opening the page`
  );
  console.log(`  row: ${updated?.text}`);
  check("no uncaught errors on the throwaway's pages", pageErrors.length === 0, pageErrors.join(" | "));
  await context.close();

  console.log("");
  console.log(`/portfolio as the demo wallet ${demo.publicKey.toBase58()}, read only: the wallet holds no key and refuses to sign`);
  const demoContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await installReadOnlyWallet(demoContext, demo.publicKey.toBase58());
  const demoPage = await demoContext.newPage();
  await openPortfolio(demoPage);
  await demoPage.waitForSelector("[data-testid=portfolio-issued-row]", { timeout: 120_000 });
  const issued = await demoPage.$$eval("[data-testid=portfolio-issued-row]", (list) =>
    list.map((row) => ({ mint: row.getAttribute("data-mint"), text: row.innerText.replace(/\s+/g, " ").trim() }))
  );
  for (const row of issued) {
    console.log(`  issued: ${row.text}`);
  }
  const directory = await (await fetch(`${BASE}/api/sales?all=1`)).json();
  const expected = directory.sales.filter((sale) => sale.issuer === demo.publicKey.toBase58()).map((sale) => sale.mint).sort();
  check(
    "the issued ledger lists exactly the sales the directory names the demo wallet issuer of",
    JSON.stringify(issued.map((row) => row.mint).sort()) === JSON.stringify(expected),
    `${issued.length} rows, ${expected.length} in the directory`
  );
  const asked = await demoPage.evaluate(() => window.__panguSignAsked ?? 0);
  check("the demo wallet was never asked to sign", asked === 0, String(asked));
  await demoContext.close();
} catch (error) {
  failures += 1;
  console.log(`FAIL  the run stopped: ${said(error)}`);
} finally {
  await browser.close().catch(() => {});
  let left = null;
  for (let attempt = 1; left === null && attempt <= 6; attempt += 1) {
    left = await connection.getBalance(buyer.publicKey, "confirmed").catch(() => null);
    if (left === null) {
      await new Promise((wake) => setTimeout(wake, 3_000));
    }
  }
  if (left !== null && left > 5_000) {
    let back = null;
    for (let attempt = 1; back === null && attempt <= 3; attempt += 1) {
      back = await transfer(buyer, demo.publicKey, left - 5_000).catch(() => null);
    }
    console.log("");
    console.log(`returned ${((left - 5_000) / LAMPORTS_PER_SOL).toFixed(6)} SOL to the demo wallet: ${back ?? "NOT CONFIRMED, the key stays in the scratch folder"}`);
    if (back !== null) {
      rmSync(keyFile);
      console.log("the throwaway's key file is deleted");
    }
  } else {
    console.log(`sweep: balance ${left === null ? "not read, the key stays in the scratch folder" : `${left} lamports, nothing to return`}`);
    if (left !== null) {
      rmSync(keyFile);
    }
  }
}

console.log("");
console.log(failures === 0 ? "every check passed" : `${failures} checks failed`);
process.exit(failures === 0 ? 0 : 1);
