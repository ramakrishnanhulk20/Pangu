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
import {
  CurveLimit,
  buyAtLeast,
  buyWithin,
  capWorthAtThreshold,
  overCapSize,
  sizedBuy,
  type SizedBuy,
  type TokenDecimals,
} from "./buying.js";
import { priceAfterOnPool, smallestCrossing } from "./ceiling.js";
import { attempt, lastLogLine, payingDecimals, refusal, send } from "./chain.js";
import { addressLink, devnet, payerKeypair, requireDevnet, sol } from "./environment.js";
import { chooseSale } from "./sales.js";
import {
  buyerFunding,
  freshWallet,
  fundQuoteTokens,
  fundWallets,
  repeatableWallet,
  returnLeftovers,
} from "./wallets.js";

/** Spare devnet SOL each attacking wallet gets on top of what it tries to spend. */
const OVERHEAD_LAMPORTS = 12_000_000;

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

async function tokenBalance(account: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(account, "confirmed");
  return info === null ? 0n : info.data.readBigUInt64LE(64);
}

/** What one seeded wallet still sells back, as a share of what it holds. */
const SELL_SHARE = 4n;

/** How far down the seeded wallets to look for one that can sell. */
const SEEDED_WALLETS = 8;

/**
 * The first wallet `seed` bought with that is still holding something.
 *
 * The wallets are derived from the paying key and the mint the same way `seed`
 * derives them, so no secret is stored anywhere and this run can sign for one
 * of them. Returns null when nothing has been seeded.
 */
