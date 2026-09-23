/**
 * Proves the Try to break it builders against the live devnet sale.
 *
 *   node lab-evidence/break-simulations.mjs          the sale the screen picks
 *   node lab-evidence/break-simulations.mjs POPEN    one sale, by its symbol
 *
 * A headless browser cannot run this screen, because every row needs a wallet
 * extension to be there. So the same functions the screen calls are called here
 * from Node with a throwaway wallet: each row is sized in shares, built, asked
 * of the program through preflightBuy, simulated against devnet, and the
 * program's own answer is read out of the real logs.
 *
 * One row is sent for real: 01, the honest buy, when the wallet can pay for it.
 * That is what a visitor does first, and it is what gives 03, 06 and 09 a buy
 * behind them. Every other row is simulated, so nothing else lands on chain.
 *
 * The throwaway key is made in memory and never leaves this process. Only its
 * public key is printed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  ATTACKS,
  breakConnection,
  buildAttack,
  payingHeld,
  payingNeeded,
  readLanded,
  readTarget,
  simulateAttack,
  tallyLine,
  tokensHeld,
} from "../lib/break.ts";
import sales from "../../scripts/sales.json" with { type: "json" };

const AIRDROP_SOL = 0.5;
const AIRDROP_TRIES = 3;
const FALLBACK_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;
/**
 * Whole paying tokens handed to the throwaway wallet for the second pass.
 *
 * Large because this sale's cap is worth 24 billion of them: the demo sale is
 * priced in a token minted for the demo, and its threshold was set high.
 */
const PAYING_TOKENS = 100_000_000_000;

// The keyed devnet endpoint lives in the repository root .env. The public one
// stands in when there is none.
try {
  process.loadEnvFile(join(import.meta.dirname, "..", "..", "..", ".env"));
} catch {
  // No root .env: the public endpoint is used.
}
const connection = breakConnection(process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com");
// The funding steps are ordinary sends and want an ordinary connection: the
// paced one holds a blockhash long enough for the node to forget it.
const funder = new Connection(connection.rpcEndpoint, "confirmed");

function repositoryRoot() {
  return join(import.meta.dirname, "..", "..", "..");
}

function demoKeypair() {
  process.loadEnvFile(join(repositoryRoot(), ".env"));
  const path = process.env.DEVNET_PAYER_KEYPAIR;
  if (path === undefined || path === "") {
    return null;
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function wait(ms) {
  await new Promise((wake) => setTimeout(wake, ms));
}

/**
 * Sends one funding transaction.
 *
 * The blockhash is taken at the finalized commitment and the send is tried
 * again on failure: the public devnet endpoint is several nodes behind one
 * address, and one of them can answer that a blockhash another just handed out
 * does not exist.
 */
async function sendOnce(transaction, signers) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      transaction.feePayer = signers[0].publicKey;
      transaction.recentBlockhash = (await funder.getLatestBlockhash("finalized")).blockhash;
      return await sendAndConfirmTransaction(funder, transaction, signers, {
        commitment: "confirmed",
        preflightCommitment: "finalized",
      });
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      await wait(2_000);
    }
  }
}

/**
 * The wallet the ledger runs from.
 *
 * lab-evidence/break-dollars.mjs hands its own throwaway wallet over in
 * PANGU_LEDGER_WALLET, so the rows are run by the very wallet the demo dollar
 * route topped up. That key is made in that process and never touches disk.
 * With the variable unset a fresh throwaway is made here, as before.
 */
function ledgerWallet() {
  const supplied = process.env.PANGU_LEDGER_WALLET;
  if (supplied === undefined || supplied === "") {
    return { wallet: Keypair.generate(), supplied: false };
  }
  return {
    wallet: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(supplied))),
    supplied: true,
  };
}

/** Devnet SOL for the throwaway wallet: the faucet first, the demo key after. */
async function fund(wallet) {
  const already = await funder.getBalance(wallet.publicKey, "confirmed");
  if (already >= FALLBACK_LAMPORTS) {
    return `what it already held, ${already / LAMPORTS_PER_SOL} SOL`;
  }
  for (let attempt = 0; attempt < AIRDROP_TRIES; attempt += 1) {
    try {
      const signature = await funder.requestAirdrop(
        wallet.publicKey,
        AIRDROP_SOL * LAMPORTS_PER_SOL
      );
      await funder.confirmTransaction(signature, "confirmed");
      return `faucet, ${AIRDROP_SOL} SOL`;
    } catch {
      await wait(2_000 * (attempt + 1));
    }
  }
  const demo = demoKeypair();
  if (demo === null) {
    throw new Error("the faucet refused and DEVNET_PAYER_KEYPAIR is not set");
  }
  await sendOnce(
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: demo.publicKey,
        toPubkey: wallet.publicKey,
        lamports: FALLBACK_LAMPORTS,
      })
    ),
    [demo]
  );
  return `demo keypair, ${FALLBACK_LAMPORTS / LAMPORTS_PER_SOL} SOL`;
}

