/**
 * Attacks a live Pangu sale on devnet and prints every refusal.
 *
 *   npm run prove
 *   npm run prove -- --mint <mint>
 *
 * Each attack is a real transaction sent to the real program, landed on chain
 * on purpose so a reader gets a signature to open rather than a promise that it
 * was tried. Every refusal is read back through the program's own error names,
 * never from "it failed", and the command exits non-zero if anything did
 * something other than what the rules promise.
 */

import {
  PublicKey,
  Transaction,
  type Connection,
  type Keypair,
  type Signer,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  ACCESS_MODE,
  TOKEN_2022_PROGRAM_ID,
  approveBuyerInstruction,
  curvePriceDollars,
  dollars,
  getBuyerRecord,
  getSale,
  isSaleRunning,
  listBuyerRecords,
  priceCeiling,
  readPrice,
  revokeBuyerInstruction,
  saleStanding,
  type PanguErrorName,
  type Sale,
} from "pangu-sdk";
import { buyTransaction, loadPool, preflightBuy, sellTransaction } from "pangu-sdk/dbc";
import { readFlags } from "./arguments.js";
import {
  directExecute,
  newTokenAccount,
  redirectBuy,
  withoutRecordOpening,
} from "./attacks.js";
import {
  exitCode,
  renderLinks,
  renderTable,
  summarise,
  summaryLine,
  type AttackReport,
} from "./attack-table.js";
import { buyWithin } from "./buying.js";
import { attempt, lastLogLine, refusal, send } from "./chain.js";
import { addressLink, devnet, payerKeypair, requireDevnet, sol } from "./environment.js";
import { chooseSale } from "./sales.js";
import {
  freshWallet,
  fundQuoteTokens,
  fundWallets,
  returnLeftovers,
} from "./wallets.js";

/** Spare devnet SOL each attacking wallet gets on top of what it tries to spend. */
const OVERHEAD_LAMPORTS = 12_000_000;

/** How much more than the cap the one-shot over-cap buy reaches for. */
const OVER_CAP_TRIES = [3n, 2n, 1n];

const connection: Connection = devnet();

function skipped(
  attack: string,
  invariant: string,
  expected: string,
  why: string
): AttackReport {
  return {
    attack,
    invariant,
    expected,
    actual: why,
    verdict: "skipped",
    signature: null,
    link: null,
  };
}

/** Sends an attack that must be refused, and reads the refusal off the chain. */
async function mustRefuse(
  attack: string,
  invariant: string,
  expected: PanguErrorName,
  transaction: Transaction,
  signers: Signer[]
): Promise<AttackReport> {
  console.log(`trying   : ${attack}`);
  const landed = await attempt(connection, transaction, signers);
  const found = refusal(landed);
  const actual = landed.succeeded
    ? "it went through"
    : (found?.name ?? `refused, but not by Pangu: ${lastLogLine(landed)}`);
  return {
    attack,
    invariant,
    expected,
    actual,
    verdict: landed.succeeded ? "allowed" : "refused",
    signature: landed.signature,
    link: landed.link,
  };
}

/** Sends something the rules promise will work, such as a holder selling back. */
async function mustPass(
  attack: string,
  invariant: string,
  transaction: Transaction,
  signers: Signer[]
): Promise<AttackReport> {
  const expected = "it goes through";
  console.log(`trying   : ${attack}`);
  const landed = await attempt(connection, transaction, signers);
  const found = refusal(landed);
  return {
    attack,
    invariant,
    expected,
    actual: landed.succeeded
      ? expected
      : `refused with ${found?.name ?? lastLogLine(landed)}`,
    verdict: landed.succeeded ? "allowed" : "refused",
    signature: landed.signature,
    link: landed.link,
  };
}

/** A buy larger than the cap allows, as large as this curve can still fill. */
async function oversizedBuy(
  buyer: PublicKey,
  mint: PublicKey,
  capWorth: bigint,
  cap: bigint
): Promise<Transaction> {
  for (const multiple of OVER_CAP_TRIES) {
    try {
      const built = await buyTransaction({
        connection,
        buyer,
        mint,
        amountIn: capWorth * multiple,
      });
      if (built.expectedAmountOut > cap) {
        return built.transaction;
      }
    } catch {
      continue;
    }
  }
  throw new Error("could not build a buy that passes the cap on this curve");
}

