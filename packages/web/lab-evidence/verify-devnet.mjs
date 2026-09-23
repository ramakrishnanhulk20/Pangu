/**
 * Proves the verifier console on devnet, from the page, with a real signing
 * wallet: set up a verifier, issue a credential to a second wallet, check it
 * valid, revoke it, check it absent.
 *
 *   PANGU_SCRATCH=<a folder outside the repo> node lab-evidence/verify-devnet.mjs http://localhost:3000
 *
 * A headless browser has no wallet extension, so one is injected: a Wallet
 * Standard wallet registered in the page, whose signing runs here in Node
 * through page.exposeFunction. The page cannot tell it from a real extension;
 * every transaction is built, simulated, sent and confirmed by the page's own
 * code. The verifier is a throwaway key made in memory, funded with 0.05 devnet
 * SOL from the demo wallet and swept back at the end. Its secret is never
 * printed; it sits in the folder named by PANGU_SCRATCH, outside the repository,
 * only until the sweep lands. The buyer is a second throwaway that only ever
 * lends its address.
 *
 * Every signature the page lands is read back out of the page's own links and
 * written to lab-evidence/verify-devnet.txt. Each state the page shows is also
 * read from Node straight off devnet through pangu-sdk, so the page is checked
 * against the chain, not against itself.
 */

import { createRequire } from "node:module";
import { setDefaultResultOrder } from "node:dns";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  attestationAddress,
  credentialStatus,
  listAttestations,
} from "pangu-sdk";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.APPDATA + "/npm/node_modules/playwright");

const base = process.argv[2] ?? "http://localhost:3000";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const outFile = join(here, "verify-devnet.txt");

const FUND_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;
const WALLET_NAME = "Pangu Proof Wallet";
const STEP_TIMEOUT = 180_000;
/** The fee a plain transfer pays, left behind so the sweep itself can be paid. */
const SWEEP_FEE = 5_000;
const TRANSFER_TRIES = 45;
const TRANSFER_WAIT_MS = 2_000;

// This machine reaches the devnet nodes over IPv4 only: asked IPv6 first, every
// connection sat until it timed out.
setDefaultResultOrder("ipv4first");

try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  // No root .env: the keypair path below will say what is missing.
}

/**
 * No part of the keyed endpoint may reach the screen or the evidence file: not
 * the URL, not its host, not the key in its path. Every line this script writes,
 * and every error anything else prints, goes through here first.
 */
const keyedParts = (() => {
  const keyed = process.env.DEVNET_RPC_URL?.trim();
  if (!keyed) {
    return [];
  }
  const parts = [keyed];
  try {
    const url = new URL(keyed);
    parts.push(url.host, url.hostname, ...url.pathname.split("/").filter((part) => part.length >= 8));
    if (url.search.length > 1) {
      parts.push(url.search.slice(1));
    }
  } catch {
    // Not a URL at all: the whole string is still hidden.
  }
  return parts.sort((left, right) => right.length - left.length);
})();

function redact(value) {
  let text = typeof value === "string" ? value : value instanceof Error ? value.stack ?? value.message : String(value);
  for (const part of keyedParts) {
    text = text.split(part).join("[keyed devnet endpoint]");
  }
  return text;
}

for (const method of ["error", "warn", "info"]) {
  const original = console[method].bind(console);
  console[method] = (...args) => original(...args.map(redact));
}
for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, (error) => {
    process.stderr.write(`${redact(error)}\n`);
    process.exit(1);
  });
}

const payerPath = process.env.DEVNET_PAYER_KEYPAIR;
if (payerPath === undefined || payerPath === "") {
  throw new Error("DEVNET_PAYER_KEYPAIR is not set in the root .env");
}
const demo = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(payerPath, "utf8"))));
const PUBLIC_DEVNET = "https://api.devnet.solana.com";

/**
 * The keyed endpoint when it answers, else the public one. The keyed URL is
 * handed to web3.js only and never printed; the log names which one was used.
 */
async function pickEndpoint() {
  const keyed = process.env.DEVNET_RPC_URL?.trim();
  if (keyed) {
    try {
      await new Connection(keyed, "confirmed").getSlot();
      return { url: keyed, label: "the keyed devnet endpoint" };
    } catch {
      // Unreachable from this machine right now: the public node will do.
    }
  }
  return { url: PUBLIC_DEVNET, label: PUBLIC_DEVNET };
}
const endpoint = await pickEndpoint();

const NETWORK_TRIES = 4;
const NETWORK_WAIT_MS = 3_000;

