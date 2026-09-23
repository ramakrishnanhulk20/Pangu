/**
 * Proves the sale pages against devnet, from the pages themselves.
 *
 *   node lab-evidence/sale-devnet.mjs http://localhost:3461 | tee lab-evidence/sale-devnet.txt
 *
 * Needs a server of this app answering at the address given, never the dev
 * server on 3000, and the repository root .env with DEVNET_PAYER_KEYPAIR (the
 * demo sales' issuer) and DEVNET_RPC_URL. Neither key nor endpoint is printed.
 *
 * 1. A throwaway wallet is made in memory and funded with 0.03 devnet SOL from
 *    the issuer's key.
 * 2. On the PAAPLX sale page it takes demo dollars from the page's button,
 *    buys under the cap, then sells part back, every step through the page's
 *    own buttons and signed by the injected test wallet.
 * 3. On a list-mode sale the issuer's key, injected the same way, approves the
 *    throwaway from the issuer panel, and the throwaway then buys.
 *
 * Only public keys and signatures are printed.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { installTestWallet } from "./sale-test-wallet.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");
const {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} = require("@solana/web3.js");

const BASE = process.argv[2] ?? "http://localhost:3461";
const PAAPLX = "8FaBUEjMfkpYAzZLmLKwYHxd15BNC1ZBFkgTgN2WCQvK";
/** The list-mode demo sale. Its issuer is the key in DEVNET_PAYER_KEYPAIR. */
const DEMO_LIST_SALE = "4kzCbpEZxyzwXno1ZVnTJ9BAGSjD1HVgSBSwikEsxeaE";
const FUND_SOL = 0.03;
const LANDING_MS = 240_000;

process.loadEnvFile(new URL("../../../.env", import.meta.url));
const issuer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.DEVNET_PAYER_KEYPAIR, "utf8")))
);
const connection = new Connection(
  process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com",
  "confirmed"
);
const buyer = Keypair.generate();

/**
 * The list-mode sale the launch order opened from /launch, read from its record.
 * Its issuer is a throwaway that run made and did not keep, so here it shows
 * the refusal a stranger meets; the approval runs on the demo list sale, whose
 * issuer key this run holds.
 */
function launchedListSale() {
  const file = new URL("./launch-devnet.txt", import.meta.url);
  if (!existsSync(file)) {
    return null;
  }
  const found = /launch \d+ : ([1-9A-HJ-NP-Za-km-z]{32,44}),[^\n]*approved list/.exec(readFileSync(file, "utf8"));
  return found === null ? null : found[1];
}

const browser = await chromium.launch();