/**
 * Hands the throwaway wallet some of the token the sale is priced in.
 *
 * Only possible when the demo key is that token's mint authority, which is the
 * point the run is making: a visitor's own wallet cannot do this, so every row
 * that spends the paying token is out of a visitor's reach on such a sale.
 */
async function fundPayingToken(wallet, target) {
  const demo = demoKeypair();
  if (demo === null) {
    return "no demo keypair, so the paying token could not be handed over";
  }
  const state = await getMint(funder, target.quoteMint, "confirmed", target.quoteProgram);
  if (state.mintAuthority === null || !state.mintAuthority.equals(demo.publicKey)) {
    return "the demo key does not mint this paying token either";
  }
  const account = getAssociatedTokenAddressSync(
    target.quoteMint,
    wallet.publicKey,
    false,
    target.quoteProgram
  );
  const raw = BigInt(PAYING_TOKENS) * 10n ** BigInt(target.quoteDecimals);
  await sendOnce(
    new Transaction()
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          demo.publicKey,
          account,
          wallet.publicKey,
          target.quoteMint,
          target.quoteProgram
        )
      )
      .add(
        createMintToInstruction(
          target.quoteMint,
          account,
          demo.publicKey,
          raw,
          [],
          target.quoteProgram
        )
      ),
    [demo]
  );
  return `${PAYING_TOKENS} paying tokens minted by the demo key`;
}

function pad(text, width) {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** Raw units of the sale token as shares, with every decimal kept. */
function sharesOf(raw, decimals) {
  if (raw === null) {
    return "-";
  }
  const scale = 10n ** BigInt(decimals);
  const fraction = (raw % scale).toString().padStart(decimals, "0");
  return `${raw / scale}.${fraction}`;
}

function table(rows) {
  const head = ["#", "Attack", "C", "Shares", "Promise", "What the chain said", "How", "Result"];
  const body = rows.map((row) => [
    row.index,
    row.title,
    row.invariant,
    row.shares,
    row.expected,
    row.actual,
    row.how,
    row.result,
  ]);
  const widths = head.map((title, column) =>
    Math.max(title.length, ...body.map((row) => row[column].length))
  );
  const line = (cells) =>
    cells.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd();
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(line)].join("\n");
}

/**
 * Sends row 01 the way the screen's "send for real" does: preflight skipped, so
 * whatever the program says lands on chain, then read back by signature.
 */
async function sendForReal(wallet, built) {
  const transaction = built.transaction;
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = (await funder.getLatestBlockhash("confirmed")).blockhash;
  transaction.sign(wallet, ...built.signers);
  const signature = await funder.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });
  return readLanded(connection, signature);
}