async function seedBuyerHolding(
  issuer: Keypair,
  mint: PublicKey
): Promise<{ wallet: Keypair; held: bigint } | null> {
  for (let index = 0; index < SEEDED_WALLETS; index += 1) {
    const wallet = repeatableWallet(issuer, mint, "seed buyer", index);
    const held = await tokenBalance(
      getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID)
    );
    if (held > 0n) {
      return { wallet, held };
    }
  }
  return null;
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
  const quoteDecimals = await payingDecimals(connection, quoteMint);
  const decimals: TokenDecimals = { baseDecimals: sale.baseDecimals, quoteDecimals };
  const payingInSol = quoteMint.equals(NATIVE_MINT);

  const ceiling =
    price !== null && price.usable ? priceCeiling(sale, price.price) : null;
  // Where the curve stands, in whole units of the paying token per share.
  // Read through the paying mint's own decimals, the same number every amount
  // below is scaled with. The sale's rules only carry the quote decimals when
  // the sale has a band, and read 0 otherwise, which once turned the cap's
  // worth on a SOL sale into millions of SOL.
  const curvePrice = curvePriceDollars(
    BigInt(view.poolAccount.poolState.sqrtPrice.toString()),
    sale.baseDecimals,
    quoteDecimals
  );
  const curveNow = sale.hasBand ? curvePrice : null;
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

  const capWorth = capWorthAtThreshold(record.thresholdSol, quoteDecimals, record.capShareBps);
  const smallBuy = capWorth / 5n > 0n ? capWorth / 5n : 1_000_000n;

  // The careless wallet makes one small buy that lands, then tries the
  // changeable-owner attack at the same size, so it holds two of them: a
  // wallet short of the paying token is refused by the token program before
  // Pangu ever sees the buy. The ceiling attack is funded on its own once it
  // has been sized, because only then is its cost known.
  const carelessFunds = smallBuy * 2n;

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

  // What the curve sells in total, worked back from the cap, which is that
  // number times the cap's share in basis points.
  const curveTokens = (sale.cap * 10_000n) / BigInt(record.capShareBps);

  /**
   * The buy that pushes the curve past the ceiling, sized in tokens: the
   * smallest buy whose landing price is over it, found with the same quote the
   * preflight uses, asked of the preflight, and then sent at that same size.
   */
  const ceilingAttack = async (buyer: Keypair, ceilingNow: bigint): Promise<AttackReport> => {
    const attack = "buy that would push the price past the ceiling";
    // Read again: the buys earlier in this run have moved the curve.
    const now = await loadPool(connection, mint);
    const crossing = smallestCrossing(priceAfterOnPool(now, decimals), ceilingNow, curveTokens);
    if (crossing.tokens === null) {
      if (crossing.highest === null) {
        return skipped(
          attack,
          "C9",
          "PriceOutsideBand",
          "this curve cannot fill any buy right now, so there is no buy to push it past the ceiling"
        );
      }
      const why = payingInSol
        ? "this sale is priced in SOL and the ceiling is in dollars"
        : "the curve ends below the ceiling";
      return skipped(
        attack,
        "C9",
        "PriceOutsideBand",
        `the curve cannot reach it: the largest buy it can fill lands at ${dollars(crossing.highest).toFixed(8)} dollars against a ceiling of ${dollars(ceilingNow).toFixed(4)}, because ${why}`
      );
    }

    // A buy of a handful of raw units can round to nothing after the fee, so
    // the size never drops under a thousandth of the cap. Anything past the
    // crossing crosses too.
    const floor = sale.cap / 1_000n;
    const size = crossing.tokens > floor ? crossing.tokens : floor;
    console.log(
      `ceiling  : the smallest buy over it is ${crossing.tokens} raw units, landing the curve at ${dollars(crossing.price).toFixed(4)} against ${dollars(ceilingNow).toFixed(4)}; sending ${size}`
    );
    const probe = await preflightBuy({ connection, buyer: buyer.publicKey, mint, amountOut: size });
    // preflightBuy's openingRecord option replaces this: today it stops at
    // BuyerRecordMissing for a wallet that has never bought, before the band.
    console.log(
      `preflight: ${probe.error === "BuyerRecordMissing" ? "this wallet has no record yet, so the preflight stops before the band" : (probe.error ?? "it says this buy would pass")}`
    );

    let overCeiling: SizedBuy;
    try {
      overCeiling = await buyAtLeast(connection, buyer.publicKey, mint, decimals, size);
    } catch (error) {
      if (error instanceof CurveLimit) {
        return skipped(attack, "C9", "PriceOutsideBand", error.message);
      }
      throw error;
    }
    const funding = buyerFunding(payingInSol, overCeiling.amountIn, OVERHEAD_LAMPORTS);
    await fundWallets(connection, issuer, [buyer.publicKey], funding.lamports);
    if (funding.quoteTokens > 0n) {
      await fundQuoteTokens(connection, issuer, quoteMint, view.quoteProgram, quoteDecimals, [
        { wallet: buyer.publicKey, amount: funding.quoteTokens },
      ]);
    }
    return mustRefuse(attack, "C9", "PriceOutsideBand", overCeiling.transaction, [buyer]);
  };

  /**
   * The smallest buy that breaks this wallet's cap: its room plus one raw
   * unit, sized in tokens. Or the plain reason no such buy exists here: the
   * curve has fewer tokens left than that, or Meteora's quote says it cannot
   * fill it. A node that fails twice ends the run instead.
   */
  const crossTheCap = async (
    buyer: Keypair,
    room: bigint
  ): Promise<{ buy: SizedBuy } | { skip: string }> => {
    const now = await getSale(connection, mint);
    const sold = (now ?? sale).totalNetBought;
    const size = overCapSize(room, curveTokens > sold ? curveTokens - sold : 0n);
    if ("skip" in size) {
      return size;
    }
    try {
      return { buy: await buyAtLeast(connection, buyer.publicKey, mint, decimals, size.tokens) };
    } catch (error) {
      if (error instanceof CurveLimit) {
        return { skip: error.message };
      }
      throw error;
    }
  };

  const capAttack = async (
    attack: string,
    expected: PanguErrorName,
    buyer: Keypair,
    room: bigint,
    change: (transaction: Transaction) => { transaction: Transaction; signers: Signer[] } = (
      transaction
    ) => ({ transaction, signers: [] })
  ): Promise<AttackReport> => {
    const crossing = await crossTheCap(buyer, room);
    if ("skip" in crossing) {
      return skipped(attack, "C3", expected, crossing.skip);
    }
    const changed = change(crossing.buy.transaction);
    return mustRefuse(attack, "C3", expected, changed.transaction, [buyer, ...changed.signers]);
  };

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
        Number(carelessFunds) + OVERHEAD_LAMPORTS
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
          { wallet: careless.publicKey, amount: carelessFunds },
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
      await capAttack("buy past the cap in one go", bandRefusal ?? "OverCap", filler, sale.cap)
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
      // Aimed straight at the cap rather than searched for. A search reads
      // every failed quote as "that size does not fit", and on a node that is
      // rate limiting it walks itself down to a fraction of the cap, which
      // would leave the two attacks below buying inside the cap instead of
      // crossing it.
      const toTheCap = await sizedBuy(
        connection,
        filler.publicKey,
        mint,
        decimals,
        sale.cap - sale.cap / 50n
      );
      await send(connection, "filling one wallet to its cap", toTheCap.transaction, [filler]);
      const held = await getBuyerRecord(connection, mint, filler.publicKey);
      console.log(
        `filled   : one wallet holds ${held?.netBought ?? 0n} of its ${sale.cap} raw unit cap`
      );

      // One raw unit past what the wallet has left, so the only thing wrong
      // with either buy is the cap.
      const room = sale.cap - (held?.netBought ?? 0n);
      reports.push(await capAttack("a second buy that crosses the cap", "OverCap", filler, room));

      const fixedOwner = await newTokenAccount(connection, filler.publicKey, mint, true);
      reports.push(
        await capAttack(
          "buy into a second token account of the same wallet",
          "OverCap",
          filler,
          room,
          (transaction) => {
            const redirected = redirectBuy(transaction, fillerAta, fixedOwner.account.publicKey);
            redirected.instructions.unshift(...fixedOwner.instructions);
            return { transaction: redirected, signers: [fixedOwner.account] };
          }
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
    if (!listMode) {
      // Open access has no approval to revoke, so the exit is proven the other
      // way round: one of the wallets that seeded this sale sells part of what
      // it holds. The hook has to let that through. A sale nobody can leave is
      // not a sale, and it is the same invariant either way.
      const seller = await seedBuyerHolding(issuer, mint);
      if (seller === null) {
        reports.push(
          skipped(
            "a seeded buyer sells part of it back to the pool",
            "C5",
            "it goes through",
            "no seeded wallet is holding anything to sell"
          )
        );
      } else {
        const exit = await sellTransaction({
          connection,
          seller: seller.wallet.publicKey,
          mint,
          amountIn: seller.held / SELL_SHARE,
        });
        reports.push(
          await mustPass(
            "a seeded buyer sells part of it back to the pool",
            "C5",
            exit.transaction,
            [seller.wallet]
          )
        );
      }
    } else if (fillerHolds > 0n) {
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
        amountIn: fillerHolds / SELL_SHARE,
      });
      reports.push(
        await mustPass("a revoked wallet sells back to the pool", "C5", exit.transaction, [
          filler,
        ])
      );
    } else {
      reports.push(
        skipped("a revoked wallet sells back to the pool", "C5", "it goes through", shut)
      );
    }

    if (price !== null && price.usable && ceiling !== null) {
      reports.push(await ceilingAttack(careless, ceiling));
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