async function tokenBalance(account: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(account, "confirmed");
  return info === null ? 0n : info.data.readBigUInt64LE(64);
}

async function main(): Promise<void> {
  const flags = readFlags(process.argv.slice(2), ["mint"]);
  const record = chooseSale(flags.get("mint"));
  await requireDevnet(connection);

  const issuer: Keypair = payerKeypair();
  const mint = new PublicKey(record.mint);
  const sale: Sale | null = await getSale(connection, mint);
  if (sale === null) {
    throw new Error(`${record.mint} has no Pangu sale on devnet`);
  }
  if (!(await isSaleRunning(connection, mint))) {
    throw new Error(
      `this sale has already graduated, so the mint no longer names Pangu as its hook and there are no rules left to attack. Launch a new sale to prove them.`
    );
  }

  const listMode = sale.accessMode === ACCESS_MODE.issuerList;
  const price = sale.hasBand ? await readPrice(connection, sale) : null;

  // The pool itself, for the token buyers pay in and for where the curve stands.
  const view = await loadPool(connection, mint);
  const quoteMint = view.quoteMint;
  const quoteDecimals = (
    await getMint(connection, quoteMint, "confirmed", view.quoteProgram)
  ).decimals;
  const payingInSol = quoteMint.equals(NATIVE_MINT);

  const ceiling =
    price !== null && price.usable ? priceCeiling(sale, price.price) : null;
  const curveNow = sale.hasBand
    ? curvePriceDollars(
        BigInt(view.poolAccount.poolState.sqrtPrice.toString()),
        sale.baseDecimals,
        sale.quoteDecimals
      )
    : null;
  const aboveCeiling = ceiling !== null && curveNow !== null && curveNow > ceiling;

  // What a banded sale would refuse every buy with right now, or null when buys
  // can go through. PriceStale, PriceTooUncertain and PriceNotFullyVerified are
  // the same answer as far as the rest of the run is concerned: the band fails
  // closed, and nothing that needs a buy to land can be set up. A curve already
  // standing above the ceiling is that same answer again, because the hook reads
  // the band before the cap, so PriceOutsideBand is what every buy meets.
  const bandRefusal: PanguErrorName | null =
    price === null
      ? null
      : !price.usable
        ? (price.error ?? "PriceStale")
        : aboveCeiling
          ? "PriceOutsideBand"
          : null;
  const canBuy = bandRefusal === null;
  const stock = record.feed ?? "the stock";

  console.log(`sale     : ${record.name} (${record.symbol}), ${record.mode} access`);
  console.log(`mint     : ${record.mint}`);
  console.log(`           ${addressLink(mint)}`);
  console.log(`cap      : ${sale.cap} raw units per wallet`);
  if (price !== null) {
    console.log(
      `band     : ${sale.bandBps / 100} percent over ${stock} at ${price.priceDollars.toFixed(4)} dollars, from Pyth shard ${sale.priceShard}`
    );
    console.log(
      `price    : ${price.usable ? "usable" : `not usable, ${price.error}`}, published ${price.ageSecs} seconds ago of an allowed ${sale.maxPriceAgeSecs}, confidence ${price.confBps} of an allowed ${sale.maxConfBps} basis points`
    );
    console.log(
      `account  : ${sale.priceAccount.toBase58()}, ${price.fullyVerified ? "fully verified by the Wormhole guardians" : "not fully verified"}`
    );
  }
  if (curveNow !== null && ceiling !== null) {
    console.log(
      `curve    : ${dollars(curveNow).toFixed(4)} dollars a share against a ceiling of ${dollars(ceiling).toFixed(4)}, so ${aboveCeiling ? "every buy is refused" : "there is room under the band"}`
    );
  }

  // Raw units of the paying token, whatever that token is: the threshold in
  // whole units of it, its own decimals, and the cap's share of the curve. Whole
  // numbers all the way through, because a dollar threshold is bigger than a
  // float carries to the last unit.
  const capWorth =
    (BigInt(Math.round(record.thresholdSol * 100)) *
      10n ** BigInt(quoteDecimals) *
      BigInt(record.capShareBps)) /
    1_000_000n;
  const smallBuy = capWorth / 5n > 0n ? capWorth / 5n : 1_000_000n;

  const newcomer = freshWallet();
  const filler = freshWallet();
  const careless = freshWallet();
  const stranger = freshWallet();
  // Whatever happens next, including a crash halfway through, the devnet SOL
  // these three are holding goes back to the payer.
  const spenders = [newcomer, filler, careless];

  const started = await connection.getBalance(issuer.publicKey, "confirmed");
  const reports: AttackReport[] = [];

  const sweep = async (): Promise<number> => {
    let returned = 0;
    for (const wallet of spenders) {
      returned += await returnLeftovers(connection, issuer, wallet);
    }
    return returned;
  };
  // A node that rate limits us can end the process from inside the web3.js
  // client, which would strand the devnet SOL these wallets are holding.
  const rescue = (error: unknown): void => {
    console.error(error);
    void sweep().then(() => process.exit(1));
  };
  process.on("uncaughtException", rescue);
  process.on("unhandledRejection", rescue);

  try {
    if (payingInSol) {
      await fundWallets(
        connection,
        issuer,
        [newcomer.publicKey],
        Number(smallBuy) + OVERHEAD_LAMPORTS
      );
      await fundWallets(
        connection,
        issuer,
        [filler.publicKey],
        Number(capWorth * 5n) + OVERHEAD_LAMPORTS
      );
      await fundWallets(
        connection,
        issuer,
        [careless.publicKey],
        Number(capWorth) + OVERHEAD_LAMPORTS
      );
    } else {
      // The paying token is not SOL, so each wallet needs devnet SOL for the
      // fees and the accounts, and the paying token for the buy itself.
      await fundWallets(
        connection,
        issuer,
        spenders.map((wallet) => wallet.publicKey),
        OVERHEAD_LAMPORTS
      );
      await fundQuoteTokens(
        connection,
        issuer,
        quoteMint,
        view.quoteProgram,
        quoteDecimals,
        [
          { wallet: newcomer.publicKey, amount: smallBuy },
          { wallet: filler.publicKey, amount: capWorth * 5n },
          { wallet: careless.publicKey, amount: capWorth },
        ]
      );
    }
    console.log(`wallets  : three fresh ones, never seen by this sale`);
    console.log("");

    const noRecordBuy = await buyTransaction({
      connection,
      buyer: newcomer.publicKey,
      mint,
      amountIn: smallBuy,
    });
    reports.push(
      await mustRefuse(
        "buy with no buyer record",
        "C2",
        "BuyerRecordMissing",
        withoutRecordOpening(noRecordBuy.transaction, newcomer.publicKey, mint),
        [newcomer]
      )
    );

    if (listMode) {
      const unapproved = await buyTransaction({
        connection,
        buyer: newcomer.publicKey,
        mint,
        amountIn: smallBuy,
      });
      reports.push(
        await mustRefuse(
          "buy while not on the approved list",
          "C6",
          "NotApproved",
          unapproved.transaction,
          [newcomer]
        )
      );
      const approvals = new Transaction()
        .add(
          approveBuyerInstruction({
            issuer: issuer.publicKey,
            mint,
            wallet: filler.publicKey,
          })
        )
        .add(
          approveBuyerInstruction({
            issuer: issuer.publicKey,
            mint,
            wallet: careless.publicKey,
          })
        );
      await send(connection, "approving the two attacking wallets", approvals, [issuer]);
    } else {
      reports.push(
        skipped(
          "buy while not on the approved list",
          "C6",
          "NotApproved",
          "this sale has open access, so there is no list to be left off"
        )
      );
    }

    reports.push(
      await mustRefuse(
        "buy past the cap in one go",
        "C3",
        bandRefusal ?? "OverCap",
        await oversizedBuy(filler.publicKey, mint, capWorth, sale.cap),
        [filler]
      )
    );

    const fillerAta = getAssociatedTokenAddressSync(
      mint,
      filler.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const carelessAta = getAssociatedTokenAddressSync(
      mint,
      careless.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const strangerAta = getAssociatedTokenAddressSync(
      mint,
      stranger.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const shut =
      bandRefusal === "PriceOutsideBand"
        ? "the curve already stands above the ceiling, so no buy can land to set this up"
        : `the sale's price cannot be used right now (${bandRefusal}), so no buy can land to set this up`;

    if (canBuy) {
      const toTheCap = await buyWithin(
        connection,
        filler.publicKey,
        mint,
        capWorth * 2n,
        sale.cap
      );
      await send(connection, "filling one wallet to its cap", toTheCap.transaction, [filler]);
      const held = await getBuyerRecord(connection, mint, filler.publicKey);
      console.log(
        `filled   : one wallet holds ${held?.netBought ?? 0n} of its ${sale.cap} raw unit cap`
      );

      const second = await buyTransaction({
        connection,
        buyer: filler.publicKey,
        mint,
        amountIn: smallBuy,
      });
      reports.push(
        await mustRefuse(
          "a second buy that crosses the cap",
          "C3",
          "OverCap",
          second.transaction,
          [filler]
        )
      );

      const fixedOwner = await newTokenAccount(connection, filler.publicKey, mint, true);
      const intoSecondAccount = await buyTransaction({
        connection,
        buyer: filler.publicKey,
        mint,
        amountIn: smallBuy,
      });
      const redirected = redirectBuy(
        intoSecondAccount.transaction,
        fillerAta,
        fixedOwner.account.publicKey
      );
      redirected.instructions.unshift(...fixedOwner.instructions);
      reports.push(
        await mustRefuse(
          "buy into a second token account of the same wallet",
          "C3",
          "OverCap",
          redirected,
          [filler, fixedOwner.account]
        )
      );

      const firstBuy = await buyWithin(
        connection,
        careless.publicKey,
        mint,
        smallBuy,
        sale.cap
      );
      await send(connection, "a normal buy, under the cap", firstBuy.transaction, [careless]);
    } else {
      const wouldBuy = await buyWithin(
        connection,
        careless.publicKey,
        mint,
        smallBuy,
        sale.cap
      );
      reports.push(
        await mustRefuse(
          bandRefusal === "PriceOutsideBand"
            ? "buy while the curve stands above the ceiling"
            : "buy while the sale's price cannot be used",
          "C9",
          bandRefusal ?? "PriceStale",
          wouldBuy.transaction,
          [careless]
        )
      );
      reports.push(
        skipped("a second buy that crosses the cap", "C3", "OverCap", shut),
        skipped("buy into a second token account of the same wallet", "C3", "OverCap", shut)
      );
    }

    const changeableOwner = await newTokenAccount(
      connection,
      careless.publicKey,
      mint,
      false
    );
    const intoChangeable = await buyTransaction({
      connection,
      buyer: careless.publicKey,
      mint,
      amountIn: smallBuy,
    });
    const changeable = redirectBuy(
      intoChangeable.transaction,
      carelessAta,
      changeableOwner.account.publicKey
    );
    changeable.instructions.unshift(...changeableOwner.instructions);
    reports.push(
      await mustRefuse(
        "buy into an account whose owner can still change",
        "C13",
        "ReceivingAccountOwnerCanChange",
        changeable,
        [careless, changeableOwner.account]
      )
    );

    // Both accounts have to exist before the hook's own account list can be
    // resolved against them, and on a sale where no buy can land the attacking
    // wallet has never opened its own.
    await send(
      connection,
      "opening the two token accounts the next attacks move between",
      new Transaction()
        .add(
          createAssociatedTokenAccountIdempotentInstruction(
            careless.publicKey,
            carelessAta,
            careless.publicKey,
            mint,
            TOKEN_2022_PROGRAM_ID
          )
        )
        .add(
          createAssociatedTokenAccountIdempotentInstruction(
            careless.publicKey,
            strangerAta,
            stranger.publicKey,
            mint,
            TOKEN_2022_PROGRAM_ID
          )
        ),
      [careless]
    );

    const carelessHolds = await tokenBalance(carelessAta);
    if (carelessHolds > 0n) {
      const walletToWallet = await createTransferCheckedWithTransferHookInstruction(
        connection,
        carelessAta,
        mint,
        strangerAta,
        careless.publicKey,
        carelessHolds / 2n,
        (await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID)).decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      reports.push(
        await mustRefuse(
          "send tokens straight to another wallet",
          "C4",
          "WalletToWalletDuringSale",
          new Transaction().add(walletToWallet),
          [careless]
        )
      );
    } else {
      reports.push(
        skipped(
          "send tokens straight to another wallet",
          "C4",
          "WalletToWalletDuringSale",
          shut
        )
      );
    }

    const calledDirectly = await directExecute(connection, {
      mint,
      source: carelessAta,
      destination: strangerAta,
      authority: careless.publicKey,
      amount: 1n,
    });
    reports.push(
      await mustRefuse(
        "call the hook on its own, with no transfer",
        "C1",
        "NotTransferring",
        new Transaction().add(calledDirectly),
        [careless]
      )
    );

    const fillerHolds = await tokenBalance(fillerAta);
    if (listMode && fillerHolds > 0n) {
      await send(
        connection,
        "revoking the approval of a wallet that already holds",
        new Transaction().add(
          revokeBuyerInstruction({
            issuer: issuer.publicKey,
            mint,
            wallet: filler.publicKey,
          })
        ),
        [issuer]
      );
      const exit = await sellTransaction({
        connection,
        seller: filler.publicKey,
        mint,
        amountIn: fillerHolds / 4n,
      });
      reports.push(
        await mustPass("a revoked wallet sells back to the pool", "C5", exit.transaction, [
          filler,
        ])
      );
    } else {
      reports.push(
        skipped(
          "a revoked wallet sells back to the pool",
          "C5",
          "it goes through",
          listMode ? shut : "nothing to revoke: this sale has open access"
        )
      );
    }

    if (price !== null && price.usable) {
      const room = await preflightBuy({
        connection,
        buyer: careless.publicKey,
        mint,
        amountOut: sale.cap,
      });
      if (room.error === "PriceOutsideBand" || aboveCeiling) {
        const overCeiling = await buyTransaction({
          connection,
          buyer: careless.publicKey,
          mint,
          amountIn: capWorth,
        });
        reports.push(
          await mustRefuse(
            "buy that would push the price past the ceiling",
            "C9",
            "PriceOutsideBand",
            overCeiling.transaction,
            [careless]
          )
        );
      } else {
        reports.push(
          skipped(
            "buy that would push the price past the ceiling",
            "C9",
            "PriceOutsideBand",
            `the curve cannot reach it: the largest buy this sale allows lands at ${dollars(room.curvePrice ?? 0n).toFixed(8)} against a ceiling of ${dollars(room.ceiling ?? 0n).toFixed(4)}, because this sale is priced in SOL and the ceiling is in dollars`
          )
        );
      }
    } else if (price === null) {
      reports.push(
        skipped(
          "buy that would push the price past the ceiling",
          "C9",
          "PriceOutsideBand",
          "this sale has no price band"
        )
      );
    } else {
      reports.push(
        skipped(
          "buy that would push the price past the ceiling",
          "C9",
          "PriceOutsideBand",
          `the price is not usable (${price.error}), which stops a buy before the ceiling is ever worked out`
        )
      );
    }

    console.log(renderTable(reports));
    console.log("");
    console.log(renderLinks(reports));

    const after = await getSale(connection, mint);
    const standing = saleStanding(after ?? sale, await listBuyerRecords(connection, mint));
    console.log("");
    console.log(
      `proof    : the largest wallet holds ${(standing.largestShare * 100).toFixed(2)} percent of the ${standing.totalNetBought} raw units sold, against a cap worth ${(standing.capShare * 100).toFixed(2)} percent of them`
    );

  } finally {
    const returned = await sweep();
    const spent = started - (await connection.getBalance(issuer.publicKey, "confirmed"));
    console.log(
      `cost     : ${sol(spent)} SOL, after ${sol(returned)} SOL came back from the attacking wallets`
    );
  }

  const summary = summarise(reports);
  console.log("");
  console.log(summaryLine(summary));
  process.exit(exitCode(reports));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