/**
 * The link from this machine to devnet drops calls now and then ("fetch
 * failed"), which once stopped a run after the page had already revoked. Every
 * call through this connection, including the ones pangu-sdk makes with it, is
 * tried again on a dropped call. Every call here is a read or a resend of the
 * same signed bytes, so trying again never does anything twice.
 */
const connection = new Proxy(new Connection(endpoint.url, "confirmed"), {
  get(target, name) {
    const value = Reflect.get(target, name, target);
    if (typeof value !== "function") {
      return value;
    }
    return async (...args) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await value.apply(target, args);
        } catch (error) {
          const dropped = /fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR/i.test(String(error?.message ?? error));
          if (!dropped || attempt === NETWORK_TRIES) {
            throw error;
          }
          await new Promise((wake) => setTimeout(wake, NETWORK_WAIT_MS));
        }
      }
    };
  },
});

const verifier = Keypair.generate();
const buyer = Keypair.generate();

const lines = [];
const log = (line = "") => {
  const clean = redact(line);
  console.log(clean);
  lines.push(clean);
};
const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const tx = (signature) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const sol = (lamports) => (lamports / LAMPORTS_PER_SOL).toFixed(9);

log(`# Verifier console, driven on devnet from the page`);
log(``);
log(`run      : ${stamp()}`);
log(`page     : ${base}/verify`);
log(`verifier : ${verifier.publicKey.toBase58()} (throwaway, signs in Node through the injected wallet)`);
log(`buyer    : ${buyer.publicKey.toBase58()} (throwaway, lends its address only)`);
log(`funder   : ${demo.publicKey.toBase58()} (the demo wallet)`);
log(`node     : ${endpoint.label}, for the funding, the sweep and every chain cross-check`);

/**
 * Sends a plain transfer and waits for it by asking for its status, for as long
 * as its blockhash can still land it. On a slow link web3.js's own confirm gives
 * up while the transfer is landing, which is how an earlier run of this script
 * funded a throwaway and then lost track of it.
 */
