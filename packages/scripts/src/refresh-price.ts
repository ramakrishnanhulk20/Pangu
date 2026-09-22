/**
 * One refresh of a Pyth stock price on devnet, on the shard Pangu reads.
 *
 *   npm run refresh-price
 *   npm run refresh-price -- --feed Crypto.AAPLX/USD
 *
 * Anyone can send this and the account's address does not depend on who does,
 * so a sale can name it before anybody has ever refreshed it. It needs
 * PYTH_API_KEY in .env, because every Hermes read has needed a key since 26
 * August 2026. The key is read from the environment and never printed.
 */

import { readFlags, text } from "./arguments.js";
import { devnet, payerKeypair, requireDevnet, rpcUrl, sol } from "./environment.js";
import { DEFAULT_FEED, MAX_PRICE_AGE_SECS } from "./feeds.js";
import { refreshFeedPrice } from "./price-refresh.js";

async function main(): Promise<void> {
  const flags = readFlags(process.argv.slice(2), ["feed"]);
  const symbol = text(flags, "feed", DEFAULT_FEED);

  const connection = devnet();
  await requireDevnet(connection);
  const payer = payerKeypair();

  console.log(`network   : devnet, ${rpcUrl()}`);
  console.log(`payer     : ${payer.publicKey.toBase58()}`);

  const refresh = await refreshFeedPrice(connection, payer, symbol);
  const published = new Date(refresh.publishTime * 1000).toISOString();

  console.log(`feed      : ${refresh.feed.symbol} (${refresh.feed.name})`);
  console.log(`feed id   : 0x${refresh.feed.id}`);
  console.log(`account   : ${refresh.priceAccount.toBase58()}`);
  console.log(`            ${refresh.accountLink}`);
  for (const link of refresh.links) {
    console.log(`signature : ${link}`);
  }
  console.log(
    `price     : ${refresh.price.toFixed(4)} dollars, confidence ${refresh.confBps} basis points`
  );
  console.log(
    `published : ${published}, ${refresh.secondsOld} seconds ago, of an allowed ${MAX_PRICE_AGE_SECS}`
  );
  console.log(
    `verified  : ${refresh.fullyVerified ? "Full, two thirds of the Wormhole guardians" : "Partial, which Pangu refuses"}`
  );
  console.log(
    `cost      : ${refresh.spent} lamports (${sol(refresh.spent)} SOL), ${refresh.computeUnits} compute units, ${refresh.bytes} bytes`
  );

  if (refresh.secondsOld > MAX_PRICE_AGE_SECS) {
    console.log("");
    console.log(
      `note      : this is the freshest price Pyth has, and it is already older than a banded sale allows. That is a shut market, not a broken refresh: Pyth stops publishing an equity outside its trading sessions. A sale banded against one of the Crypto.*X feeds stays open around the clock.`
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
