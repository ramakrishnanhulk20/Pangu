import path from "node:path";

import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";

import {
  breakConnection,
  crossingCost,
  payingHeld,
  readTarget,
  type Target,
} from "@/lib/break";
import { openedSales } from "@/lib/sales";
import { devnetConnection } from "@/lib/solana";

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

/**
 * Times the cap's worth a wallet is handed. With the cost of the buy above the
 * ceiling added on top, a fresh wallet can run 01, then 02 or 04, then 03 and 08
 * in that order out of one grant: only 01 spends, and each refused buy still
 * has to hold what it would have paid, or the token program stops it first.
 */
const GRANT_MULTIPLE = 4n;

/** One wallet may take a grant this often. */
const WALLET_WAIT_MS = 60 * 60 * 1000;

/**
 * A pending slot older than this was never kept or handed back: the function
 * holding it was killed mid-mint. It is dropped, so a warm instance never locks
 * the wallet out for good.
 */
const PENDING_EXPIRY_MS = 5 * 60 * 1000;

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

/** One wallet's slot: pending while its mint is in flight, kept once the mint confirmed. */
interface WalletSlot {
  at: number;
  pending: boolean;
}

const walletSlots = new Map<string, WalletSlot>();
let minuteSlots: { at: number }[] = [];

/** The two slots one request holds, so they can be kept or handed back together. */
interface Reservation {
  wallet: string;
  walletSlot: WalletSlot;
  minuteSlot: { at: number };
}

/**
 * Best effort abuse limits, held in this process's memory.
 *
 * Every grant costs the paying key about 0.002 SOL of rent when the wallet has
 * no account for this token yet, plus the fee, and that key holds ordinary
 * devnet SOL. A deploy running on more than one instance counts per instance,
 * which is the trade for keeping a demo button free of a database.
 *
 * Both slots are taken here, synchronously, before the request's first await.
 * Node runs one request's synchronous code to the end before another starts,
 * so two hundred requests arriving together are counted one at a time and only
 * the first ten get a slot. Checking here and recording after the mint would let
 * every one of them pass the check while the others were still waiting on the
 * chain.
 */
function reserve(wallet: PublicKey): Reservation {
  const now = Date.now();
  minuteSlots = minuteSlots.filter((slot) => now - slot.at < MINUTE_MS);
  if (minuteSlots.length >= GRANTS_A_MINUTE) {
    throw new Refused(
      429,
      "This button has handed out its minute's worth of demo dollars. Wait a minute and press it again."
    );
  }
  const key = wallet.toBase58();
  let held = walletSlots.get(key);
  if (held !== undefined && held.pending && now - held.at >= PENDING_EXPIRY_MS) {
    walletSlots.delete(key);
    held = undefined;
  }
  if (held !== undefined && held.pending) {
    throw new Refused(
      429,
      "Demo dollars for this wallet are on their way now. Wait for them to land before pressing again."
    );
  }
  if (held !== undefined && now - held.at < WALLET_WAIT_MS) {
    const minutes = Math.ceil((WALLET_WAIT_MS - (now - held.at)) / 60_000);
    throw new Refused(
      429,
      `This wallet took demo dollars already. It may take more in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`
    );
  }

  const walletSlot: WalletSlot = { at: now, pending: true };
  const minuteSlot = { at: now };
  walletSlots.set(key, walletSlot);
  minuteSlots.push(minuteSlot);
  return { wallet: key, walletSlot, minuteSlot };
}

/** The mint confirmed: the wallet waits its hour from now. */
function keep(reservation: Reservation): void {
  reservation.walletSlot.pending = false;
  reservation.walletSlot.at = Date.now();
  // A mint that outlived its expiry still landed, so it still starts the
  // wallet's hour, unless a newer request holds the slot by now.
  if (!walletSlots.has(reservation.wallet)) {
    walletSlots.set(reservation.wallet, reservation.walletSlot);
  }
}

/** Nothing was minted: both slots go back, and the wallet may press again at once. */
function release(reservation: Reservation): void {
  if (walletSlots.get(reservation.wallet) === reservation.walletSlot) {
    walletSlots.delete(reservation.wallet);
  }
  minuteSlots = minuteSlots.filter((slot) => slot !== reservation.minuteSlot);
}

const SEND_TRIES = 3;
const SETTLE_WAIT_MS = 2_000;
/** Enough polls to outlast a blockhash, about 150 blocks, twice over. */
const SETTLE_POLLS = 90;

/** A mint that was handed to the node, and the last block its blockhash is good for. */
interface Sent {
  signature: string;
  lastValidBlockHeight: number;
}

/**
 * Whether a mint that was sent has landed, waiting until that is certain.
 *
 * A transaction the node has not confirmed can still land until its blockhash
 * runs out. Re-signing before then could put a second mint on chain beside the
 * first, so the answer is only "no" once the chain is past the last block the
 * old blockhash was good for, or the mint is on chain and failed.
 */
