/**
 * Gives a devnet sale a history a judge can look at: approved buyers, buys of
 * different sizes under the cap, and two of them selling part of it back.
 *
 *   npm run seed
 *   npm run seed -- --mint <mint>
 *   npm run seed -- --seed-to-share 58
 *
 * With no target it makes six buys of one size, which is what a sale priced in
 * SOL wants. With `--seed-to-share` it makes eight of different sizes and stops
 * when that share of the curve's tokens has sold, which is how a banded sale is
 * walked up to just under its ceiling. A curve already past the target is
 * brought back to it by the seeded wallets selling.
 *
 * Safe to run twice. The wallets are derived from the paying key and the mint,
 * so the second run finds them already approved, already holding, and does
 * nothing except print where the sale stands.
 */

import { PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import { NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  ACCESS_MODE,
  TOKEN_2022_PROGRAM_ID,
  approveBuyerInstruction,
  curvePriceDollars,
  dollars,
  getBuyerRecord,
  getSale,
  listBuyerRecords,
  priceCeiling,
  readPrice,
  saleStanding,
} from "pangu-sdk";
import { loadPool, sellTransaction } from "pangu-sdk/dbc";
import { amount, readFlags } from "./arguments.js";
import {
  SEED_WEIGHTS,
  buyWithin,
  seedBuySize,
  sellBackSize,
  sizedBuy,
  targetSold,
  type SizedBuy,
} from "./buying.js";
import { send } from "./chain.js";
import { addressLink, devnet, payerKeypair, requireDevnet, sol } from "./environment.js";
import { chooseSale } from "./sales.js";
import { fundQuoteTokens, fundWallets, repeatableWallet } from "./wallets.js";

/** How many wallets buy when the run is not aimed at a share of the curve. */
const BUYERS = 6;

/** What `--seed-to-share` means when it is not given: seed to no target at all. */
const NO_TARGET = 0;

/** The two buyers that also sell, so the sale has an exit in its history. */
const SELLERS = 2;

/**
 * Enough for the token accounts, the buy and the fees, with a little spare.
 *
 * The seeded wallets keep what is left rather than handing it back. They are
 * the only wallets that can sell what they bought, and `prove` makes one of
 * them do exactly that, which needs a fee.
 */
const FUNDING_LAMPORTS = 12_000_000;

/** What each demo buy aims at when there is no target, as a share of one wallet's cap. */
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
  const flags = readFlags(process.argv.slice(2), ["mint", "seed-to-share"]);
  const record = chooseSale(flags.get("mint"));
  // A percentage of the tokens the curve sells. Left out, the run has no target
  // and seeds the six even buys a SOL priced sale wants.
  const target = amount(flags, "seed-to-share", 1, 95, NO_TARGET) / 100;

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

  const view = await loadPool(connection, mint);
  const payingInSol = view.quoteMint.equals(NATIVE_MINT);
  // What the curve sells in total, worked back from the cap, which is that
  // number times the cap's share in basis points.
  const curveTokens = (sale.cap * 10_000n) / BigInt(record.capShareBps);
  if (target > NO_TARGET) {
    console.log(
      `target  : ${(target * 100).toFixed(1)} percent of the ${curveTokens} raw units this curve sells, in ${SEED_WEIGHTS.length} buys of different sizes`
    );
  }

  const wallets = target > NO_TARGET ? SEED_WEIGHTS.length : BUYERS;
  const buyers = Array.from({ length: wallets }, (_unused, index) =>
    repeatableWallet(issuer, mint, "seed buyer", index)
  );
  const funded = await fundWallets(
    connection,
    issuer,
    buyers.map((wallet) => wallet.publicKey),
    FUNDING_LAMPORTS
  );
  console.log(`buyers  : ${wallets} demo wallets, ${sol(funded)} SOL sent to them this run`);

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
      console.log(`approve : all ${wallets} were already approved, nothing sent`);
    }
  } else if (sale.accessMode === ACCESS_MODE.verifierCredential) {
    console.log(
      "approve : this sale reads attestations from a verifier, so there is no list to add anyone to"
    );
  } else {
    console.log("approve : open access, a buyer only needs their own record");
  }

  // Raw units of the paying token, whatever that token is. The old spelling of
  // this line used lamports, which is right for a SOL sale and a thousand times
  // wrong for a six decimal dollar token.
  const evenBuy = BigInt(
    Math.round(
      record.thresholdSol *
        10 ** sale.quoteDecimals *
        (record.capShareBps / 10_000) *
        SHARE_OF_CAP
    )
  );

  let sold = saleStanding(sale, await listBuyerRecords(connection, mint)).totalNetBought;

  // A target under where the curve already stands is met by selling, not
  // buying. Anything can push a curve past its target: another buyer, or an
  // attack run cut off after it had filled a wallet, whose throwaway keys died
  // with it. Only the seeded wallets can still be signed for, so they sell the
  // excess back between them, each in proportion to what it holds.
  const wantedSold = targetSold(curveTokens, target);
  if (target > NO_TARGET && sold > wantedSold) {
    const excess = sold - wantedSold;
    const holdings: bigint[] = [];
    for (const wallet of buyers) {
      holdings.push(
        await tokenBalance(
          connection,
          getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID)
        )
      );
    }
    const seededTotal = holdings.reduce((sum, each) => sum + each, 0n);
    console.log(
      `above   : ${((Number(sold) / Number(curveTokens)) * 100).toFixed(2)} percent of the curve has sold, so the seeded wallets sell ${excess} raw units back`
    );
    for (const [index, wallet] of buyers.entries()) {
      const amountIn = sellBackSize(holdings[index] ?? 0n, excess, seededTotal);
      if (amountIn === 0n) {
        continue;
      }
      const sell = await sellTransaction({ connection, seller: wallet.publicKey, mint, amountIn });
      const landed = await send(connection, `selling back ${index + 1}`, sell.transaction, [
        wallet,
      ]);
      sold -= amountIn;
      console.log(`back ${index + 1}  : ${amountIn} raw units to the pool, ${landed.link}`);
    }
  }

  for (const [index, wallet] of buyers.entries()) {
    const before = await getBuyerRecord(connection, mint, wallet.publicKey);
    const held = before === null ? 0n : before.netBought;

    // Without a target, a wallet that already holds is a wallet this run has
    // nothing left to do for. With one, what matters is where the curve stands,
    // so a wallet that holds buys the rest of the way to the target instead:
    // a run the node cut short can be finished by running it again.
    if (target === NO_TARGET && held > 0n) {
      console.log(`buy ${index + 1}   : already holds ${held} raw units, skipped`);
      continue;
    }

    let buy: SizedBuy;
    if (target > NO_TARGET) {
      const planned = seedBuySize({ curveTokens, sold, target, cap: sale.cap }, index);
      const capRoom = sale.cap - held;
      const room = planned < capRoom ? planned : capRoom;
      if (room <= 0n) {
        console.log(
          `buy ${index + 1}   : nothing to buy, ${planned === 0n ? "the curve is at its target" : "this wallet is at its cap"}`
        );
        continue;
      }
      buy = await sizedBuy(connection, wallet.publicKey, mint, sale, room);
    } else {
      buy = await buyWithin(connection, wallet.publicKey, mint, evenBuy, sale.cap);
    }

    // A wallet holding only devnet SOL cannot buy in a sale priced in something
    // else: the swap takes the paying token out of the buyer's own account, so
    // the refusal would come from the token program and would say nothing about
    // this sale. It is handed exactly what the buy spends, so the account is
    // empty afterwards and the sell further down can still tell a wallet that
    // has sold from one that has not.
    if (!payingInSol) {
      await fundQuoteTokens(
        connection,
        issuer,
        view.quoteMint,
        view.quoteProgram,
        sale.quoteDecimals,
        [{ wallet: wallet.publicKey, amount: buy.amountIn }]
      );
    }

    const landed = await send(connection, `demo buy ${index + 1}`, buy.transaction, [wallet]);
    sold += buy.expectedAmountOut;
    console.log(
      `buy ${index + 1}   : ${buy.expectedAmountOut} raw units, ${((Number(buy.expectedAmountOut) / Number(curveTokens)) * 100).toFixed(2)} percent of the curve, ${landed.link}`
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
  if (sale.hasBand) {
    const price = await readPrice(connection, sale);
    const curve = curvePriceDollars(
      BigInt((await loadPool(connection, mint)).poolAccount.poolState.sqrtPrice.toString()),
      sale.baseDecimals,
      sale.quoteDecimals
    );
    const ceiling = priceCeiling(sale, price.price);
    console.log(
      `price   : ${dollars(curve).toFixed(4)} dollars a share against a ceiling of ${dollars(ceiling).toFixed(4)}, ${(((Number(ceiling) - Number(curve)) / Number(ceiling)) * 100).toFixed(2)} percent under it`
    );
  }
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
