/**
 * The review fixes on devnet, through the real pages with a Wallet Standard
 * test wallet whose keys stay in this process.
 *
 *   KEY_DIR=<folder> node lab-evidence/review-fixes-trade.mjs http://127.0.0.1:3461
 *
 * Point it at a verification server, never the dev server on 3000. KEY_DIR is a
 * folder outside the repository where the two throwaway keys are written the
 * moment they are made, so a run that dies midway never strands their SOL; a
 * second run picks the same keys up again and sweeps them.
 *
 *   1. Launch one sale from /launch through the new signing order. The test
 *      wallet adds its own compute unit price instruction while signing, the
 *      way Phantom adds its guard instructions, and the launch must land with
 *      that instruction in both transactions.
 *   2. On the sale's page, one ordinary buy and one sell, both landing.
 *   3. A second wallet buys after the page showed its quote and before Buy is
 *      pressed: the page must say the market moved and ask nobody to sign.
 *   4. A second wallet buys after the page built and simulated the buy and the
 *      wallet was asked, before the buy lands. The signed buy is sent with
 *      preflight off, so it reaches the chain, and DBC must refuse it on the
 *      floor the page showed: 1 percent under the shares it quoted.
 *
 * Then the second wallet sells back, both wallets close their wrapped SOL
 * accounts, and every lamport left goes back to the demo wallet.
 *
 * Nothing here is added to packages/scripts/sales.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { DBC_PROGRAM_ID, PANGU_PROGRAM_ID, getSale } from "pangu-sdk";
import { buyTransaction, sellTransaction } from "pangu-sdk/dbc";

import { payerKeypair, rpcUrl } from "../../scripts/src/environment.ts";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://127.0.0.1:3461";
if (/:3000\b/.test(base)) {
  throw new Error("port 3000 is Ram's dev server; point this at a verification server");
}
const keyDir = process.env.KEY_DIR;
if (keyDir === undefined || keyDir === "") {
  throw new Error("set KEY_DIR to a folder outside the repository for the throwaway keys");
}

const WALLET_NAME = "Pangu Test Wallet";
const FUND_SOL = 0.08;
const BUY_SOL = "0.002";
const UNDERCUT_LAMPORTS = 6_000_000n;
const LAUNCH_TIMEOUT_MS = 6 * 60 * 1000;
const TRADE_TIMEOUT_MS = 3 * 60 * 1000;

const connection = new Connection(rpcUrl(), "confirmed");

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
  return text.replace(/https?:\/\/\S+/g, "<endpoint>");
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

/** A throwaway key, written to KEY_DIR before anything is sent to it. */
function throwaway(name) {
  mkdirSync(keyDir, { recursive: true });
  const file = join(keyDir, `${name}.json`);
  if (existsSync(file)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
  }
  const key = Keypair.generate();
  writeFileSync(file, JSON.stringify(Array.from(key.secretKey)));
  return key;
}

/**
 * Sends a signed transaction and waits on its status, never on a blockhash
 * timer alone. Returns the signature and the chain's error, null when it
 * went through.
 */
async function sendAndRead(transaction, { skipPreflight = false } = {}) {
  const signature = await retry("sending", () =>
    connection.sendRawTransaction(transaction.serialize(), { skipPreflight, maxRetries: 5 })
  );
  for (let poll = 0; poll < 90; poll += 1) {
    const status = await retry("reading a status", () =>
      connection.getSignatureStatus(signature, { searchTransactionHistory: true })
    );
    if (status.value !== null && status.value.confirmationStatus !== "processed") {
      return { signature, err: status.value.err };
    }
    await new Promise((wake) => setTimeout(wake, 2_000));
  }
  throw new Error(`${signature} was never confirmed`);
}

async function signAndSend(instructions, signer) {
  const transaction = new Transaction().add(...instructions);
  const latest = await retry("reading a blockhash", () => connection.getLatestBlockhash("confirmed"));
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = signer.publicKey;
  transaction.sign(signer);
  return sendAndRead(transaction);
}