async function walletPage(keypair) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await installTestWallet(context, keypair);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  page error: ${error.message.slice(0, 200)}`));
  return { context, page };
}

/** Waits for an action's status to settle and prints what it says. Returns the signature, if any. */
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

/**
 * Presses an action's button and waits for it to settle. When the public devnet
 * node rate limited the browser, the page says to wait and try again, so this
 * waits and presses again, twice at most, the way a visitor would. Any other
 * failure stops the run.
 */
async function act(page, button, statusId) {
  for (let attempt = 1; ; attempt += 1) {
    await page.click(`[data-testid=${button}]`);
    // The last state fades out as the new one fades in, so the run waits until
    // the newest status on the page is this press's own.
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
    if (!/rate limiting/.test(text) || attempt === 4) {
      throw new Error(`${button} did not land: ${text.replace(/\s+/g, " ").trim()}`);
    }
    console.log("  waiting 30 seconds for the public node, then pressing again");
    await page.waitForTimeout(30_000);
  }
}

async function checkAnswer(page) {
  await page.waitForSelector("[data-testid=trade-check] [data-verdict]", { timeout: 90_000 });
  const verdict = page.locator("[data-testid=trade-check] [data-verdict]");
  console.log(`  rules before signing: ${await verdict.getAttribute("data-verdict")}, "${(await verdict.innerText()).replace(/\s+/g, " ").trim()}"`);
}

/** Prints the wallet's holding line once it reads, and once it differs from `before` when given. */
async function holding(page, label, before = null) {
  await page.waitForFunction(
    (previous) => {
      const text = document.querySelector("[data-testid=trade-holding]")?.textContent ?? "";
      return /You hold/.test(text) && (previous === null || text.trim() !== previous);
    },
    before,
    { timeout: 90_000 }
  );
  const text = (await page.locator("[data-testid=trade-holding]").innerText()).trim();
  console.log(`  ${label}: ${text}`);
  return text;
}

console.log(`server ${BASE}, devnet`);
console.log(`issuer ${issuer.publicKey.toBase58()}`);
console.log(`throwaway buyer ${buyer.publicKey.toBase58()}, made in memory for this run`);

/**
 * Sends a transfer signed by `from` and waits on its status by polling, not on a
 * websocket, which this machine's network drops. Answers null when the
 * blockhash ran out before it landed, so a retry can never pay twice.
 */
async function transfer(from, to, lamports) {
  const fresh = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: from.publicKey, ...fresh }).add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports })
  );
  transaction.sign(from);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  for (;;) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err) {
      throw new Error(`the transfer failed on chain: ${signature}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return signature;
    }
    if ((await connection.getBlockHeight("confirmed")) > fresh.lastValidBlockHeight) {
      return null;
    }
    await new Promise((wake) => setTimeout(wake, 2_000));
  }
}

let fund = null;
for (let attempt = 1; fund === null && attempt <= 3; attempt += 1) {
  fund = await transfer(issuer, buyer.publicKey, Math.round(FUND_SOL * LAMPORTS_PER_SOL)).catch((error) => {
    if (attempt === 3) {
      throw error;
    }
    return null;
  });
}
console.log(`funded the throwaway with ${FUND_SOL} SOL: ${fund}`);

