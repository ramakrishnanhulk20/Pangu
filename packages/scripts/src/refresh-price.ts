/**
 * One refresh of the production AAPL quote on devnet.
 *
 *   npm run refresh-price
 *
 * Anyone can send this and the account's address does not depend on who does,
 * so a sale can name it before anybody has ever refreshed it.
 */

import { devnet, payerKeypair, requireDevnet, rpcUrl } from "./environment.js";
import { refreshAaplQuote } from "./quote-refresh.js";

async function main(): Promise<void> {
  const connection = devnet();
  await requireDevnet(connection);
  const payer = payerKeypair();

  console.log(`network   : devnet, ${rpcUrl()}`);
  console.log(`payer     : ${payer.publicKey.toBase58()}`);

  const refresh = await refreshAaplQuote(connection, payer);
  const tradedAt = new Date(refresh.lastTradeUnix * 1000).toISOString();

  console.log(`account   : ${refresh.quoteAccount.toBase58()}`);
  console.log(`            ${refresh.accountLink}`);
  console.log(`signature : ${refresh.signature}`);
  console.log(`            ${refresh.link}`);
  console.log(`AAPL      : ${refresh.price.toFixed(2)} dollars`);
  console.log(`last trade: ${tradedAt}, ${refresh.secondsSinceTrade} seconds ago`);
  console.log(`quote age : ${refresh.ageSlots} slots, ${refresh.signatures} oracle signature`);
  console.log(`cost      : ${refresh.fee} lamports, ${refresh.computeUnits} compute units, ${refresh.bytes} bytes`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