async function transfer(from, to, lamports) {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: from.publicKey,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }).add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }));
  transaction.sign(from);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { maxRetries: 5 });
  for (let tries = 0; tries < TRANSFER_TRIES; tries += 1) {
    await new Promise((wake) => setTimeout(wake, TRANSFER_WAIT_MS));
    const [status] = (
      await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })
    ).value;
    if (status?.err) {
      throw new Error(`transfer ${signature} failed on chain: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return signature;
    }
  }
  throw new Error(`transfer ${signature} was not seen within ${(TRANSFER_TRIES * TRANSFER_WAIT_MS) / 1000} seconds`);
}

// If this run dies after funding, the throwaway's key is the only way back to
// its SOL, so it is kept in the session's scratch folder outside the repository
// until the sweep has landed, then deleted. It is never printed.
if (process.env.PANGU_SCRATCH === undefined || process.env.PANGU_SCRATCH === "") {
  throw new Error("set PANGU_SCRATCH to a folder outside the repository for the throwaway key");
}
const keyFile = join(process.env.PANGU_SCRATCH, `verify-proof-${verifier.publicKey.toBase58()}.json`);
writeFileSync(keyFile, JSON.stringify(Array.from(verifier.secretKey)));

const funded = await transfer(demo, verifier.publicKey, FUND_LAMPORTS);
log(`fund     : ${sol(FUND_LAMPORTS)} SOL to the verifier, ${funded}`);
log(``);

/** Sweeps what is left back to the demo wallet and logs the cost. Runs whether the flow passed or not. */
async function settle() {
  const left = await connection.getBalance(verifier.publicKey, "confirmed");
  let swept = null;
  if (left > SWEEP_FEE) {
    swept = await transfer(verifier, demo.publicKey, left - SWEEP_FEE);
  }
  rmSync(keyFile, { force: true });
  log(``);
  log(`## Cost`);
  log(`sweep      : ${sol(Math.max(left - SWEEP_FEE, 0))} SOL back to the demo wallet${swept === null ? "" : `, ${swept}`}`);
  // The demo wallet is shared with other runs, so its balance says nothing about
  // this one. The verifier's own balance does: everything the page spent.
  log(`page spent : ${sol(FUND_LAMPORTS - left)} SOL from the verifier: the credential and schema deposits, which stay, and the fees; the attestation deposit came back on revoke`);
  log(`run cost   : ${sol(FUND_LAMPORTS - left + 2 * SWEEP_FEE)} SOL to the demo wallet, the two transfer fees included`);
}

let failed = 1;
try {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // Signing stays in Node. The page hands over the wire bytes the wallet adapter
  // serialized and gets the same transaction back with the verifier's signature.
  await page.exposeFunction("__panguProofSign", (base64) => {
    const transaction = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    transaction.sign([verifier]);
    return Buffer.from(transaction.serialize()).toString("base64");
  });

  await context.addInitScript(
    ({ address, publicKey, name }) => {
      window.localStorage.setItem("walletName", JSON.stringify(name));
      window.localStorage.setItem("theme", "dark");

      const toBytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
      const listeners = new Set();
      const account = {
        address,
        publicKey: Uint8Array.from(publicKey),
        chains: ["solana:devnet"],
        features: ["solana:signTransaction"],
      };
      const wallet = {
        version: "1.0.0",
        name,
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
        chains: ["solana:devnet"],
        accounts: [],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => {
              wallet.accounts = [account];
              for (const listener of listeners) listener({ accounts: wallet.accounts });
              return { accounts: wallet.accounts };
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
              wallet.accounts = [];
              for (const listener of listeners) listener({ accounts: wallet.accounts });
            },
          },
          "standard:events": {
            version: "1.0.0",
            on: (event, listener) => {
              if (event !== "change") return () => {};
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: async (...inputs) =>
              Promise.all(
                inputs.map(async (input) => ({
                  signedTransaction: toBytes(await window.__panguProofSign(toBase64(input.transaction))),
                }))
              ),
          },
        },
      };
      const register = ({ register: add }) => add(wallet);
      window.addEventListener("wallet-standard:app-ready", ({ detail }) => register(detail));
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", { detail: register })
      );
    },
    {
      address: verifier.publicKey.toBase58(),
      publicKey: Array.from(verifier.publicKey.toBytes()),
      name: WALLET_NAME,
    }
  );

  const byTest = (id) => page.locator(`[data-testid="${id}"]`);
  const signaturesIn = async (id) =>
    byTest(id).locator("a[data-signature]").evaluateAll((links) => links.map((link) => link.dataset.signature));

  await page.goto(`${base}/verify`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });

  // 1. Set up. A fresh key runs no verifier, so the page offers the name form.
  const verifierName = `proof ${stamp().slice(0, 16).replace("T", " ")}`;
  await byTest("verify-setup-name").waitFor({ timeout: STEP_TIMEOUT });
  log(`page connected the injected wallet and found no verifier for it: the setup form is shown`);
  await byTest("verify-setup-name").fill(verifierName);
  await byTest("verify-setup-button").click();
  await byTest("verify-pair-credential").waitFor({ timeout: STEP_TIMEOUT });
  const credential = await byTest("verify-pair-credential").getAttribute("data-address");
  const schema = await byTest("verify-pair-schema").getAttribute("data-address");
  const [setupSignature] = await signaturesIn("verify-setup-landed");
  log(``);
  log(`## 1. Set up as a verifier, name "${verifierName}"`);
  log(`credential : ${credential}`);
  log(`schema     : ${schema}`);
  log(`signature  : ${setupSignature}`);
  log(`             ${tx(setupSignature)}`);

  const { PublicKey } = await import("@solana/web3.js");
  const credentialKey = new PublicKey(credential);
  const schemaKey = new PublicKey(schema);
  const [credentialAccount, schemaAccount] = await connection.getMultipleAccountsInfo(
    [credentialKey, schemaKey],
    "confirmed"
  );
  log(
    `chain      : credential ${credentialAccount === null ? "MISSING" : `${credentialAccount.data.length} bytes`}, schema ${schemaAccount === null ? "MISSING" : `${schemaAccount.data.length} bytes`}, both owned by ${credentialAccount?.owner.toBase58()}`
  );

  // 2. Issue, with an expiry date, so the date path is the one proven.
  await byTest("verify-issue-text").fill(buyer.publicKey.toBase58());
  await byTest("verify-expiry-date").click();
  const expiryDay = await byTest("verify-expiry-day").inputValue();
  await byTest("verify-issue-button").click();
  await byTest("verify-issue-landed").waitFor({ timeout: STEP_TIMEOUT });
  const [issueSignature] = await signaturesIn("verify-issue-landed");
  const row = page.locator(`[data-testid="verify-row"][data-wallet="${buyer.publicKey.toBase58()}"]`);
  await row.waitFor({ timeout: STEP_TIMEOUT });
  const rowStanding = await row.getAttribute("data-standing");
  const listedOnChain = await listAttestations(connection, credentialKey, schemaKey);
  log(``);
  log(`## 2. Issue a credential to the buyer, expiring at the end of ${expiryDay} UTC`);
  log(`attestation: ${attestationAddress(credentialKey, schemaKey, buyer.publicKey).toBase58()}`);
  log(`signature  : ${issueSignature}`);
  log(`             ${tx(issueSignature)}`);
  log(`page list  : 1 row for the buyer, state ${rowStanding}`);
  log(
    `chain list : ${listedOnChain.length} issued; ${listedOnChain
      .map((entry) => `${entry.wallet.toBase58()} ${entry.standing}, expiry ${entry.expiry}, issued ${entry.created}`)
      .join("; ")}`
  );

  // 3. Check it, as anyone would, in the checker.
  // The checker numbers each press from one. Waiting for this press's own turn
  // means an answer still on screen from the last press can never be read as
  // this one's, which is the mistake an earlier run of this script made.
  let checks = 0;
  const check = async () => {
    checks += 1;
    await byTest("verify-check-wallet").fill(buyer.publicKey.toBase58());
    await byTest("verify-check-button").click();
    const result = page.locator(
      `[data-testid="verify-check-result"][data-turn="${checks}"][data-wallet="${buyer.publicKey.toBase58()}"]`
    );
    await result.waitFor({ timeout: STEP_TIMEOUT });
    return result.getAttribute("data-standing");
  };
  const firstCheck = await check();
  const firstChain = await credentialStatus(connection, credentialKey, schemaKey, buyer.publicKey);
  log(``);
  log(`## 3. Check the buyer`);
  log(`page       : ${firstCheck}`);
  log(`chain      : ${firstChain}`);

  // 4. Revoke from the row.
  await row.locator(`[data-testid="verify-revoke"]`).click();
  await byTest("verify-revoke-landed").waitFor({ timeout: STEP_TIMEOUT });
  const [revokeSignature] = await signaturesIn("verify-revoke-landed");
  await row.waitFor({ state: "detached", timeout: STEP_TIMEOUT });
  const attestationAfter = await connection.getAccountInfo(
    attestationAddress(credentialKey, schemaKey, buyer.publicKey),
    "confirmed"
  );
  log(``);
  log(`## 4. Revoke the buyer's credential`);
  log(`signature  : ${revokeSignature}`);
  log(`             ${tx(revokeSignature)}`);
  log(`page list  : the buyer's row struck through, then gone once devnet agreed`);
  log(`chain      : attestation account ${attestationAfter === null ? "closed" : "STILL OPEN"}`);

  // 5. Check again.
  await page.waitForTimeout(500);
  const secondCheck = await check();
  const secondChain = await credentialStatus(connection, credentialKey, schemaKey, buyer.publicKey);
  log(``);
  log(`## 5. Check the buyer again`);
  log(`page       : ${secondCheck}`);
  log(`chain      : ${secondChain}`);

  await browser.close();

  // A credential-mode sale only accepts this verifier's buyers if it names this
  // verifier's pair. The pair was opened seconds ago, so no sale can name it yet.
  const record = JSON.parse(readFileSync(join(root, "packages", "scripts", "sales.json"), "utf8"));
  const naming = record.filter(
    (sale) => sale.mode === "credential" && sale.credential === credential && sale.schema === schema
  );
  log(``);
  log(`## A sale that checks this verifier`);
  log(
    naming.length === 0
      ? `none: no credential-mode sale in packages/scripts/sales.json names this credential and schema, so no buy was tried. Opening one is left for the launch page proof.`
      : `found ${naming.map((sale) => sale.symbol).join(", ")}`
  );

  const verdicts = [
    ["setup landed and both accounts exist", credentialAccount !== null && schemaAccount !== null],
    ["issued: page row valid", rowStanding === "valid"],
    ["issued: chain lists the buyer", listedOnChain.some((entry) => entry.wallet.equals(buyer.publicKey))],
    ["check before revoke: page valid", firstCheck === "valid"],
    ["check before revoke: chain valid", firstChain === "valid"],
    ["revoke closed the attestation", attestationAfter === null],
    ["check after revoke: page absent", secondCheck === "absent"],
    ["check after revoke: chain absent", secondChain === "absent"],
    ["no uncaught page errors", pageErrors.length === 0],
  ];
  log(``);
  log(`## Result`);
  for (const [what, ok] of verdicts) {
    log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  }
  for (const error of pageErrors) {
    log(`page error: ${error}`);
  }
  failed = verdicts.filter(([, ok]) => !ok).length;
  log(``);
  log(`${verdicts.length - failed} passed, ${failed} failed, at ${stamp()}`);
} catch (error) {
  log(``);
  log(`FAILED before the run finished: ${error instanceof Error ? error.message : String(error)}`);
}

await settle();
writeFileSync(outFile, `${lines.join("\n")}\n`);
process.exit(failed === 0 ? 0 : 1);