async function landed(connection: Connection, sent: Sent): Promise<boolean> {
  for (let poll = 0; poll < SETTLE_POLLS; poll += 1) {
    const status = (
      await connection.getSignatureStatuses([sent.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status !== null && status !== undefined) {
      if (status.err !== null) {
        return false;
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return true;
      }
    } else if ((await connection.getBlockHeight("confirmed")) > sent.lastValidBlockHeight) {
      return false;
    }
    await new Promise((wake) => setTimeout(wake, SETTLE_WAIT_MS));
  }
  throw new Error(`could not tell whether mint ${sent.signature} landed`);
}

/**
 * Sends the mint and waits for it.
 *
 * Tried again on failure and with a finalized blockhash: the public devnet
 * endpoint is several nodes behind one address, and one of them can answer that
 * a blockhash another just handed out does not exist. Before a retry signs the
 * mint again, the last attempt is checked on chain, and if it landed after all
 * its signature is returned instead, so one grant is never minted twice.
 */
async function send(transaction: Transaction, authority: Keypair): Promise<string> {
  const connection = devnetConnection();
  let previous: Sent | null = null;
  for (let attempt = 0; attempt < SEND_TRIES; attempt += 1) {
    if (previous !== null && (await landed(connection, previous))) {
      return previous.signature;
    }
    try {
      const fresh = await connection.getLatestBlockhash("finalized");
      transaction.feePayer = authority.publicKey;
      transaction.recentBlockhash = fresh.blockhash;
      transaction.sign(authority);
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        preflightCommitment: "finalized",
      });
      previous = { signature, lastValidBlockHeight: fresh.lastValidBlockHeight };
      const confirmation = await connection.confirmTransaction(
        { signature, ...fresh },
        "confirmed"
      );
      if (confirmation.value.err === null) {
        return signature;
      }
      // Landed and failed on chain: nothing was minted, and a fresh try is safe.
      previous = null;
    } catch (error) {
      if (attempt === SEND_TRIES - 1) {
        if (previous !== null && (await landed(connection, previous))) {
          return previous.signature;
        }
        throw error;
      }
      await new Promise((wake) => setTimeout(wake, SETTLE_WAIT_MS));
    }
  }
  if (previous !== null && (await landed(connection, previous))) {
    return previous.signature;
  }
  throw new Error("devnet did not confirm the mint");
}

/**
 * Mints one grant of the demo dollar to a wallet and returns the signature.
 *
 * The size is read off the chain at request time, never typed in: four times
 * what this sale's cap is worth at the curve's price now, plus what the buy
 * above the ceiling pays, sized by the same functions the ledger row uses.
 *
 * The wallet's slot and a slot in the minute are taken before anything else
 * and handed back if nothing is minted, so a failed grant can be pressed again
 * at once and only a confirmed mint starts the wallet's hour.
 *
 * Throws {@link Refused} carrying the status and the sentence a visitor sees.
 */
export async function grantDemoDollars(wallet: PublicKey): Promise<Grant> {
  const reservation = reserve(wallet);
  try {
    const grant = await mintGrant(wallet);
    keep(reservation);
    return grant;
  } catch (error) {
    release(reservation);
    throw error;
  }
}

/** The sale a grant is for and the size of one grant, read once and shared. */
interface GrantSize {
  target: Target;
  amount: bigint;
}

// Sizing a grant reads the sale and measures the room under the ceiling, about
// seventy reads of the public devnet node. Ten visitors pressing together would
// be seven hundred, and the node answers that with 429 for everyone. So one
// sizing is shared for thirty seconds, including while it is still in flight,
// the way the hero's pulse reading is. A failed sizing is not kept.
const SIZE_FRESH_MS = 30_000;
let sizing: { at: number; size: Promise<GrantSize> } | null = null;

function grantSize(authority: Keypair, wallet: PublicKey): Promise<GrantSize> {
  const now = Date.now();
  if (sizing !== null && now - sizing.at < SIZE_FRESH_MS) {
    return sizing.size;
  }
  const entry = { at: now, size: measureGrant(authority, wallet) };
  sizing = entry;
  entry.size.catch(() => {
    if (sizing === entry) {
      sizing = null;
    }
  });
  return entry.size;
}

/**
 * Reads the sale and works out one grant.
 *
 * The wallet is only the one the buy above the ceiling is built for while it is
 * measured. What that buy pays turns on the curve, not on who pays, so the size
 * is the same for every wallet it is shared with.
 */
async function measureGrant(authority: Keypair, wallet: PublicKey): Promise<GrantSize> {
  const connection = breakConnection(devnetConnection().rpcEndpoint);
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

  const amount =
    target.capWorth * GRANT_MULTIPLE + (await crossingCost(connection, target, wallet));
  return { target, amount };
}

async function mintGrant(wallet: PublicKey): Promise<Grant> {
  const authority = mintAuthority();
  const { target, amount } = await grantSize(authority, wallet);
  const connection = breakConnection(devnetConnection().rpcEndpoint);
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

  const signature = await send(transaction, authority);

  return {
    signature,
    amount: amount.toString(),
    decimals: target.quoteDecimals,
    mint: target.quoteMint.toBase58(),
  };
}