async function logsOf(signature) {
  const detail = await retry("reading a transaction", () =>
    connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
  );
  return { logs: detail?.meta?.logMessages ?? [], message: detail?.transaction.message ?? null };
}

const explorer = (signature) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

const payer = Keypair.fromSecretKey(payerKeypair().secretKey);
const buyer = throwaway("wo55-buyer");
const rival = throwaway("wo55-rival");

console.log(`network  : devnet`);
console.log(`program  : ${PANGU_PROGRAM_ID.toBase58()}`);
console.log(`site     : ${base}`);
console.log(`demo     : ${payer.publicKey.toBase58()} holds ${((await connection.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
console.log(`buyer    : ${buyer.publicKey.toBase58()}, a throwaway: issuer, then buyer on its own sale`);
console.log(`rival    : ${rival.publicKey.toBase58()}, a throwaway: the second wallet that moves the price`);

for (const key of [buyer, rival]) {
  const held = await connection.getBalance(key.publicKey, "confirmed");
  const wanted = Math.round(FUND_SOL * LAMPORTS_PER_SOL);
  if (held < wanted) {
    const { signature, err } = await signAndSend(
      [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: key.publicKey, lamports: wanted - held })],
      payer
    );
    check(`funded ${key.publicKey.toBase58().slice(0, 6)} to ${FUND_SOL} SOL`, err === null, explorer(signature));
  }
}

// The wallet, in Node. `phase` decides what it does with each transaction.
let phase = "launch";
let signRequests = 0;
let walletAdded = 0;
let undercut = null;

function carriesPrice(transaction) {
  return transaction.instructions.some(
    (instruction) => instruction.programId.equals(ComputeBudgetProgram.programId) && instruction.data[0] === 3
  );
}

async function signInNode(encoded) {
  signRequests += 1;
  const signed = [];
  for (const text of encoded) {
    let transaction = Transaction.from(Buffer.from(text, "base64"));

    if (phase === "launch" && !carriesPrice(transaction)) {
      // What Phantom does on some mainnet flows: its own instruction goes in
      // while it signs. The launch then signs for its new account second.
      const withPrice = Transaction.from(Buffer.from(text, "base64"));
      withPrice.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }));
      withPrice.signatures = [];
      withPrice.partialSign(buyer);
      try {
        withPrice.serialize({ requireAllSignatures: false, verifySignatures: false });
        transaction = withPrice;
        walletAdded += 1;
      } catch {
        console.log("note     : the added instruction would not fit this transaction, so it was signed as built");
        transaction.partialSign(buyer);
      }
    } else if (phase === "moved") {
      // Step 3 asks nobody to sign. A request here means the page re-read the
      // pool before Buy was pressed, so it is turned down and nothing lands.
      throw new Error("User rejected the request.");
    } else if (phase === "undercut") {
      const swap = transaction.instructions.find((instruction) => instruction.programId.equals(DBC_PROGRAM_ID));
      const floor = swap === undefined ? null : swap.data.readBigUInt64LE(16);
      const rivalBuy = await buyTransaction({
        connection,
        buyer: rival.publicKey,
        mint: new PublicKey(mint),
        amountIn: UNDERCUT_LAMPORTS,
      });
      rivalBuy.transaction.sign(rival);
      const rivalSent = await sendAndRead(rivalBuy.transaction);
      transaction.partialSign(buyer);
      // Preflight off, so the buy reaches the chain whatever it would do there.
      const sent = await sendAndRead(transaction, { skipPreflight: true });
      undercut = { floor, rival: rivalSent, buy: sent };
    } else {
      transaction.partialSign(buyer);
    }
    signed.push(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"));
  }
  return signed;
}

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
    features: ["solana:signTransaction"],
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
    },
  };
  const register = ({ register: add }) => add(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  window.localStorage.setItem("walletName", JSON.stringify(name));
}

let mint = null;
const browser = await chromium.launch();

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.exposeFunction("__panguTestSign", signInNode);
  await context.addInitScript(injectWallet, [WALLET_NAME, buyer.publicKey.toBase58(), Array.from(buyer.publicKey.toBytes())]);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // 1. The launch, through the new signing order.
  console.log("");
  console.log("1. launch, the wallet adding its own compute unit price while it signs");
  await page.goto(`${base}/launch`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByTestId("launch-go").waitFor({ timeout: 60_000 });
  await page.getByTestId("launch-balance").filter({ hasText: "devnet SOL" }).waitFor({ timeout: 180_000 });
  await page.getByTestId("launch-paying-sol").click();
  await page.getByTestId("launch-end-none").click();
  for (const [id, value] of Object.entries({
    "launch-name": "Pangu Review Fix Share",
    "launch-symbol": "PFIX",
    "launch-supply": "1000000000",
    "launch-raise": "0.1",
    "launch-kept": "20",
    "launch-cap": "49",
  })) {
    await page.getByTestId(id).fill(value);
  }
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-testid=launch-go]");
    return button !== null && !button.disabled;
  }, undefined, { timeout: 150_000 });
  await page.getByTestId("launch-go").click();
  await page.waitForSelector("[data-testid=launch-done], [data-testid^=launch-failure-]", { timeout: LAUNCH_TIMEOUT_MS });
  const done = page.getByTestId("launch-done");
  if ((await done.count()) === 0) {
    const failed = page.locator("[data-testid^=launch-failure-]").first();
    check("the launch landed", false, (await failed.innerText()).replace(/\n+/g, " / "));
    throw new Error("the launch did not land");
  }
  mint = await done.getAttribute("data-mint");
  check("the launch landed through the new signing order", mint !== null, mint);
  console.log(`mint     : https://explorer.solana.com/address/${mint}?cluster=devnet`);
  check("the wallet added its own instruction to both launch transactions", walletAdded === 2, String(walletAdded));
  const launchLinks = await page
    .locator("[data-testid=launch-done] a[href*='/tx/']")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  const launchSignatures = [
    ...new Set(launchLinks.map((href) => /\/tx\/([1-9A-HJ-NP-Za-km-z]+)/.exec(href ?? "")?.[1]).filter(Boolean)),
  ];
  check("the done state links the template and sale transactions", launchSignatures.length === 2, String(launchSignatures.length));
  for (const signature of launchSignatures) {
    const { message } = await logsOf(signature);
    const keys = message?.staticAccountKeys ?? message?.accountKeys ?? [];
    const withPrice = (message?.compiledInstructions ?? message?.instructions ?? []).some((instruction) => {
      const program = keys[instruction.programIdIndex];
      const data = Buffer.from(instruction.data);
      return program?.equals(ComputeBudgetProgram.programId) && data[0] === 3;
    });
    check(`landed with the wallet's compute unit price in it`, withPrice, explorer(signature));
  }
  const sale = await retry("reading the sale", () => getSale(connection, new PublicKey(mint)));
  check("the sale's rules read back, issuer the throwaway", sale !== null && sale.issuer.equals(buyer.publicKey));

  // 2. An ordinary buy and sell on the sale's own page.
  phase = "trade";
  console.log("");
  console.log("2. an ordinary buy and sell");
  await page.goto(`${base}/sale/${mint}#trade`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByTestId("trade-panel").waitFor({ timeout: 60_000 });
  await page.getByTestId("trade-holding").waitFor({ timeout: 120_000 });

  const tradeResult = async () => {
    await page.waitForSelector(
      "[data-testid=trade-status][data-step=landed], [data-testid=trade-status][data-step=refused], [data-testid=trade-status][data-step=failed]",
      { timeout: TRADE_TIMEOUT_MS }
    );
    const status = page.getByTestId("trade-status");
    const href = await status.locator("a[href*='/tx/']").first().getAttribute("href").catch(() => null);
    return {
      step: await status.getAttribute("data-step"),
      text: (await status.innerText()).replace(/\n+/g, " / "),
      signature: /\/tx\/([1-9A-HJ-NP-Za-km-z]+)/.exec(href ?? "")?.[1] ?? null,
    };
  };
  const quoteShown = async () => {
    const floor = page.getByTestId("trade-floor");
    await floor.waitFor({ timeout: 60_000 });
    return {
      shown: BigInt(await floor.getAttribute("data-shown-raw")),
      floor: BigInt(await floor.getAttribute("data-floor-raw")),
      line: await floor.innerText(),
    };
  };

  await page.getByTestId("trade-unit-paying").click();
  await page.getByTestId("trade-amount").fill(BUY_SOL);
  const first = await quoteShown();
  console.log(`page says: ${first.line.replace(/\n+/g, " ")}`);
  check("the stated floor is 1 percent under the shares shown", first.floor === (first.shown * 9_900n) / 10_000n, `${first.shown} shown, ${first.floor} floor`);
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-testid=trade-buy]");
    return button !== null && !button.disabled;
  }, undefined, { timeout: 60_000 });
  await page.getByTestId("trade-buy").click();
  const bought = await tradeResult();
  check("the ordinary buy landed", bought.step === "landed", bought.signature === null ? bought.text : explorer(bought.signature));

  await page.getByTestId("trade-mode-sell").click();
  await page.getByTestId("trade-sell-all").waitFor({ timeout: 60_000 });
  await page.getByTestId("trade-sell-all").click();
  const sellQuote = await quoteShown();
  console.log(`page says: ${sellQuote.line.replace(/\n+/g, " ")}`);
  await page.getByTestId("trade-sell").click();
  const sold = await tradeResult();
  check("the sell landed", sold.step === "landed", sold.signature === null ? sold.text : explorer(sold.signature));

  // A pause so the public node the browser reads through is not rate limiting
  // when the next reads matter.
  await page.waitForTimeout(15_000);

  // 3. The market moves between the quote and the click.
  console.log("");
  console.log("3. the market moves after the quote is shown, before Buy is pressed");
  await page.getByTestId("trade-mode-buy").click();
  await page.getByTestId("trade-unit-paying").click();
  await page.getByTestId("trade-amount").fill(BUY_SOL);
  const beforeMove = await quoteShown();
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-testid=trade-buy]");
    return button !== null && !button.disabled;
  }, undefined, { timeout: 60_000 });
  const rivalFirst = await buyTransaction({ connection, buyer: rival.publicKey, mint: new PublicKey(mint), amountIn: UNDERCUT_LAMPORTS });
  rivalFirst.transaction.sign(rival);
  const rivalFirstSent = await sendAndRead(rivalFirst.transaction);
  check("the rival's buy landed first", rivalFirstSent.err === null, explorer(rivalFirstSent.signature));
  phase = "moved";
  const requestsBefore = signRequests;
  await page.getByTestId("trade-buy").click();
  let moved = await tradeResult();
  // The browser reads through the public devnet node, which rate limits now
  // and then. That answer is about the node, not the trade, so it is asked once more.
  if (/rate limiting/i.test(moved.text)) {
    console.log(`note     : ${moved.text}; asking once more`);
    await page.waitForTimeout(8_000);
    await page.getByTestId("trade-buy").click();
    moved = await tradeResult();
  }
  console.log(`page says: ${moved.text}`);
  check(
    "the page said the market moved and asked nobody to sign",
    moved.step === "failed" && /market moved/i.test(moved.text) && signRequests === requestsBefore,
    `${moved.step}, ${signRequests - requestsBefore} signing requests`
  );
  check("it offers a fresh quote", (await page.getByTestId("trade-fresh-quote").count()) === 1);
  await page.getByTestId("trade-fresh-quote").click();
  await page.waitForFunction(
    (old) => {
      const floor = document.querySelector("[data-testid=trade-floor]");
      return floor !== null && floor.getAttribute("data-shown-raw") !== old;
    },
    beforeMove.shown.toString(),
    { timeout: 60_000 }
  );
  const fresh = await quoteShown();
  check("the fresh quote is lower than the one the market moved past", fresh.shown < beforeMove.shown, `${beforeMove.shown} then ${fresh.shown}`);

  // 4. The market moves after the wallet is asked: the chain's own floor.
  console.log("");
  console.log("4. the market moves after the buy is built and signed, before it lands");
  phase = "undercut";
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-testid=trade-buy]");
    return button !== null && !button.disabled;
  }, undefined, { timeout: 60_000 });
  const shownNow = await quoteShown();
  console.log(`page says: ${shownNow.line.replace(/\n+/g, " ")}`);
  await page.getByTestId("trade-buy").click();
  const afterUndercut = await tradeResult();
  console.log(`page says: ${afterUndercut.text}`);
  check("the wallet was asked, and the rival bought in between", undercut !== null && undercut.rival.err === null, undercut === null ? "no request" : explorer(undercut.rival.signature));
  if (undercut !== null) {
    check("the signed buy carries the floor the page showed", undercut.floor === shownNow.floor, `${undercut.floor} on chain, ${shownNow.floor} on the page`);
    const { logs } = await logsOf(undercut.buy.signature);
    const slippage = logs.find((line) => /slippage/i.test(line)) ?? null;
    check("the buy reached the chain and DBC refused it on that floor", undercut.buy.err !== null && slippage !== null, explorer(undercut.buy.signature));
    console.log(`chain    : ${JSON.stringify(undercut.buy.err)}`);
    console.log(`log      : ${slippage}`);
  }
  check("no uncaught errors on the page", pageErrors.length === 0, pageErrors.join(" | "));
} catch (error) {
  failures += 1;
  console.log(`FAIL  the run stopped: ${said(error)}`);
} finally {
  await browser.close();
  console.log("");
  // The rival's shares go back to the curve, then both wallets unwrap their
  // SOL and send everything to the demo wallet.
  if (mint !== null) {
    try {
      const account = getAssociatedTokenAddressSync(new PublicKey(mint), rival.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const held = await connection.getTokenAccountBalance(account).then((answer) => BigInt(answer.value.amount), () => 0n);
      if (held > 0n) {
        const sell = await sellTransaction({ connection, seller: rival.publicKey, mint: new PublicKey(mint), amountIn: held });
        sell.transaction.sign(rival);
        const sent = await sendAndRead(sell.transaction);
        console.log(`rival    : sold its ${held} back, ${sent.err === null ? "landed" : JSON.stringify(sent.err)}, ${explorer(sent.signature)}`);
      }
    } catch (error) {
      console.log(`note     : the rival's sell back did not go: ${said(error)}`);
    }
  }
  for (const key of [buyer, rival]) {
    try {
      const wrapped = getAssociatedTokenAddressSync(NATIVE_MINT, key.publicKey);
      if ((await connection.getAccountInfo(wrapped)) !== null) {
        await signAndSend([createCloseAccountInstruction(wrapped, key.publicKey, key.publicKey)], key);
      }
      const left = await connection.getBalance(key.publicKey, "confirmed");
      if (left > 5_000) {
        const { err } = await signAndSend(
          [SystemProgram.transfer({ fromPubkey: key.publicKey, toPubkey: payer.publicKey, lamports: left - 5_000 })],
          key
        );
        console.log(`returned : ${((left - 5_000) / LAMPORTS_PER_SOL).toFixed(6)} SOL from ${key.publicKey.toBase58().slice(0, 6)}, ${err === null ? "landed" : JSON.stringify(err)}`);
      }
    } catch (error) {
      failures += 1;
      console.log(`FAIL  could not sweep ${key.publicKey.toBase58()}: ${said(error)}; its key is still in KEY_DIR`);
    }
  }
}

console.log("");
console.log(`${failures === 0 ? "every check passed" : `${failures} checks failed`}; mint ${mint}, not in sales.json`);
process.exit(failures === 0 ? 0 : 1);
