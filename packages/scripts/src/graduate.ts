/**
 * Fills a devnet sale's curve with approved buyers, then migrates it to DAMM v2
 * and shows that the token has no rules left on it.
 *
 *   npm run graduate
 *   npm run graduate -- --mint <mint>
 *
 * Migration is permissionless: any wallet can send it, and the sale's creator
 * still gets the locked liquidity. This runs it from the same wallet only
 * because that is the one with devnet SOL.
 */

import { PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import { getTransferHook, unpackMint } from "@solana/spl-token";
import {
  ACCESS_MODE,
  TOKEN_2022_PROGRAM_ID,
  approveBuyerInstruction,
  getSale,
  isSaleRunning,
} from "pangu-sdk";
import { buyTransaction, graduateTransaction, saleProgress } from "pangu-sdk/dbc";
import { readFlags } from "./arguments.js";
import { buyWithin } from "./buying.js";
import { send } from "./chain.js";
import { addressLink, devnet, payerKeypair, requireDevnet, sol } from "./environment.js";
import { chooseSale } from "./sales.js";
import { freshWallet, fundWallets, returnLeftovers } from "./wallets.js";

/** Enough buyers to fill a curve with a ten percent cap, with room to spare. */
const MOST_BUYERS = 40;

/** Rent for the token accounts and the fees, on top of what the wallet spends. */
const OVERHEAD_LAMPORTS = 12_000_000;

/** The last buy takes whatever the curve can still absorb and leaves the rest. */
const FINISHING_HEADROOM = 10_100n;

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

  const started = await connection.getBalance(issuer.publicKey, "confirmed");
  console.log(`sale     : ${record.name} (${record.symbol})`);
  console.log(`mint     : ${record.mint}`);
  console.log(`           ${addressLink(mint)}`);

  const opening = await saleProgress(connection, mint);
  console.log(
    `curve    : ${opening.quoteRaised} of ${opening.threshold} raw units raised, ${Math.round(opening.percent * 100)} percent`
  );

  const used: Keypair[] = [];
  for (let round = 0; round < MOST_BUYERS; round += 1) {
    const progress = await saleProgress(connection, mint);
    if (progress.graduated) {
      break;
    }

    const buyer = freshWallet();
    used.push(buyer);
    const left = progress.threshold - progress.quoteRaised;
    const finishing = left < sale.cap;
    const wanted =
      left < (progress.threshold * 2n) / 10n
        ? (left * FINISHING_HEADROOM) / 10_000n + 100_000n
        : progress.threshold / 10n;

    await fundWallets(
      connection,
      issuer,
      [buyer.publicKey],
      Number(wanted) + OVERHEAD_LAMPORTS
    );
    if (sale.accessMode === ACCESS_MODE.issuerList) {
      await send(
        connection,
        `approving buyer ${round + 1}`,
        new Transaction().add(
          approveBuyerInstruction({
            issuer: issuer.publicKey,
            mint,
            wallet: buyer.publicKey,
          })
        ),
        [issuer]
      );
    }

    // The tokens run out before the paying side does, so the buy that finishes
    // a curve is a partial fill: Meteora takes what is left and leaves the rest
    // in the buyer's account.
    const buy = finishing
      ? await buyTransaction({
          connection,
          buyer: buyer.publicKey,
          mint,
          amountIn: wanted,
          fill: "partial",
        })
      : await buyWithin(connection, buyer.publicKey, mint, wanted, sale.cap);
    const landed = await send(connection, `buy ${round + 1}`, buy.transaction, [buyer]);
    console.log(
      `buy ${String(round + 1).padStart(2)}   : ${buy.expectedAmountOut} raw units, ${landed.link}`
    );
  }

  const filled = await saleProgress(connection, mint);
  if (!filled.graduated) {
    throw new Error(
      `the curve is still short after ${MOST_BUYERS} buyers: ${filled.quoteRaised} of ${filled.threshold}`
    );
  }
  console.log(
    `filled   : ${filled.quoteRaised} of ${filled.threshold} raw units, the curve is full`
  );

  const migration = await graduateTransaction({
    connection,
    payer: issuer.publicKey,
    mint,
  });
  const landed = await send(connection, "the migration to DAMM v2", migration.transaction, [
    issuer,
    ...migration.signers,
  ]);
  const migrated = await saleProgress(connection, mint);
  if (migrated.dammPool === null) {
    throw new Error("the migration landed but there is no DAMM v2 pool");
  }

  const info = await connection.getAccountInfo(mint, "confirmed");
  if (info === null) {
    throw new Error("the mint disappeared");
  }
  const hook = getTransferHook(unpackMint(mint, info, TOKEN_2022_PROGRAM_ID));
  const stillRunning = await isSaleRunning(connection, mint);

  console.log("");
  console.log(`damm v2  : ${migrated.dammPool.toBase58()}`);
  console.log(`           ${addressLink(migrated.dammPool)}`);
  console.log(`migration: ${landed.link}`);
  console.log(
    `hook     : ${hook === null ? "no transfer hook extension" : hook.programId.toBase58()}`
  );
  console.log(
    `rules    : ${stillRunning ? "STILL ON THE MINT" : "gone, the token now moves freely"}`
  );

  let returned = 0;
  for (const wallet of used) {
    returned += await returnLeftovers(connection, issuer, wallet);
  }
  console.log(
    `cost     : ${sol(started - (await connection.getBalance(issuer.publicKey, "confirmed")))} SOL, after ${sol(returned)} SOL came back`
  );

  if (stillRunning) {
    throw new Error("the mint still names Pangu as its hook after migration");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
