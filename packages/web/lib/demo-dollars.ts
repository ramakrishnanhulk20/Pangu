import path from "node:path";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";

import { breakConnection, payingHeld, readTarget } from "@/lib/break";
import { openedSales } from "@/lib/sales";
import { devnetRpcUrl } from "@/lib/solana";

/**
 * Hands a visitor's devnet wallet the token the live sale is priced in.
 *
 * Server only. Nothing here may be imported by a client component: this file
 * reads the key that mints the demo dollar, and the moment a client component
 * pulls it in, that key is in the browser bundle.
 *
 * The token is a demo dollar minted for devnet by packages/scripts/src/mint-dollars.ts.
 * Devnet has no dollar token a stranger can get in quantity, so without this a
 * judge can only run the rows that spend nothing.
 */

const VARIABLE = "DEMO_DOLLAR_MINT_AUTHORITY";

/** Times the cap's worth a wallet is handed, so the honest buy and the over-cap try are both affordable. */
const GRANT_MULTIPLE = 2n;

/** One wallet may take a grant this often. */
const WALLET_WAIT_MS = 60 * 60 * 1000;

/** And the route as a whole hands out this many inside one minute. */
const MINUTE_MS = 60 * 1000;
const GRANTS_A_MINUTE = 10;

export interface Grant {
  signature: string;
  /** Raw units minted, as a string: JSON has no bigint. */
  amount: string;
  decimals: number;
  mint: string;
}

/** A refusal a visitor can read and act on, with the status it goes back as. */
export class Refused extends Error {
  readonly status: number;

  constructor(status: number, reason: string) {
    super(reason);
    this.name = "Refused";
    this.status = status;
  }
}

let triedRootEnv = false;

/**
 * The key that mints the demo dollar, as a Solana key file holds it: a JSON
 * array of bytes.
 *
 * On a deploy the variable is set in the project's own settings. On a developer
 * machine it lives in the repository root .env, two folders above this app,
 * which Next does not read by itself, so that file is loaded the first time the
 * variable is missing.
 */
function mintAuthority(): Keypair {
  if (process.env[VARIABLE] === undefined && !triedRootEnv) {
    triedRootEnv = true;
    try {
      process.loadEnvFile(path.join(process.cwd(), "..", "..", ".env"));
    } catch {
      // No root .env is what a deploy looks like, where the variable is set in
      // the project's own settings instead.
    }
  }

  const raw = process.env[VARIABLE];
  if (raw === undefined || raw.trim() === "") {
    throw new Refused(503, "Demo dollars are not switched on for this deploy.");
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  } catch {
    throw new Refused(
      503,
      "The demo dollar key in this deploy's settings is not the JSON array a Solana key file holds, so demo dollars are off."
    );
  }
}

const lastGrantByWallet = new Map<string, number>();
let grantsThisMinute: number[] = [];

/**
 * Best effort abuse limits, held in this process's memory.
 *
 * Every grant costs the paying key about 0.002 SOL of rent when the wallet has
 * no account for this token yet, plus the fee, and that key holds ordinary
 * devnet SOL. A deploy running on more than one instance counts per instance,
 * which is the trade for keeping a demo button free of a database.
 */
function checkLimits(wallet: PublicKey): void {
  const now = Date.now();
  grantsThisMinute = grantsThisMinute.filter((at) => now - at < MINUTE_MS);
  if (grantsThisMinute.length >= GRANTS_A_MINUTE) {
    throw new Refused(
      429,
      "This button has handed out its minute's worth of demo dollars. Wait a minute and press it again."
    );
  }
  const last = lastGrantByWallet.get(wallet.toBase58());
  if (last !== undefined && now - last < WALLET_WAIT_MS) {
    const minutes = Math.ceil((WALLET_WAIT_MS - (now - last)) / 60_000);
    throw new Refused(
      429,
      `This wallet took demo dollars already. It may take more in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`
    );
  }
}

function recordGrant(wallet: PublicKey): void {
  const now = Date.now();
  lastGrantByWallet.set(wallet.toBase58(), now);
  grantsThisMinute.push(now);
}

/**
 * Sends the mint and waits for it.
 *
 * Tried again on failure and with a finalized blockhash: the public devnet
 * endpoint is several nodes behind one address, and one of them can answer that
 * a blockhash another just handed out does not exist.
 */
async function send(transaction: Transaction, authority: Keypair): Promise<string> {
  const connection = new Connection(devnetRpcUrl(), "confirmed");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      transaction.feePayer = authority.publicKey;
      transaction.recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
      return await sendAndConfirmTransaction(connection, transaction, [authority], {
        commitment: "confirmed",
        preflightCommitment: "finalized",
      });
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      await new Promise((wake) => setTimeout(wake, 2_000));
    }
  }
  throw new Error("the send loop either returns a signature or throws");
}

/**
 * Mints one grant of the demo dollar to a wallet and returns the signature.
 *
 * The size is read off the chain at request time, never typed in: twice what
 * this sale's cap is worth at the curve's price now, so the buy under the cap
 * and the buy past it are both affordable out of one grant.
 *
 * Throws {@link Refused} carrying the status and the sentence a visitor sees.
 */
export async function grantDemoDollars(wallet: PublicKey): Promise<Grant> {
  checkLimits(wallet);
  const authority = mintAuthority();

  const connection = breakConnection();
  const candidates = openedSales().map((sale) => ({
    mint: sale.mint,
    name: sale.name,
    symbol: sale.symbol,
    mode: sale.mode,
  }));
  const target = await readTarget(connection, candidates);
  if (target === null) {
    throw new Refused(
      503,
      "No sale is running on devnet right now, so there is nothing for demo dollars to buy."
    );
  }
  if (target.payingInSol) {
    throw new Refused(400, "This sale takes devnet SOL, use the faucet link.");
  }

  const state = await getMint(connection, target.quoteMint, "confirmed", target.quoteProgram);
  if (state.mintAuthority === null || !state.mintAuthority.equals(authority.publicKey)) {
    throw new Refused(
      503,
      "This deploy's demo key does not mint the token this sale is priced in, so demo dollars are off for it."
    );
  }

  const amount = target.capWorth * GRANT_MULTIPLE;
  const held = await payingHeld(connection, target, wallet);
  if (held >= amount) {
    throw new Refused(400, "You already hold enough demo dollars for every row.");
  }

  const account = getAssociatedTokenAddressSync(
    target.quoteMint,
    wallet,
    false,
    target.quoteProgram
  );
  const transaction = new Transaction()
    .add(
      createAssociatedTokenAccountIdempotentInstruction(
        authority.publicKey,
        account,
        wallet,
        target.quoteMint,
        target.quoteProgram
      )
    )
    .add(
      createMintToInstruction(
        target.quoteMint,
        account,
        authority.publicKey,
        amount,
        [],
        target.quoteProgram
      )
    );

  recordGrant(wallet);
  const signature = await send(transaction, authority);

  return {
    signature,
    amount: amount.toString(),
    decimals: target.quoteDecimals,
    mint: target.quoteMint.toBase58(),
  };
}