async function runLedger(wallet, firstTarget, label) {
  console.log("");
  console.log(label);
  const rows = [];
  let target = firstTarget;
  let run = 0;
  let refusedAsExpected = 0;
  let allowedAsExpected = 0;
  let off = 0;
  let unseen = 0;
  const sent = [];

  const sizes = [];

  for (const attack of ATTACKS) {
    let expected = attack.promise;
    let shares = "-";
    let actual;
    let how = "simulated";
    let result;
    try {
      if (attack.needsTokens) {
        const held = await tokensHeld(connection, target.mint, wallet.publicKey);
        sizes.push(
          attack.id === "wallet-to-wallet"
            ? `${attack.index} holds ${sharesOf(held, target.baseDecimals)}: half is ${sharesOf(held / 2n, target.baseDecimals)}, a fiftieth of the cap is ${sharesOf(target.cap / 50n, target.baseDecimals)}, the row sends the smaller`
            : `${attack.index} holds ${sharesOf(held, target.baseDecimals)}: the row sells a fifth, ${sharesOf(held / 5n, target.baseDecimals)}`
        );
      }
      const built = await buildAttack(attack.id, {
        connection,
        target,
        wallet: wallet.publicKey,
      });
      expected = built.expected.name;
      shares = sharesOf(built.shares, target.baseDecimals);
      const canPay =
        target.payingInSol ||
        (await payingHeld(connection, target, wallet.publicKey)) >= payingNeeded(attack, target);
      const real = attack.id === "honest-buy" && canPay;
      const answer = real
        ? await sendForReal(wallet, built)
        : await simulateAttack(connection, built);
      if (real) {
        how = "sent";
        sent.push(answer.link ?? answer.signature ?? "no signature");
        // The curve and this wallet's record moved, so the rows after it are
        // sized and asked against the sale as it now stands, as the screen does.
        target = (await readTarget(connection, candidates)) ?? target;
      }
      run += 1;
      if (answer.outcome === "allowed") {
        actual = "it goes through";
      } else if (answer.outcome === "refused") {
        actual = answer.errorName;
      } else if (answer.outcome === "unseen") {
        actual = "not seen";
      } else {
        actual = `not Pangu: ${answer.logLine ?? answer.rpcError}`;
      }
      if (answer.outcome === "unseen") {
        result = "not seen";
        unseen += 1;
      } else if (actual === expected) {
        result = "ok";
        if (answer.outcome === "allowed") {
          allowedAsExpected += 1;
        } else {
          refusedAsExpected += 1;
        }
      } else {
        result = "DEVIATION";
        off += 1;
      }
      if (built.expected.why !== null) {
        expected = `${expected} *`;
      }
    } catch (error) {
      actual = `not run: ${error instanceof Error ? error.message : String(error)}`;
      how = "-";
      result = "not run";
    }
    rows.push({
      index: attack.index,
      title: attack.title,
      invariant: attack.invariant,
      shares,
      expected,
      actual,
      how,
      result,
    });
  }

  console.log(table(rows));
  console.log("");
  for (const line of sizes) {
    console.log(`sizes    : ${line}`);
  }
  console.log("* the program's answer for this exact transaction differs from the rule the row is named for; the row says why on screen");
  for (const link of sent) {
    console.log(`sent     : ${link}`);
  }
  console.log("");
  console.log(tallyLine({ run, refusedAsExpected, allowedAsExpected, off, unseen }));
  console.log(`off the standard: ${off}`);
}

const only = process.argv[2];
const candidates = sales.filter(
  (sale) => sale.network === "devnet" && (only === undefined || sale.symbol === only)
);
const target = await readTarget(connection, candidates);
if (target === null) {
  throw new Error("no Pangu sale is running on devnet, so there is nothing to attack");
}

const { wallet, supplied } = ledgerWallet();
const funding = await fund(wallet);

console.log(`network  : devnet, ${connection.rpcEndpoint}`);
console.log(`sale     : ${target.name} (${target.symbol}), ${target.openAccess ? "open" : "list"} access`);
console.log(`mint     : ${target.mint.toBase58()}`);
console.log(`cap      : ${target.cap} raw units a wallet, worth ${target.capWorth} raw units of the paying token`);
console.log(`paying   : ${target.quoteMint.toBase58()}${target.payingInSol ? " (wrapped SOL)" : " (a token a visitor cannot get)"}`);
console.log(`curve    : ${target.curveDollars.toFixed(4)} dollars a share`);
if (target.ceilingDollars !== null) {
  console.log(`ceiling  : ${target.ceilingDollars.toFixed(4)} dollars, against a stock at ${(target.stockDollars ?? 0).toFixed(4)}`);
}
console.log(`standing : ${target.standingRefusal ?? "a buy can reach the cap rule"}`);
console.log(`buyers   : ${target.buyers}`);
console.log(`wallet   : ${wallet.publicKey.toBase58()}, funded from the ${funding}`);
console.log(`holding  : ${await funder.getBalance(wallet.publicKey, "confirmed")} lamports`);

await runLedger(
  wallet,
  target,
  supplied
    ? "PASS 1: the wallet the demo dollar button topped up, which is what a judge's wallet looks like after pressing it"
    : "PASS 1: a wallet holding only devnet SOL, which is all a visitor can get for themselves"
);

if (supplied) {
  console.log("");
  console.log(
    "PASS 2 is not run: this wallet was handed the paying token by the route before the ledger started, which is the whole point of the run."
  );
} else if (!target.payingInSol) {
  const handed = await fundPayingToken(wallet, target);
  console.log("");
  console.log(`paying token: ${handed}`);
  await runLedger(
    wallet,
    target,
    "PASS 2: the same wallet after the issuer handed it the paying token"
  );
}

console.log("");
console.log(`run at ${new Date().toISOString()}`);
