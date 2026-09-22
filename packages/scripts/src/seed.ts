/**
 * Gives a devnet sale a history a judge can look at: six approved buyers, six
 * buys under the cap, and two of them selling part of it back.
 *
 *   npm run seed
 *   npm run seed -- --mint <mint>
 *
 * Safe to run twice. The six wallets are derived from the paying key and the
 * mint, so the second run finds them already approved, already holding, and
 * does nothing except print where the sale stands.
 */

import { LAMPORTS_PER_SOL, PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  ACCESS_MODE,
  TOKEN_2022_PROGRAM_ID,
  approveBuyerInstruction,
  getBuyerRecord,
  getSale,
  listBuyerRecords,
  readPrice,
  saleStanding,
} from "pangu-sdk";
import { sellTransaction } from "pangu-sdk/dbc";
import { readFlags } from "./arguments.js";
import { buyWithin } from "./buying.js";
import { send } from "./chain.js";
import { addressLink, devnet, payerKeypair, requireDevnet, sol } from "./environment.js";
import { chooseSale } from "./sales.js";
import { fundWallets, repeatableWallet } from "./wallets.js";

const BUYERS = 6;

/** The two buyers that also sell, so the sale has an exit in its history. */
const SELLERS = 2;

/** Enough for the token accounts, the buy and the fees, with a little spare. */
const FUNDING_LAMPORTS = 12_000_000;

/** What each demo buy aims at, as a share of one wallet's cap. */
const SHARE_OF_CAP = 0.4;

/** What a selling wallet sells back, as a share of what it holds. */
const SELL_SHARE = 4n;

/** Approvals per transaction. Five accounts each, so this stays well inside the size limit. */
const APPROVALS_PER_TRANSACTION = 4;

async function tokenBalance(
  connection: ReturnType<typeof devnet>,
  account: PublicKey
): Promise<bigint> {
  const info = await connection.getAccountInfo(account, "confirmed");
  return info === null ? 0n : info.data.readBigUInt64LE(64);
}

async function main(): Promise<void> {
  const flags = readFlags(process.argv.slice(2), ["mint"]);
  const record = chooseSale(flags.get("mint"));

  const connection = devnet();
  await requireDevnet(connection);
  const issuer: Keypair = payerKeypair();
  const mint = new PublicKey(record.mint);

  const sale = await getSale(connection, mint);
  if (sale === null) {
    throw new Error(`${record.mint} has no Pangu sale on devnet`);
  }
  if (sale.issuer.toBase58() !== issuer.publicKey.toBase58()) {
    throw new Error(
      `this sale's issuer is ${sale.issuer.toBase58()}, and approvals can only come from that wallet`
    );
  }
  if (sale.hasBand) {
    const price = await readPrice(connection, sale);
    if (!price.usable) {
      throw new Error(
        `this sale is banded and its price is not usable right now (${price.error}). No buy would land, so nothing was spent. ${price.reason}`
      );
    }
  }

  const started = await connection.getBalance(issuer.publicKey, "confirmed");
  console.log(`sale    : ${record.name} (${record.symbol}), ${record.mode} access`);
  console.log(`mint    : ${record.mint}`);
  console.log(`          ${addressLink(mint)}`);
  console.log(`cap     : ${sale.cap} raw units per wallet`);

  const buyers = Array.from({ length: BUYERS }, (_unused, index) =>
    repeatableWallet(issuer, mint, "seed buyer", index)
  );
  const funded = await fundWallets(
    connection,
    issuer,
    buyers.map((wallet) => wallet.publicKey),
    FUNDING_LAMPORTS
  );
  console.log(`buyers  : ${BUYERS} demo wallets, ${sol(funded)} SOL sent to them this run`);

  if (sale.accessMode === ACCESS_MODE.issuerList) {
    const waiting: PublicKey[] = [];
    for (const wallet of buyers) {
      const existing = await getBuyerRecord(connection, mint, wallet.publicKey);
      if (existing === null || !existing.approved) {
        waiting.push(wallet.publicKey);
      }
    }
    for (let start = 0; start < waiting.length; start += APPROVALS_PER_TRANSACTION) {
      const batch = waiting.slice(start, start + APPROVALS_PER_TRANSACTION);
      const transaction = new Transaction();
      for (const wallet of batch) {
        transaction.add(approveBuyerInstruction({ issuer: issuer.publicKey, mint, wallet }));
      }
      const landed = await send(connection, "approving demo buyers", transaction, [issuer]);
      console.log(`approve : ${batch.length} wallets, ${landed.link}`);
    }
    if (waiting.length === 0) {
      console.log("approve : all six were already approved, nothing sent");
    }
  } else if (sale.accessMode === ACCESS_MODE.verifierCredential) {
    console.log(
      "approve : this sale reads attestations from a verifier, so there is no list to add anyone to"
    );
  } else {
    console.log("approve : open access, a buyer only needs their own record");
  }

  const wanted = BigInt(
    Math.round(
      record.thresholdSol * LAMPORTS_PER_SOL * (record.capShareBps / 10_000) * SHARE_OF_CAP
    )
  );

  for (const [index, wallet] of buyers.entries()) {
    const before = await getBuyerRecord(connection, mint, wallet.publicKey);
    if (before !== null && before.netBought > 0n) {
      console.log(`buy ${index + 1}   : already holds ${before.netBought} raw units, skipped`);
      continue;
    }
    const buy = await buyWithin(connection, wallet.publicKey, mint, wanted, sale.cap);
    const landed = await send(connection, `demo buy ${index + 1}`, buy.transaction, [wallet]);
    console.log(
      `buy ${index + 1}   : ${buy.expectedAmountOut} raw units for ${sol(wanted)} SOL, ${landed.link}`
    );
  }

  for (const [index, wallet] of buyers.slice(-SELLERS).entries()) {
    const ata = getAssociatedTokenAddressSync(
      mint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const quoteAta = getAssociatedTokenAddressSync(
      new PublicKey(record.quoteMint),
      wallet.publicKey,
      false
    );
    // A wallet that has sold is holding the proceeds in its paying-token
    // account. That is the on-chain sign that this run has nothing left to do,
    // and it is why a second run sells nothing.
    if ((await tokenBalance(connection, quoteAta)) > 0n) {
      console.log(`sell ${index + 1}  : this wallet has already sold, skipped`);
      continue;
    }
    const held = await tokenBalance(connection, ata);
    if (held === 0n) {
      console.log(`sell ${index + 1}  : nothing held, skipped`);
      continue;
    }
    const sell = await sellTransaction({
      connection,
      seller: wallet.publicKey,
      mint,
      amountIn: held / SELL_SHARE,
    });
    const landed = await send(connection, `demo sell ${index + 1}`, sell.transaction, [wallet]);
    console.log(`sell ${index + 1}  : ${held / SELL_SHARE} raw units back to the pool, ${landed.link}`);
  }

  const after = await getSale(connection, mint);
  const standing = saleStanding(after ?? sale, await listBuyerRecords(connection, mint));
  console.log("");
  console.log(`buyers  : ${standing.buyers} wallets holding something`);
  console.log(`sold    : ${standing.totalNetBought} raw units, net of what came back`);
  console.log(
    `largest : ${standing.largestWallet?.toBase58() ?? "nobody"} with ${(standing.largestShare * 100).toFixed(2)} percent of it`
  );
  console.log(`cap     : ${(standing.capShare * 100).toFixed(2)} percent of what has sold`);
  console.log(
    `spent   : ${sol(started - (await connection.getBalance(issuer.publicKey, "confirmed")))} SOL from the issuer`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