const results = {};
try {

  // 1. PAAPLX: demo dollars, a buy under the cap, a part sold back.
  {
    console.log("");
    console.log(`PAAPLX ${PAAPLX}`);
    const { context, page } = await walletPage(buyer);
    await page.goto(`${BASE}/sale/${PAAPLX}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await holding(page, "before");

    const granted = page.waitForResponse((response) => response.url().endsWith("/api/break/dollars"), {
      timeout: 180_000,
    });
    await page.click("[data-testid=trade-demo-dollars]");
    const grant = await (await granted).json();
    console.log(`  demo dollars from the page's button: ${grant.signature ?? grant.reason}`);
    results.dollars = grant.signature ?? null;
    await page.waitForTimeout(4_000);

    await page.fill("[data-testid=trade-amount]", "0.05");
    await holding(page, "after the grant");
    await checkAnswer(page);
    const beforeBuy = (await page.locator("[data-testid=trade-holding]").innerText()).trim();
    results.buy = await act(page, "trade-buy", "trade-status");
    const afterBuy = await holding(page, "after the buy", beforeBuy);

    await page.click("[data-testid=trade-mode-sell]");
    await page.fill("[data-testid=trade-amount]", "0.02");
    console.log(`  quote: ${(await page.locator("[data-testid=trade-quote]").innerText()).trim()}`);
    results.sell = await act(page, "trade-sell", "trade-status");
    await holding(page, "after the sell", afterBuy.replace(/, you may still buy[^]*$/, "."));
    await page.locator("[data-testid=sale-desk]").screenshot({ path: "lab-evidence/sale-paaplx-desk-dark-1440.png" });
    await context.close();
  }

  // 2. A list-mode sale: the issuer approves the throwaway, then it buys.
  {
    const launched = launchedListSale();
    if (launched !== null) {
      console.log("");
      console.log(`list-mode sale launched from /launch ${launched}, as a wallet nobody approved`);
      const stranger = await walletPage(buyer);
      await stranger.page.goto(`${BASE}/sale/${launched}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await stranger.page.waitForFunction(
        () => /Yours is not on the list/.test(document.querySelector("[data-testid=trade-access]")?.textContent ?? ""),
        null,
        { timeout: 120_000 }
      );
      console.log(`  the page says: ${(await stranger.page.locator("[data-testid=trade-access]").innerText()).replace(/\s+/g, " ").trim()}`);
      await stranger.page.click("[data-testid=trade-unit-paying]");
      await stranger.page.fill("[data-testid=trade-amount]", "0.001");
      await checkAnswer(stranger.page);
      await stranger.context.close();
    }

    const list = { mint: DEMO_LIST_SALE };
    console.log("");
    console.log(`list-mode demo sale ${list.mint}, whose issuer key this run holds`);

    const asIssuer = await walletPage(issuer);
    await asIssuer.page.goto(`${BASE}/sale/${list.mint}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await asIssuer.page.waitForSelector("[data-testid=issuer-approvals]", { timeout: 120_000 });
    console.log("  the issuer panel shows for the issuer's wallet");
    await asIssuer.page.fill("[data-testid=issuer-paste]", `${buyer.publicKey.toBase58()}\nnot-an-address`);
    console.log(`  pasted with a bad line: ${(await asIssuer.page.locator("[data-testid=issuer-approvals] ul").first().innerText()).trim()}`);
    await asIssuer.page.fill("[data-testid=issuer-paste]", buyer.publicKey.toBase58());
    results.approve = await act(asIssuer.page, "issuer-approve", "issuer-approve-status");
    await asIssuer.page.waitForTimeout(3_000);
    await asIssuer.page.locator("[data-testid=issuer-panel]").screenshot({ path: "lab-evidence/sale-issuer-panel-dark-1440.png" });
    await asIssuer.context.close();

    const asBuyer = await walletPage(buyer);
    await asBuyer.page.goto(`${BASE}/sale/${list.mint}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await asBuyer.page.waitForFunction(
      () => /Your wallet is on the issuer's list/.test(document.querySelector("[data-testid=trade-access]")?.textContent ?? ""),
      null,
      { timeout: 120_000 }
    );
    console.log(`  the buyer's page: ${(await asBuyer.page.locator("[data-testid=trade-access]").innerText()).trim()}`);
    const issuerSeen = await asBuyer.page.locator("[data-testid=issuer-panel]").count();
    console.log(`  issuer panel on the buyer's page: ${issuerSeen === 0 ? "hidden" : "SHOWN"}`);
    await asBuyer.page.click("[data-testid=trade-unit-paying]");
    await asBuyer.page.fill("[data-testid=trade-amount]", "0.001");
    await holding(asBuyer.page, "before");
    await checkAnswer(asBuyer.page);
    results.listBuy = await act(asBuyer.page, "trade-buy", "trade-status");
    await asBuyer.context.close();
  }

  console.log("");
  console.log(
    `result: dollars ${results.dollars ? "landed" : "not landed"}, buy ${results.buy?.step}, sell ${results.sell?.step}, approval ${results.approve?.step}, list buy ${results.listBuy?.step}`
  );
} finally {
  await browser.close().catch(() => {});
  // What the throwaway has left goes back to the issuer's key, so a run costs the
  // fees and deposits it paid and nothing more. The key is dropped with the process.
  let left = 0;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const read = await connection.getBalance(buyer.publicKey).catch(() => null);
    if (read !== null) {
      left = read;
      break;
    }
    await new Promise((wake) => setTimeout(wake, 3_000));
  }
  if (left > 5_000) {
    const back = await transfer(buyer, issuer.publicKey, left - 5_000).catch(() => null);
    console.log(`returned ${((left - 5_000) / LAMPORTS_PER_SOL).toFixed(6)} SOL to the issuer's key: ${back ?? "not confirmed"}`);
  }
}
