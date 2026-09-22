// Proves `refreshPriceTransaction` against the live production AAPL feeds on
// devnet, and reads the result back with the core entry point's `readPrice`.
//
//   npx tsx scripts/refresh-devnet.ts
//
// The payer is a throwaway devnet key outside this package, at
// spikes/switchboard/devnet-keypair.json. It is read, never printed, and nothing
// here touches mainnet. Run it twice: the account address must not change and
// the slot must.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { decodeQuote, DOLLAR_SCALE } from "../src/index.js";
import { refreshPriceTransaction } from "../src/price.js";

/** The queue and the two feed ids the project's own AAPL feeds resolve to. */
const QUEUE = new PublicKey("EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7");
const PRICE_FEED_ID =
  "db4fa77aa3c4e909923c4767ae01f5d2a3d0c7138c953db372639122bdeceb3d";
const CLOCK_FEED_ID =
  "15ff868ad9e4b29e63e75b68a527df7d8f2fa83782938b233d03ea5e259d08c5";

const RPC = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";

function payer(): Keypair {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, "..", "..", "..", "spikes", "switchboard", "devnet-keypair.json");
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(file, "utf8")) as number[])
  );
}

async function main(): Promise<void> {
  const connection = new Connection(RPC, "confirmed");
  const wallet = payer();
  const started = await connection.getBalance(wallet.publicKey);
  console.log(`network : devnet, ${RPC}`);
  console.log(`payer   : ${wallet.publicKey.toBase58()}`);
  console.log(`balance : ${started / LAMPORTS_PER_SOL} SOL`);

  const built = await refreshPriceTransaction({
    connection,
    payer: wallet.publicKey,
    feeds: {
      queue: QUEUE,
      priceFeedId: PRICE_FEED_ID,
      clockFeedId: CLOCK_FEED_ID,
      minOracles: 1,
    },
  });
  console.log(`account : ${built.quoteAccount.toBase58()}`);
  console.log(`bytes   : ${built.bytes} of the 1232 byte limit`);

  built.transaction.sign([wallet]);
  const signature = await connection.sendTransaction(built.transaction, {
    skipPreflight: true,
    maxRetries: 0,
  });
  await connection.confirmTransaction(signature, "confirmed");
  const detail = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  console.log(`signature: ${signature}`);
  console.log(`fee      : ${detail?.meta?.fee} lamports`);
  console.log(`compute  : ${detail?.meta?.computeUnitsConsumed} units`);

  const account = await connection.getAccountInfo(built.quoteAccount, "confirmed");
  if (account === null) {
    throw new Error("the quote account does not exist after the refresh");
  }
  const quote = decodeQuote(account.data);
  const price = quote.feeds.find((feed) => feed.id === PRICE_FEED_ID);
  const clock = quote.feeds.find((feed) => feed.id === CLOCK_FEED_ID);
  if (price === undefined || clock === undefined) {
    throw new Error("the quote does not carry both feeds");
  }
  const currentSlot = await connection.getSlot("confirmed");
  const tradedAt = Number(clock.value / DOLLAR_SCALE);
  console.log(`quote slot: ${quote.slot}, current slot ${currentSlot}, age ${currentSlot - Number(quote.slot)} slots`);
  console.log(`signatures: ${quote.signatures}`);
  console.log(`AAPL      : ${Number(price.value) / 1e18} dollars`);
  console.log(
    `last trade: ${new Date(tradedAt * 1000).toISOString()}, ${Math.floor(Date.now() / 1000) - tradedAt} seconds ago`
  );
  console.log(
    `spent     : ${started - (await connection.getBalance(wallet.publicKey))} lamports`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
