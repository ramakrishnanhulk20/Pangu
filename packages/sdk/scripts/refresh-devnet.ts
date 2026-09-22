// Proves `refreshPriceTransaction` against Pyth's live AAPL feed on devnet, and
// reads the result back with the core entry point's `readPrice`.
//
//   npx tsx scripts/refresh-devnet.ts
//
// Two things come from the environment and neither is ever printed:
// PYTH_API_KEY, because every Hermes read has needed a key since 26 August
// 2026, and DEVNET_PAYER_KEYPAIR, the path to the wallet that pays. Both live
// in the repository's .env, which is read here and never committed. Nothing
// touches mainnet.
//
// Run it twice: the account's address must not change and the publish time must.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  decodePriceUpdate,
  priceFeedAddress,
  stockPriceDollars,
  confidenceBps,
  DOLLAR_SCALE,
  PANGU_SHARD_ID,
  PYTH_RECEIVER_PROGRAM_ID,
} from "../src/index.js";
import { refreshPriceTransaction } from "../src/price.js";

/** Pyth's own Equity.US.AAPL/USD feed id, from packages/program/feeds. */
const AAPL_FEED_ID =
  "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  try {
    process.loadEnvFile(join(here, "..", "..", "..", ".env"));
  } catch {
    // Already in the environment, or not needed. A missing value is reported
    // where it is used, by name.
  }
}

function payer(): Keypair {
  const path = process.env.DEVNET_PAYER_KEYPAIR;
  if (path === undefined || path === "") {
    throw new Error("DEVNET_PAYER_KEYPAIR is not set, see .env.example");
  }
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(resolve(path), "utf8")) as number[])
  );
}

async function main(): Promise<void> {
  loadEnv();
  const rpc = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const wallet = payer();
  const started = await connection.getBalance(wallet.publicKey);
  const account: PublicKey = priceFeedAddress(AAPL_FEED_ID, PANGU_SHARD_ID);

  console.log(`network : devnet, ${rpc}`);
  console.log(`payer   : ${wallet.publicKey.toBase58()}`);
  console.log(`balance : ${started / LAMPORTS_PER_SOL} SOL`);
  console.log(`shard   : ${PANGU_SHARD_ID}`);
  console.log(`account : ${account.toBase58()}`);

  const built = await refreshPriceTransaction({
    connection,
    payer: wallet.publicKey,
    feed: { priceFeedId: AAPL_FEED_ID },
  });
  console.log(
    `bytes   : ${built.bytes} across ${built.transactions.length} transactions, limit 1232 each`
  );

  for (const [index, entry] of built.transactions.entries()) {
    entry.transaction.message.recentBlockhash = (
      await connection.getLatestBlockhash("confirmed")
    ).blockhash;
    entry.transaction.sign([wallet, ...entry.signers]);
    const signature = await connection.sendTransaction(entry.transaction, {
      skipPreflight: true,
      maxRetries: 0,
    });
    await connection.confirmTransaction(signature, "confirmed");
    const detail = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    console.log(
      `sent ${index + 1}  : ${signature}, fee ${detail?.meta?.fee} lamports, ${detail?.meta?.computeUnitsConsumed} compute units`
    );
  }

  const info = await connection.getAccountInfo(built.priceAccount, "confirmed");
  if (info === null) {
    throw new Error("the price account does not exist after the refresh");
  }
  if (!info.owner.equals(PYTH_RECEIVER_PROGRAM_ID)) {
    throw new Error(`the price account is owned by ${info.owner.toBase58()}`);
  }
  const update = decodePriceUpdate(info.data);
  if (update.feedId !== AAPL_FEED_ID) {
    throw new Error(`this account carries feed 0x${update.feedId}, not ours`);
  }

  const dollars = stockPriceDollars(update.price, update.exponent);
  console.log(`size    : ${info.data.length} bytes, owned by the receiver`);
  console.log(`verified: ${update.fullyVerified ? "Full" : "Partial, which Pangu refuses"}`);
  console.log(
    `AAPL    : ${Number(dollars) / Number(DOLLAR_SCALE)} dollars, confidence ${confidenceBps(update.price, update.conf)} basis points`
  );
  console.log(
    `published: ${update.publishTime} (${new Date(update.publishTime * 1000).toISOString()}), ${Math.floor(Date.now() / 1000) - update.publishTime} seconds ago`
  );
  console.log(
    `spent   : ${started - (await connection.getBalance(wallet.publicKey))} lamports, net of the rent this reclaimed`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
