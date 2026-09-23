/**
 * The throwaway wallets a devnet demo needs.
 *
 * Two kinds. `seed` needs the same six wallets every time it runs, so those are
 * derived from the paying key and the mint and never stored: running the script
 * twice finds the same wallets already approved instead of approving six more.
 * `prove` needs wallets that have never touched the sale, so those are made
 * fresh each run. No secret key is ever written to disk or printed.
 */

import { createHash } from "node:crypto";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { send } from "./chain.js";

/** How many wallets one funding transaction carries. Keeps it well inside the size limit. */
const TRANSFERS_PER_TRANSACTION = 10;

export function freshWallet(): Keypair {
  return Keypair.generate();
}

/**
 * The same throwaway wallet every run, for one sale and one job.
 *
 * The seed is a hash of the paying key, the mint, the job and the number, so
 * two sales never share a demo buyer and nobody outside this machine can work
 * out the key. It is derived in memory each run rather than saved anywhere.
 */
export function repeatableWallet(
  payer: Keypair,
  mint: PublicKey,
  purpose: string,
  index: number
): Keypair {
  const seed = createHash("sha256")
    .update(payer.secretKey)
    .update(mint.toBuffer())
    .update(purpose)
    .update(String(index))
    .digest();
  return Keypair.fromSeed(Uint8Array.from(seed));
}

/**
 * Tops each wallet up to `lamports`, in as few transactions as possible.
 *
 * A wallet that already holds enough is skipped, which is what makes a second
 * run of `seed` cost nothing. Returns what was actually spent.
 */
export async function fundWallets(
  connection: Connection,
  payer: Keypair,
  wallets: PublicKey[],
  lamports: number
): Promise<number> {
  const needed: { wallet: PublicKey; lamports: number }[] = [];
  for (const wallet of wallets) {
    const balance = await connection.getBalance(wallet, "confirmed");
    if (balance < lamports) {
      needed.push({ wallet, lamports: lamports - balance });
    }
  }
  if (needed.length === 0) {
    return 0;
  }

  let spent = 0;
  for (let start = 0; start < needed.length; start += TRANSFERS_PER_TRANSACTION) {
    const batch = needed.slice(start, start + TRANSFERS_PER_TRANSACTION);
    const transaction = new Transaction();
    for (const entry of batch) {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: entry.wallet,
          lamports: entry.lamports,
        })
      );
    }
    const landed = await send(
      connection,
      `funding ${batch.length} demo wallets`,
      transaction,
      [payer]
    );
    spent += landed.fee + batch.reduce((total, entry) => total + entry.lamports, 0);
  }
  return spent;
}

/** What one throwaway buyer is handed before its buy. */
export interface BuyerFunding {
  /** Devnet SOL the wallet is topped up to. */
  lamports: number;
  /** Raw units of the paying token, when that token is not SOL. */
  quoteTokens: bigint;
}

/**
 * What a throwaway buyer needs to make a buy of `amountIn` raw units of the
 * paying token: `overhead` lamports for the accounts and the fees, plus the buy
 * itself in whichever token it is priced in.
 *
 * The mistake this replaces funded a dollar sale's buyer with its dollar amount
 * as lamports: the buy failed for want of the paying token and the SOL went
 * with the discarded key.
 */
export function buyerFunding(
  payingInSol: boolean,
  amountIn: bigint,
  overhead: number
): BuyerFunding {
  return payingInSol
    ? { lamports: Number(amountIn) + overhead, quoteTokens: 0n }
    : { lamports: overhead, quoteTokens: amountIn };
}

/**
 * Runs `work` with as many fresh wallets as it asks for, then sweeps every one
 * of them back to the payer, whether `work` finished or threw.
 *
 * A wallet made here is never written down, so whatever it still holds once
 * the process ends is lost. The sweep is in a finally block for that reason:
 * a rate limited node or a refused buy halfway through a run is exactly when
 * the most SOL is sitting in wallets nobody else can sign for.
 *
 * Returns what `work` returned and the lamports that came back. When `work`
 * throws, its error is the one passed on, after the sweep.
 */
export async function withThrowawayWallets<T>(
  connection: Connection,
  payer: Keypair,
  work: (fresh: () => Keypair) => Promise<T>
): Promise<{ result: T; returned: number }> {
  const made: Keypair[] = [];
  const fresh = (): Keypair => {
    const wallet = freshWallet();
    made.push(wallet);
    return wallet;
  };
  let returned = 0;
  let result: T;
  try {
    result = await work(fresh);
  } finally {
    for (const wallet of made) {
      try {
        returned += await returnLeftovers(connection, payer, wallet);
      } catch (error) {
        // A sweep that throws here would hide the error that ended the run.
        console.error(
          `could not sweep ${wallet.publicKey.toBase58()}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  return { result, returned };
}

/** One wallet and how much of the paying token it is being handed. */
export interface QuoteFunding {
  wallet: PublicKey;
  /** Raw units of the paying token. */
  amount: bigint;
}

/**
 * Hands throwaway wallets the paying token, when that token is not SOL.
 *
 * A sale priced in a dollar token cannot be attacked with devnet SOL: the swap
 * takes the paying token out of the buyer's own account, so a wallet holding
 * none is refused by the token program before Pangu's rules are ever reached,
 * and the refusal would say nothing about the sale. The account is opened here
 * and the tokens are sent in one transaction, from the payer's own holding.
 *
 * Unlike the devnet SOL, these are not swept back: they are a demo token the
 * payer can mint more of.
 */
export async function fundQuoteTokens(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  tokenProgram: PublicKey,
  decimals: number,
  funding: readonly QuoteFunding[]
): Promise<void> {
  const from = getAssociatedTokenAddressSync(mint, payer.publicKey, false, tokenProgram);
  const transaction = new Transaction();
  for (const entry of funding) {
    const to = getAssociatedTokenAddressSync(mint, entry.wallet, false, tokenProgram);
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        to,
        entry.wallet,
        mint,
        tokenProgram
      ),
      createTransferCheckedInstruction(
        from,
        mint,
        to,
        payer.publicKey,
        entry.amount,
        decimals,
        [],
        tokenProgram
      )
    );
  }
  await send(connection, `handing ${funding.length} wallets the paying token`, transaction, [
    payer,
  ]);
}

/**
 * Sweeps what is left in a throwaway wallet back to the payer.
 *
 * This is tidying up, so it never throws: a balance that moved between the read
 * and the send, or a wallet that is already empty, costs a few thousand lamports
 * of devnet SOL and nothing else. The margin is more than one fee because the
 * balance is read from a node that may be a transaction behind.
 */
export async function returnLeftovers(
  connection: Connection,
  payer: Keypair,
  wallet: Keypair
): Promise<number> {
  // The whole balance minus the fee, which empties the account. Anything less
  // would leave it holding too little to be rent exempt, and the runtime
  // refuses that.
  const fee = 5_000;
  for (const attempt of [1, 2]) {
    const balance = await connection.getBalance(wallet.publicKey, "confirmed");
    if (balance <= fee) {
      return 0;
    }
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: payer.publicKey,
        lamports: balance - fee,
      })
    );
    transaction.feePayer = wallet.publicKey;
    try {
      await send(connection, "returning what a demo wallet did not spend", transaction, [
        wallet,
      ]);
      return balance - fee;
    } catch (error) {
      if (attempt === 2) {
        console.error(
          `could not sweep ${wallet.publicKey.toBase58()}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  return 0;
}
