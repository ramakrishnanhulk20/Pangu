/**
 * Runs the mainnet build of the app against the forked-mainnet validator, from
 * the pages themselves, the way an issuer and a buyer would.
 *
 *   node lab-evidence/network-fork.mjs http://localhost:3471 <folder for the throwaway key>
 *
 * Needs a verification server built and started with
 *   NEXT_PUBLIC_PANGU_NETWORK=mainnet
 *   NEXT_PUBLIC_MAINNET_RPC_URL=http://localhost:8899
 *   MAINNET_RPC_URL=http://localhost:8899
 * and the validator scripts/wsl/mainnet-rehearsal.sh starts, with Pangu's
 * mainnet build deployed on it. Never the dev server on 3000.
 *
 * Nothing here can reach mainnet. Every chain call goes to localhost:8899, the
 * run stops unless that node's genesis hash is not mainnet's, and the browser
 * refuses every request to any host but this machine, so a transaction the page
 * builds can only ever land on the fork.
 *
 * The throwaway wallet is made here and kept only in the folder given, outside
 * the repository. It is funded on the fork alone: SOL by the local validator's
 * airdrop, USDC and AAPLx moved to it from the rehearsal's own wallets, which
 * were handed those tokens at genesis. No key is printed.
 *
 *   1. /launch offers USDC and the stock tokens whose DBC badge is on chain;
 *      the fork cloned only AAPLx's badge, so only AAPLx may show.
 *   2. A USDC sale with a 5 percent ceiling on Apple is launched from the page,
 *      and its terms are read back off the chain.
 *   3. On its sale page: a buy under the cap lands, a bigger buy still under the
 *      cap is refused by the ceiling in the page's own check before signing,
 *      and the shares are sold back.
 *   4. An AAPLx-paid sale with no ceiling is launched, read back, and bought
 *      into, its amounts written in AAPLx.
 *   5. /sales, both sale pages and /portfolio load with the wallet connected.
 *   6. The demo dollar route answers 404 and every page says "rehearsal".
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PANGU_PROGRAM_ID, getSale } from "pangu-sdk";

import { builtCurve } from "../lib/launch-curve.ts";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3471";
const keyFolder = process.argv[3];
if (/:3000\b/.test(base)) {
  throw new Error("port 3000 is Ram's dev server; point this at a verification server");
}
if (keyFolder === undefined) {
  throw new Error("name a folder outside the repository for the throwaway key");
}

const RPC = "http://localhost:8899";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const APPLE_FEED = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
const WSL_HOME = "//wsl.localhost/Ubuntu/home/ram";
const LANDING_MS = 180_000;

const connection = new Connection(RPC, "confirmed");

let failures = 0;
function check(label, ok, detail) {
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail === undefined ? "" : `: ${detail}`}`);
}

function wallet(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

// The fork, not mainnet, before anything else is done.
const genesis = await connection.getGenesisHash();
if (genesis === MAINNET_GENESIS) {
  throw new Error("the node at localhost:8899 reports mainnet's genesis; this run only ever talks to a local fork");
}
const program = await connection.getAccountInfo(PANGU_PROGRAM_ID);
if (program === null || !program.executable) {
  throw new Error("Pangu is not deployed on the fork");
}
console.log(`fork     : ${RPC}, genesis ${genesis}, not mainnet's`);
console.log(`program  : ${PANGU_PROGRAM_ID.toBase58()}, executable on the fork`);
console.log(`site     : ${base}, built for mainnet`);

const throwaway = Keypair.generate();
mkdirSync(keyFolder, { recursive: true });
writeFileSync(join(keyFolder, "network-fork-throwaway.json"), JSON.stringify(Array.from(throwaway.secretKey)));
const owner = throwaway.publicKey.toBase58();
console.log(`wallet   : ${owner}, a throwaway made for this run, its key kept outside the repository`);

async function land(transaction, signers) {
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = signers[0].publicKey;
  transaction.sign(...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  return signature;
}

async function tokenBalance(account) {
  const answer = await connection.getTokenAccountBalance(account, "confirmed").catch(() => null);
  return answer === null ? 0n : BigInt(answer.value.amount);
}

// Funding, on the fork only.
{
  const airdrop = await connection.requestAirdrop(throwaway.publicKey, 5 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdrop, "confirmed");
  const usdcDonor = wallet(`${WSL_HOME}/pangu-rehearsal/accounts/usdc-buyer-1.json`);
  const stockDonor = wallet(`${WSL_HOME}/pangu-fork-accounts/stock-buyer.json`);
  const usdcTo = getAssociatedTokenAddressSync(USDC, throwaway.publicKey, false, TOKEN_PROGRAM_ID);
  const aaplxTo = getAssociatedTokenAddressSync(AAPLX, throwaway.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const funding = new Transaction()
    .add(createAssociatedTokenAccountIdempotentInstruction(throwaway.publicKey, usdcTo, throwaway.publicKey, USDC, TOKEN_PROGRAM_ID))
    .add(
      createTransferCheckedInstruction(
        getAssociatedTokenAddressSync(USDC, usdcDonor.publicKey, false, TOKEN_PROGRAM_ID),
        USDC,
        usdcTo,
        usdcDonor.publicKey,
        50_000n * 10n ** 6n,
        6,
        [],
        TOKEN_PROGRAM_ID
      )
    )
    .add(createAssociatedTokenAccountIdempotentInstruction(throwaway.publicKey, aaplxTo, throwaway.publicKey, AAPLX, TOKEN_2022_PROGRAM_ID))
    .add(
      createTransferCheckedInstruction(
        getAssociatedTokenAddressSync(AAPLX, stockDonor.publicKey, false, TOKEN_2022_PROGRAM_ID),
        AAPLX,
        aaplxTo,
        stockDonor.publicKey,
        20n * 10n ** 8n,
        8,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );
  await land(funding, [throwaway, usdcDonor, stockDonor]);
  console.log(
    `funded   : 5 SOL by the fork's airdrop, ${Number(await tokenBalance(usdcTo)) / 1e6} USDC and ${
      Number(await tokenBalance(aaplxTo)) / 1e8
    } AAPLx from the rehearsal's genesis wallets`
  );
}

// Where the rehearsal planted Apple's price, so the ceiling sale opens under
// its ceiling and a buy under the cap can still cross it.
const manifest = JSON.parse(readFileSync(`${WSL_HOME}/pangu-rehearsal/accounts/rehearsal.json`, "utf8"));
const stock = Number(BigInt(manifest.stockPrice)) / 1e18;
const ceiling = stock * 1.05;
const KEPT = 20;
const SUPPLY = 1000;
// The curve opens a tenth under the ceiling. With 20 percent kept back the price
// passes the ceiling about 6 percent of the way along the curve, inside a 10
// percent cap, so the ceiling, not the cap, is what stops the bigger buy.
const opening = ceiling / 1.1;
const raise = Math.round(((opening * SUPPLY * (1 - KEPT / 100) ** 2) / (KEPT / 100)) * 100) / 100;
const curveShares = Number(builtCurve({ quoteDecimals: 6, baseDecimals: 9, supply: SUPPLY, migrationPercent: KEPT, threshold: raise }).swapBaseAmount) / 1e9;
const underCap = Math.floor(curveShares * 0.03);
const pastCeiling = Math.floor(curveShares * 0.05);
console.log(`apple    : $${stock.toFixed(4)} on the fork, a 5 percent ceiling at $${ceiling.toFixed(4)}`);
console.log(`curve    : ${SUPPLY} shares, ${KEPT} percent kept, raise $${raise}, ${curveShares.toFixed(2)} on the curve`);

// The browser. Every request to a host other than this machine is refused.
const blocked = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
await context.route(
  (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
  (route) => {
    blocked.push(new URL(route.request().url()).hostname);
    return route.abort();
  }
);
await context.exposeFunction("__panguForkSign", async (base64) => {
  const transaction = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  transaction.sign([throwaway]);
  return Buffer.from(transaction.serialize()).toString("base64");
});
// The wallet adapter names a localhost endpoint solana:localnet and refuses a
// wallet that does not list it, so the rehearsal wallet lists both.
await context.addInitScript(
  ({ address, publicKey }) => {
    window.localStorage.setItem("walletName", JSON.stringify("Pangu Test Wallet"));
    window.localStorage.setItem("theme", "dark");
    const toBase64 = (bytes) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
    const fromBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
    const account = Object.freeze({
      address,
      publicKey: Uint8Array.from(publicKey),
      chains: ["solana:mainnet", "solana:localnet"],
      features: ["solana:signTransaction"],
    });
    const testWallet = {
      version: "1.0.0",
      name: "Pangu Test Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iI2M4ZjEzNSIvPjwvc3ZnPg==",
      chains: ["solana:mainnet", "solana:localnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: async (...inputs) => {
            const outputs = [];
            for (const input of inputs) {
              outputs.push({ signedTransaction: fromBase64(await window.__panguForkSign(toBase64(input.transaction))) });
            }
            return outputs;
          },
        },
      },
    };
    const register = ({ register: add }) => add(testWallet);
    window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  },
  { address: owner, publicKey: Array.from(throwaway.publicKey.toBytes()) }
);
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

async function visit(path, ready) {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 120_000 });
  if (ready !== undefined) {
    await page.waitForSelector(ready, { timeout: 120_000 });
  }
  const strip = page.getByTestId("network-strip");
  await strip.waitFor({ timeout: 15_000 }).catch(() => {});
  check(`${path}: the page says rehearsal`, (await strip.getAttribute("data-verdict").catch(() => null)) === "rehearsal");
}

async function shot(name, width = 1440) {
  await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `lab-evidence/network-${name}-${width}.png` });
}

async function launched(label) {
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-testid=launch-go]");
    return button !== null && !button.disabled;
  }, undefined, { timeout: 60_000 });
  await page.getByTestId("launch-go").click();
  await page.waitForSelector("[data-testid=launch-done], [data-testid^=launch-failure-]", { timeout: LANDING_MS });
  const done = page.getByTestId("launch-done");
  if ((await done.count()) === 0) {
    const failed = page.locator("[data-testid^=launch-failure-]").first();
    check(`${label} reached the done state`, false, (await failed.innerText()).replace(/\s+/g, " "));
    return null;
  }
  const mint = await done.getAttribute("data-mint");
  check(`${label} reached the done state`, true, mint);
  return mint;
}

async function settled(statusId) {
  await page.waitForFunction(
    (id) => {
      const nodes = document.querySelectorAll(`[data-testid=${id}]`);
      const node = nodes[nodes.length - 1];
      return node !== undefined && nodes.length === 1 && ["landed", "refused", "failed"].includes(node.getAttribute("data-step"));
    },
    statusId,
    { timeout: LANDING_MS }
  );
  const status = page.locator(`[data-testid=${statusId}]`).last();
  return { step: await status.getAttribute("data-step"), text: (await status.innerText()).replace(/\s+/g, " ").trim() };
}

async function press(button) {
  await page.waitForFunction((id) => {
    const node = document.querySelector(`[data-testid=${id}]`);
    return node !== null && !node.disabled;
  }, button, { timeout: 60_000 });
  await page.click(`[data-testid=${button}]`);
  await page.waitForFunction(
    () => {
      const nodes = document.querySelectorAll("[data-testid=trade-status]");
      const node = nodes[nodes.length - 1];
      return node !== undefined && ["checking", "signing", "pending", "landed"].includes(node.getAttribute("data-step"));
    },
    undefined,
    { timeout: 15_000 }
  );
  return settled("trade-status");
}

async function verdict() {
  await page.waitForSelector("[data-testid=trade-check] [data-verdict]", { timeout: 60_000 });
  const node = page.locator("[data-testid=trade-check] [data-verdict]");
  return { verdict: await node.getAttribute("data-verdict"), text: (await node.innerText()).replace(/\s+/g, " ").trim() };
}

async function holdingLine(before = null) {
  await page.waitForFunction(
    (previous) => {
      const text = document.querySelector("[data-testid=trade-holding]")?.textContent ?? "";
      return /You hold/.test(text) && (previous === null || text.trim() !== previous);
    },
    before,
    { timeout: 90_000 }
  );
  return (await page.getByTestId("trade-holding").innerText()).trim();
}

let ceilingMint = null;
let stockMint = null;

try {
  // The front page: the ledger holds its simulate-only line on mainnet.
  await visit("/", "[data-testid=break-section]");
  check("the attack ledger says simulate only, with no send toggle", (await page.getByTestId("break-simulate-only").count()) === 1);
  check("no 'send for real' switch on the page", (await page.getByRole("button", { name: "send for real" }).count()) === 0);
  await page.getByTestId("break-simulate-only").scrollIntoViewIfNeeded();
  await shot("ledger-simulate-only");

  const dollars = await page.evaluate(async (wallet) => {
    const answer = await fetch("/api/break/dollars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet }),
    });
    return { status: answer.status, body: await answer.json() };
  }, owner);
  check("the demo dollar route answers 404 on mainnet", dollars.status === 404, `${dollars.status} ${dollars.body.reason}`);

  // 1. What buyers may pay in.
  await visit("/launch", "[data-testid=launch-go]");
  await page.getByTestId("launch-paying-aaplx").waitFor({ timeout: 60_000 });
  const offered = await page.locator("#launch-paying [role=radio]").allInnerTexts();
  console.log(`paying   : ${offered.join(", ")}`);
  check("USDC is the default paying token", (await page.getByTestId("launch-paying-usdc").getAttribute("aria-checked")) === "true");
  check("AAPLx is offered, its badge being on the fork", offered.includes("AAPLx"));
  check(
    "TSLAx, NVDAx and SPYx are left out, their badges not being cloned into the fork",
    !offered.includes("TSLAx") && !offered.includes("NVDAx") && !offered.includes("SPYx")
  );
  check("no demo dollar and no devnet SOL on mainnet", !offered.some((label) => /demo|devnet/i.test(label)));
  await page.getByTestId("launch-balance").filter({ hasText: "SOL" }).waitFor({ timeout: 60_000 });
  check("the balance is written in SOL, not devnet SOL", !/devnet/i.test(await page.getByTestId("launch-balance").innerText()));
  await page.locator("#launch-paying").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -160));
  await shot("launch-paying");
  await shot("launch-paying", 375);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 2. A USDC sale with a ceiling on Apple.
  await page.getByTestId("launch-band-on").click();
  await page.getByTestId("launch-feed-apple").click();
  for (const [id, value] of Object.entries({
    "launch-name": "Pangu Rehearsal Ceiling",
    "launch-symbol": "PRCEIL",
    "launch-supply": String(SUPPLY),
    "launch-raise": String(raise),
    "launch-kept": String(KEPT),
    "launch-cap": "10",
    "launch-days": "14",
    "launch-band-percent": "5",
  })) {
    await page.getByTestId(id).fill(value);
  }
  console.log("");
  console.log("launch 1 : PRCEIL, USDC, open, 5 percent over Apple, cap 10 percent, 14 days");
  ceilingMint = await launched("launch 1");
  if (ceilingMint !== null) {
    const sale = await getSale(connection, new PublicKey(ceilingMint));
    check("launch 1: the sale reads back from the fork", sale !== null);
    check("launch 1: paid in USDC", sale?.quoteMint?.equals(USDC) === true, sale?.quoteMint?.toBase58());
    check("launch 1: ceiling 5 percent", sale?.hasBand === true && sale.bandBps === 500, String(sale?.bandBps));
    check("launch 1: ceiling follows Apple's exchange price", sale?.priceFeedId === APPLE_FEED);
    check("launch 1: issuer is the throwaway", sale?.issuer.toBase58() === owner);
    const link = await page.getByTestId("launch-done").locator("a[href*='explorer.solana.com']").first().getAttribute("href");
    check("launch 1: explorer links point at the fork, never at mainnet", /cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899/.test(link ?? ""), link);
    await page.getByTestId("launch-done").scrollIntoViewIfNeeded();
    await shot("launch-done");

    // 3. Buy under the cap, meet the ceiling, sell back.
    await visit(`/sale/${ceilingMint}`, "[data-testid=trade-panel]");
    const before = await holdingLine();
    console.log(`holding  : ${before}`);
    await page.fill("[data-testid=trade-amount]", String(underCap));
    const first = await verdict();
    console.log(`check    : ${underCap} shares, ${first.verdict}, "${first.text}"`);
    check(`a buy of ${underCap} shares passes the page's check`, first.verdict === "pass");
    const bought = await press("trade-buy");
    console.log(`buy      : ${bought.step}, "${bought.text}"`);
    check("the buy under the cap landed", bought.step === "landed");
    const afterBuy = await holdingLine(before);
    console.log(`holding  : ${afterBuy}`);

    await page.fill("[data-testid=trade-amount]", String(pastCeiling));
    const refused = await verdict();
    console.log(`check    : ${pastCeiling} more shares, ${refused.verdict}, "${refused.text}"`);
    check(
      `a further ${pastCeiling} shares, still under the cap, is refused by the ceiling before signing`,
      refused.verdict === "refused" && /too far above the real stock price/i.test(refused.text)
    );
    check("the buy button is held while the rules refuse", await page.getByTestId("trade-buy").isDisabled());
    await page.getByTestId("trade-check").scrollIntoViewIfNeeded();
    await shot("ceiling-refusal");
    await shot("ceiling-refusal", 375);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.click("[data-testid=trade-mode-sell]");
    await page.fill("[data-testid=trade-amount]", String(underCap));
    const sold = await press("trade-sell");
    console.log(`sell     : ${sold.step}, "${sold.text}"`);
    check("the shares sold back", sold.step === "landed");
    // Read off the chain: the holding line changes shape with the mode, not only the amount.
    const left = await tokenBalance(getAssociatedTokenAddressSync(new PublicKey(ceilingMint), throwaway.publicKey, false, TOKEN_2022_PROGRAM_ID));
    console.log(`holding  : ${Number(left) / 1e9} shares left on chain after selling ${underCap} back`);
    check("under a thousandth of a share left after the sell", left < 1_000_000n, `${left} raw units`);
  }

  // 4. An AAPLx-paid sale with no ceiling.
  await visit("/launch", "[data-testid=launch-go]");
  await page.getByTestId("launch-paying-aaplx").click();
  check("paying in AAPLx turns the ceiling off and says why", (await page.getByTestId("launch-band-sol").count()) === 1);
  console.log(`ceiling  : ${(await page.getByTestId("launch-band-sol").innerText()).replace(/\s+/g, " ")}`);
  for (const [id, value] of Object.entries({
    "launch-name": "Pangu Rehearsal AAPLx",
    "launch-symbol": "PRAAPL",
    "launch-supply": String(SUPPLY),
    "launch-raise": "100",
    "launch-kept": String(KEPT),
    "launch-cap": "10",
    "launch-days": "14",
  })) {
    await page.getByTestId(id).fill(value);
  }
  // The suffix is set in capitals by its style, so the words are compared without case.
  check("the raise is written in AAPLx", /aaplx/i.test(await page.locator("#launch-raise").locator("..").innerText()));
  console.log("");
  console.log("launch 2 : PRAAPL, AAPLx, open, no ceiling, cap 10 percent, 14 days");
  stockMint = await launched("launch 2");
  if (stockMint !== null) {
    const sale = await getSale(connection, new PublicKey(stockMint));
    check("launch 2: paid in AAPLx", sale?.quoteMint?.equals(AAPLX) === true, sale?.quoteMint?.toBase58());
    check("launch 2: no ceiling", sale?.hasBand === false);
    await visit(`/sale/${stockMint}`, "[data-testid=trade-panel]");
    const before = await holdingLine();
    await page.fill("[data-testid=trade-amount]", "5");
    const quote = (await page.getByTestId("trade-quote").innerText()).replace(/\s+/g, " ").trim();
    console.log(`quote    : ${quote}`);
    check("the quote is written in AAPLx, never in dollars", /AAPLx/.test(quote) && !/\$/.test(quote));
    const bought = await press("trade-buy");
    console.log(`buy      : ${bought.step}, "${bought.text}"`);
    check("a buy paid in AAPLx landed", bought.step === "landed");
    console.log(`holding  : ${await holdingLine(before)}`);
    await shot("sale-aaplx");
  }

  // 5. The directory, both sale pages and the portfolio.
  await visit("/sales", "[data-testid=sales-ledger]");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=sales-row]").length >= 2, undefined, { timeout: 60_000 });
  const rows = await page.getByTestId("sales-row").allInnerTexts();
  check("/sales lists both launched sales", rows.some((row) => row.includes("PRCEIL")) && rows.some((row) => row.includes("PRAAPL")));
  check("/sales writes the AAPLx sale in AAPLx", rows.some((row) => row.includes("PRAAPL") && /AAPLx/.test(row)));
  await shot("sales");
  if (ceilingMint !== null) {
    await visit(`/sale/${ceilingMint}`, "[data-testid=sale-title]");
    await shot("sale-usdc");
  }
  await visit("/portfolio", "[data-testid=portfolio]");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=portfolio-issued-row]").length >= 2, undefined, { timeout: 90_000 });
  const issued = await page.getByTestId("portfolio-issued-row").count();
  const held = await page.getByTestId("portfolio-row").count();
  check("/portfolio shows both sales this wallet issued", issued >= 2, `${issued} issued`);
  check("/portfolio shows the AAPLx holding", held >= 1, `${held} held`);
  console.log(`totals   : ${(await page.getByTestId("portfolio-totals").innerText().catch(() => "none")).replace(/\s+/g, " ")}`);
  await shot("portfolio");
  await shot("portfolio", 375);

  // The price refresh, with no refresh key set on this server.
  if (ceilingMint !== null) {
    const refresh = await page.evaluate(async (mint) => {
      const answer = await fetch("/api/price/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint }),
      });
      return { status: answer.status, body: await answer.json() };
    }, ceilingMint);
    console.log(`refresh  : ${refresh.status} ${JSON.stringify(refresh.body)}`);
  }

  check("no uncaught errors on any page", pageErrors.length === 0, pageErrors.join(" | "));
  console.log(`blocked  : ${blocked.length === 0 ? "no request tried to leave this machine" : [...new Set(blocked)].join(", ")}`);
} catch (error) {
  failures += 1;
  console.log(`FAIL  the run stopped: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
} finally {
  await browser.close();
}

console.log("");
console.log(`${failures === 0 ? "every check passed" : `${failures} checks failed`}; mints ${ceilingMint} and ${stockMint}, on the fork only`);
process.exit(failures === 0 ? 0 : 1);
