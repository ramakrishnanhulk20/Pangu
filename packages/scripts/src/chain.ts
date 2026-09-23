/**
 * Sending transactions to devnet and reading back what the chain said.
 *
 * Two ways in. `send` is for something that must work and throws with the
 * program's own logs when it does not. `attempt` is for something that must be
 * refused: it skips the node's dry run on purpose, so the refusal lands on
 * chain with a signature a judge can open in the explorer instead of
 * disappearing into an error message.
 */

import {
  Connection,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  VersionedTransaction,
  type PublicKey,
  type Signer,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { panguErrorFromLogs, type PanguError } from "pangu-sdk";
import { transactionLink } from "./environment.js";

/** One transaction that reached the chain, whether it worked or not. */
export interface Landed {
  signature: string;
  succeeded: boolean;
  logs: string[];
  /** Lamports the payer spent on it. A refused transaction still costs its fee. */
  fee: number;
  computeUnits: number;
  link: string;
}

/** A confirmed transaction can take another moment to be readable. Try again. */
const DETAIL_TRIES = 5;
const DETAIL_WAIT_MS = 1_000;

async function detailOf(
  connection: Connection,
  signature: string,
  succeeded: boolean
): Promise<Landed> {
  let detail = null;
  for (let attempt = 0; attempt < DETAIL_TRIES && detail === null; attempt += 1) {
    if (attempt > 0) {
      await new Promise((wake) => setTimeout(wake, DETAIL_WAIT_MS));
    }
    detail = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  }
  return {
    signature,
    succeeded,
    logs: detail?.meta?.logMessages ?? [],
    fee: detail?.meta?.fee ?? 0,
    computeUnits: detail?.meta?.computeUnitsConsumed ?? 0,
    link: transactionLink(signature),
  };
}

async function land(
  connection: Connection,
  transaction: Transaction | VersionedTransaction,
  signers: Signer[],
  skipPreflight: boolean
): Promise<Landed> {
  const latest = await connection.getLatestBlockhash("confirmed");
  let raw: Uint8Array;
  if (transaction instanceof VersionedTransaction) {
    transaction.message.recentBlockhash = latest.blockhash;
    transaction.sign(signers);
    raw = transaction.serialize();
  } else {
    transaction.recentBlockhash = latest.blockhash;
    transaction.feePayer = transaction.feePayer ?? signers[0]?.publicKey;
    transaction.sign(...signers);
    raw = transaction.serialize();
  }

  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
  let succeeded: boolean;
  try {
    const result = await connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );
    succeeded = result.value.err === null;
  } catch (thrown) {
    // web3.js has two ways of telling you a transaction failed. Over the
    // websocket it returns the error; when it falls back to polling, which the
    // public devnet node makes it do, it rejects with the raw error value
    // instead. A landed failure is exactly what an attack wants, so only a real
    // Error, such as the blockhash expiring, is passed on.
    if (thrown instanceof Error) {
      throw thrown;
    }
    succeeded = false;
  }
  return detailOf(connection, signature, succeeded);
}

/**
 * Sends something that must work.
 *
 * Throws with the action named and the program's own log lines when the chain
 * refuses it, because at that point the run has no honest way to continue.
 */
export async function send(
  connection: Connection,
  action: string,
  transaction: Transaction | VersionedTransaction,
  signers: Signer[],
  options: { skipPreflight?: boolean } = {}
): Promise<Landed> {
  const landed = await land(
    connection,
    transaction,
    signers,
    options.skipPreflight ?? false
  );
  if (!landed.succeeded) {
    throw new Error(
      `${action} failed on devnet.\n${landed.link}\n${landed.logs.join("\n")}`
    );
  }
  return landed;
}

/**
 * Sends something that is expected to be refused, and leaves the refusal on
 * chain.
 *
 * The node's dry run is skipped so the transaction really lands: a judge gets a
 * signature and an explorer link rather than a promise that it was tried. The
 * fee is the only cost, a few thousand lamports.
 */
export async function attempt(
  connection: Connection,
  transaction: Transaction,
  signers: Signer[]
): Promise<Landed> {
  return land(connection, transaction, signers, true);
}

/**
 * Pangu's own refusal in a landed transaction's logs, or null when the failure
 * came from somewhere else.
 *
 * Every attack in `prove` is judged through this rather than through "it
 * failed", so a transaction that died for a wrong account or an empty wallet
 * can never be reported as a rule doing its job.
 */
export function refusal(landed: Landed): PanguError | null {
  return landed.succeeded ? null : panguErrorFromLogs(landed.logs);
}

/** The last log line, for a failure that was not Pangu's. */
export function lastLogLine(landed: Landed): string {
  const lines = landed.logs.filter((line) => line.trim().length > 0);
  return lines[lines.length - 1] ?? "no logs";
}

/**
 * The paying token's decimals, read off its own mint account.
 *
 * Never off the sale's rules: the program stores the quote decimals only on a
 * sale with a price band and holds zero for every other sale. Read from there,
 * the even seeded buy on a SOL sale came to nothing and a dollar buy sized in
 * tokens came out a million times too small.
 *
 * Throws when there is no account at that address, or when the account is not
 * a mint of either token program.
 */
export async function payingDecimals(
  connection: Pick<Connection, "getAccountInfo">,
  quoteMint: PublicKey
): Promise<number> {
  const info = await connection.getAccountInfo(quoteMint, "confirmed");
  if (info === null) {
    throw new Error(`the paying token ${quoteMint.toBase58()} has no mint account on devnet`);
  }
  if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(
      `the paying token ${quoteMint.toBase58()} is owned by ${info.owner.toBase58()}, which is not a token program`
    );
  }
  return unpackMint(quoteMint, info, info.owner).decimals;
}

/** Where the clock sysvar keeps its unix time: after slot, epoch start, epoch and leader epoch. */
const CLOCK_UNIX_TIME_OFFSET = 32;

/**
 * The chain's own unix time, read off the clock sysvar.
 *
 * Anything the program compares against the clock, such as a sale's offering
 * end, is worked out from this rather than from this machine, whose clock can
 * sit minutes away from the chain's. Throws when the node returns no clock.
 */
export async function chainTime(connection: Pick<Connection, "getAccountInfo">): Promise<number> {
  const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  if (info === null || info.data.length < CLOCK_UNIX_TIME_OFFSET + 8) {
    throw new Error("the node returned no clock, so the chain's time is unknown");
  }
  return Number(Buffer.from(info.data).readBigInt64LE(CLOCK_UNIX_TIME_OFFSET));
}
