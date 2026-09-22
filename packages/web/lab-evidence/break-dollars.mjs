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
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Connection, Keypair } from "@solana/web3.js";

const BASE = process.env.DOLLARS_BASE_URL ?? "http://127.0.0.1:3450";
const ROUTE = `${BASE}/api/break/dollars`;
const RPC = process.env.NEXT_PUBLIC_DEVNET_RPC_URL || "https://api.devnet.solana.com";

const connection = new Connection(RPC, "confirmed");
const wallet = Keypair.generate();

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

console.log("");
console.log(`run at ${new Date().toISOString()}`);
