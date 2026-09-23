/**
 * Proves the demo dollar button against devnet, end to end.
 *
 *   node lab-evidence/break-dollars.mjs
 *
 * It needs a verification server of this app answering on port 3450 with
 * DEMO_DOLLAR_MINT_AUTHORITY set, never the dev server on 3000.
 *
 * A throwaway wallet asks POST /api/break/dollars for demo dollars, the grant is
 * read back off the chain, the same wallet asks a second time and is refused,
 * and then the whole attack ledger is run from that wallet so the rows that
 * spend the paying token reach the program's own decision. The key is made in
 * memory, handed to the ledger run through the environment, and never written
 * anywhere. Only its public key is printed.
 *
 * Last, the limits are raced: twelve fresh wallets ask at the same moment, and
 * no more than ten may be handed anything inside one minute. That costs the
 * paying key about 0.002 SOL of rent a grant, so it is skipped when the key
 * holds under 0.3 SOL.
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

const BASE = process.env.DOLLARS_BASE_URL ?? "http://127.0.0.1:3450";
const ROUTE = `${BASE}/api/break/dollars`;
const RPC = process.env.NEXT_PUBLIC_DEVNET_RPC_URL || "https://api.devnet.solana.com";

const connection = new Connection(RPC, "confirmed");
const wallet = Keypair.generate();

const RACERS = 12;
const LIMIT_A_MINUTE = 10;
const RACE_FLOOR_SOL = 0.3;

async function ask(label) {
  const response = await fetch(ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: wallet.publicKey.toBase58() }),
  });
  const body = await response.json();
  console.log("");
  console.log(`${label}: HTTP ${response.status}`);
  console.log(JSON.stringify(body, null, 2));
  return { status: response.status, body };
}

/** What the wallet holds of one mint, read off the chain whichever token program owns it. */
async function heldOf(mint) {
  const { PublicKey } = await import("@solana/web3.js");
  const accounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
    mint: new PublicKey(mint),
  });
  const first = accounts.value[0];
  return first === undefined
    ? "no account for this token"
    : `${first.account.data.parsed.info.tokenAmount.uiAmountString} in ${first.pubkey.toBase58()}`;
}

/** Runs the attack ledger from this same wallet and keeps its table in both files. */
function runLedger() {
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, "break-simulations.mjs")],
      {
        env: {
          ...process.env,
          PANGU_LEDGER_WALLET: JSON.stringify(Array.from(wallet.secretKey)),
        },
        stdio: ["ignore", "pipe", "inherit"],
      }
    );
    let text = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      text += chunk;
      process.stdout.write(chunk);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      // The ledger's own runs live in break-simulations.txt, so this one is
      // appended there as well as shown here.
      appendFileSync(
        join(import.meta.dirname, "break-simulations.txt"),
        `\n\nRUN FROM lab-evidence/break-dollars.mjs, the wallet topped up by the demo dollar route\n${text}`
      );
      if (code === 0) {
        done();
      } else {
        fail(new Error(`the ledger run exited with code ${code}`));
      }
    });
  });
}

console.log(`route    : ${ROUTE}`);
console.log(`network  : devnet, ${RPC}`);
console.log(`wallet   : ${wallet.publicKey.toBase58()}, made in memory for this run`);

const first = await ask("first call, a wallet holding nothing");
if (first.status === 200) {
  console.log("");
  console.log(`mint     : ${first.body.mint}`);
  console.log(`granted  : ${first.body.amount} raw units, ${first.body.decimals} decimals`);
  console.log(`signature: ${first.body.signature}`);
  console.log(
    `explorer : https://explorer.solana.com/tx/${first.body.signature}?cluster=devnet`
  );
  console.log(`held now : ${await heldOf(first.body.mint)}`);
}

await ask("second call, the same wallet straight after");

await runLedger();

/**
 * The public key of the key that pays for every grant, read from the root .env
 * the same way the route reads it. Only the public half is ever printed.
 */
function payingKey() {
  try {
    process.loadEnvFile(join(import.meta.dirname, "..", "..", "..", ".env"));
  } catch {
    // Already set in the environment, or not set at all, which is reported below.
  }
  const raw = process.env.DEMO_DOLLAR_MINT_AUTHORITY;
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))).publicKey;
}

async function race() {
  console.log("");
  console.log(`RACE: ${RACERS} fresh wallets ask at the same moment, at most ${LIMIT_A_MINUTE} may be handed demo dollars`);
  const payer = payingKey();
  if (payer === null) {
    console.log("not run: DEMO_DOLLAR_MINT_AUTHORITY is not set here, so the paying key cannot be checked");
    return;
  }
  const before = await connection.getBalance(payer, "confirmed");
  console.log(`payer    : ${payer.toBase58()}, ${before / LAMPORTS_PER_SOL} SOL`);
  if (before < RACE_FLOOR_SOL * LAMPORTS_PER_SOL) {
    console.log(`not run: the paying key holds under ${RACE_FLOOR_SOL} SOL`);
    return;
  }

  const racers = Array.from({ length: RACERS }, () => Keypair.generate());
  const started = Date.now();
  const answers = await Promise.all(
    racers.map(async (racer) => {
      const response = await fetch(ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: racer.publicKey.toBase58() }),
      });
      const body = await response.json();
      return { status: response.status, body };
    })
  );
  const counts = new Map();
  answers.forEach((answer, place) => {
    counts.set(answer.status, (counts.get(answer.status) ?? 0) + 1);
    const said = answer.status === 200 ? `minted, ${answer.body.signature}` : answer.body.reason;
    console.log(`racer ${String(place + 1).padStart(2, "0")} : HTTP ${answer.status}, ${said}`);
  });
  const minted = counts.get(200) ?? 0;
  const limited = counts.get(429) ?? 0;
  const other = answers.length - minted - limited;
  console.log("");
  console.log(`minted   : ${minted}`);
  console.log(`refused  : ${limited} with HTTP 429`);
  console.log(`other    : ${other}`);
  console.log(`took     : ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(
    minted <= LIMIT_A_MINUTE && minted + limited === answers.length
      ? `limit held: ${minted} minted, at most ${LIMIT_A_MINUTE} allowed, the rest 429`
      : "LIMIT BROKEN or a request failed for another reason"
  );
  const after = await connection.getBalance(payer, "confirmed");
  console.log(`payer    : ${after / LAMPORTS_PER_SOL} SOL after, ${(before - after) / LAMPORTS_PER_SOL} SOL spent`);
}

await race();

console.log("");
console.log(`run at ${new Date().toISOString()}`);
