import "./buffer-shim";

import { PublicKey, Transaction, type Connection, type Keypair } from "@solana/web3.js";
import {
  approveBuyerInstruction,
  listBuyerRecords,
  revokeBuyerInstruction,
} from "pangu-sdk";
import {
  claimFeesTransaction,
  graduateTransaction,
  loadPool,
} from "pangu-sdk/dbc";

/*
 * What only a sale's issuer does on the sale page: the approved list, the
 * trading fees, and the move to DAMM v2 once the curve is full. Browser-safe:
 * every transaction here is built by pangu-sdk and signed by the issuer's own
 * wallet, never by a key this app holds.
 */

/** A transaction to simulate and sign, and any key that signs it besides the wallet. */
export interface Signable {
  transaction: Transaction;
  signers: Keypair[];
}

/** What the issuer panel shows, read off devnet. */
export interface IssuerView {
  /** Wallets whose buyer record says approved, oldest record first as the node lists them. */
  approved: string[];
  /** Raw units of the paying token the pool holds for the pool's creator. */
  creatorFees: bigint;
  /** And for the launch template's fee claimer, the partner. */
  partnerFees: bigint;
  creator: string;
  feeClaimer: string;
  /** True once the curve has taken in its whole threshold. */
  curveComplete: boolean;
  /** True once somebody has sent the move to DAMM v2. */
  migrated: boolean;
}

export async function readIssuerView(connection: Connection, mint: PublicKey): Promise<IssuerView> {
  const [view, records] = await Promise.all([
    loadPool(connection, mint),
    listBuyerRecords(connection, mint),
  ]);
  const state = view.poolAccount.poolState;
  return {
    approved: records.filter((record) => record.approved).map((record) => record.wallet.toBase58()),
    creatorFees: BigInt(state.creatorQuoteFee.toString()),
    partnerFees: BigInt(state.partnerQuoteFee.toString()),
    creator: state.creator.toBase58(),
    feeClaimer: view.configState.feeClaimer.toBase58(),
    curveComplete: state.quoteReserve.gte(view.configState.migrationQuoteThreshold),
    migrated: state.isMigrated !== 0,
  };
}

/** Addresses pasted into the approve box, sorted into the ones to send and the ones not to. */
export interface PastedWallets {
  wallets: PublicKey[];
  /** One line per address left out, saying why. */
  problems: string[];
}

/**
 * Reads a pasted list: one address or many, split on spaces, commas or new
 * lines. Each must be a Solana address and a real wallet key: an address off the
 * curve belongs to a program and can never sign a buy. Repeats and wallets
 * already on the list are left out and said so.
 */
export function parseWallets(text: string, alreadyApproved: readonly string[]): PastedWallets {
  const seen = new Set<string>();
  const wallets: PublicKey[] = [];
  const problems: string[] = [];
  for (const part of text.split(/[\s,;]+/).filter((piece) => piece !== "")) {
    let key: PublicKey;
    try {
      key = new PublicKey(part);
    } catch {
      problems.push(`${part.slice(0, 48)} is not a Solana address.`);
      continue;
    }
    const text58 = key.toBase58();
    if (!PublicKey.isOnCurve(key.toBytes())) {
      problems.push(`${text58} belongs to a program, not a wallet, so it could never buy.`);
    } else if (seen.has(text58)) {
      problems.push(`${text58} is in the list twice. It is sent once.`);
    } else if (alreadyApproved.includes(text58)) {
      problems.push(`${text58} is already approved.`);
    } else {
      seen.add(text58);
      wallets.push(key);
    }
  }
  return { wallets, problems };
}

/**
 * Approvals per transaction. Each one names a new buyer record, and six stay
 * well inside Solana's 1,232 bytes with room for the wallet's signature.
 */
const APPROVALS_PER_TRANSACTION = 6;

async function ready(connection: Connection, transaction: Transaction, payer: PublicKey): Promise<Transaction> {
  transaction.feePayer = payer;
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return transaction;
}

/**
 * The approvals, a few to a transaction. Each creates the wallet's record if it
 * has none, which the issuer pays a small deposit for, and never resets what the
 * wallet already bought.
 */
export async function approveTransactions(
  connection: Connection,
  issuer: PublicKey,
  mint: PublicKey,
  wallets: readonly PublicKey[]
): Promise<Signable[]> {
  const batches: Signable[] = [];
  for (let start = 0; start < wallets.length; start += APPROVALS_PER_TRANSACTION) {
    const transaction = new Transaction();
    for (const wallet of wallets.slice(start, start + APPROVALS_PER_TRANSACTION)) {
      transaction.add(approveBuyerInstruction({ issuer, mint, wallet }));
    }
    batches.push({ transaction: await ready(connection, transaction, issuer), signers: [] });
  }
  return batches;
}

/** Takes one wallet off the list. It can still sell what it holds. */
export async function revokeTransaction(
  connection: Connection,
  issuer: PublicKey,
  mint: PublicKey,
  wallet: PublicKey
): Promise<Signable> {
  const transaction = new Transaction().add(revokeBuyerInstruction({ issuer, mint, wallet }));
  return { transaction: await ready(connection, transaction, issuer), signers: [] };
}

/**
 * Claims the trading fees the pool holds for one side. The receiver is read off
 * the chain by pangu-sdk, never typed in here, so the fees can only go to the
 * wallet the pool names.
 */
export async function claimTransaction(
  connection: Connection,
  mint: PublicKey,
  who: "creator" | "partner"
): Promise<Signable> {
  const built = await claimFeesTransaction({ connection, who, mint });
  return { transaction: built.transaction, signers: [] };
}

/**
 * Moves a full curve into DAMM v2. Anyone may pay for it; the two position
 * accounts it creates sign alongside the wallet.
 */
export async function graduateSignable(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey
): Promise<Signable & { dammPool: string }> {
  const built = await graduateTransaction({ connection, payer, mint });
  return { transaction: built.transaction, signers: built.signers, dammPool: built.dammPool.toBase58() };
}
