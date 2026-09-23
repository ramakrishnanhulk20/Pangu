// The whole life of a Pangu sale, driven only by this package.
//
// Runs against a local validator holding Meteora's real mainnet Dynamic Bonding
// Curve and DAMM v2 programs, started by scripts/wsl/fork-validator.sh. Every
// Pangu and Meteora action goes through pangu-sdk: the launch template, the pool
// and the rules in one transaction, the preflight, the buys and sells, the fee
// claims, graduation, migration and the reads. The rest is web3.js, plus
// @solana/spl-token for the ordinary token accounts a test wallet needs, plus
// Meteora's enum names for the curve parameters, which are their own input type.
//
// Covers: mode 1 access, the cap, the exit, both fee claims, graduation, a
// banded sale paid in the demo dollar where the preflight predicts both
// refusals the band can raise (the price leaving the band, and the price going
// stale), and a ceiling refused on a fresh dollar-looking token the devnet
// build does not list.
//
// Does NOT cover: the credential access mode, DAMM v2's behaviour after
// migration, and the Wormhole guardian signatures behind a Pyth price, which no
// local chain can check. The program package's own fork tests cover the first,
// and the devnet runs in docs/measurements/sdk-pyth.md cover the last.

import { strict as assert } from "node:assert";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  type Signer,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  ActivationType,
  BaseFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  TokenAuthorityOption,
  TokenDecimal,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  TOKEN_2022_PROGRAM_ID,
  approveBuyerInstruction,
  closeBuyerRecordInstruction,
  curvePriceDollars,
  dollars,
  getBuyerRecord,
  getSale,
  isSaleRunning,
  listBuyerRecords,
  openBuyerRecordInstruction,
  panguErrorFromLogs,
  priceCeiling,
  readPrice,
  saleStanding,
} from "../src/index.js";
import {
  buyTransaction,
  claimFeesTransaction,
  graduateTransaction,
  launchTemplateTransaction,
  openSaleTransaction,
  preflightBuy,
  saleProgress,
  sellTransaction,
} from "../src/dbc/index.js";
import {
  BAND_BPS,
  DEMO_DOLLAR_MINT,
  MAX_CONF_BPS,
  PRICE_FEED_ID,
  demoDollarAuthority,
  readManifest,
  type SaleName,
} from "./fork-price.js";

const RPC_URL = "http://127.0.0.1:8899";
/**
 * The banded sales cap each wallet at half the curve. The program refuses a cap
 * at or above the whole curve, so walking the price to the ceiling takes more
 * than one wallet, each held under the cap.
 */
const BANDED_CAP_BPS = 5_000;
const BANDED_BUYERS = 3;
const connection = new Connection(RPC_URL, "confirmed");

const measurements: { action: string; bytes: number; units: number }[] = [];

function step(name: string): void {
  console.log(`\n== ${name}`);
}

async function airdrop(address: PublicKey, sol: number): Promise<void> {
  const signature = await connection.requestAirdrop(address, sol * LAMPORTS_PER_SOL);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
}

async function logsOf(signature: string): Promise<string[]> {
  const detail = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 1,
  });
  return detail?.meta?.logMessages ?? [];
}

function measure(transaction: Transaction): number {
  const message = transaction.compileMessage();
  return message.serialize().length + 1 + 64 * message.header.numRequiredSignatures;
}

async function send(
  action: string,
  transaction: Transaction,
  signers: Signer[]
): Promise<string> {
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash("confirmed")
  ).blockhash;
  transaction.feePayer = transaction.feePayer ?? signers[0]!.publicKey;
  const bytes = measure(transaction);
  transaction.sign(...signers);

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const latest = await connection.getLatestBlockhash();
  const result = await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed"
  );
  if (result.value.err !== null) {
    throw new Error(
      `${action} failed: ${JSON.stringify(result.value.err)}\n${(await logsOf(signature)).join("\n")}`
    );
  }
  const detail = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 1,
  });
  const units = detail?.meta?.computeUnitsConsumed ?? 0;
  measurements.push({ action, bytes, units });
  console.log(`   ${action}: ${bytes} bytes, ${units} compute units`);
  return signature;
}

/** Sends something that must be refused, and reports Pangu's own error name. */
async function refusal(
  action: string,
  transaction: Transaction,
  signers: Signer[]
): Promise<string> {
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash("confirmed")
  ).blockhash;
  transaction.feePayer = transaction.feePayer ?? signers[0]!.publicKey;
  transaction.sign(...signers);

  let logs: string[] = [];
  try {
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    const latest = await connection.getLatestBlockhash();
    const result = await connection.confirmTransaction(
      { signature, ...latest },
      "confirmed"
    );
    if (result.value.err === null) {
      throw new Error(`${action} was expected to fail, and it went through`);
    }
    logs = await logsOf(signature);
  } catch (error) {
    const carried = (error as { logs?: string[] | null }).logs ?? undefined;
    if (carried === undefined) {
      const getLogs = (error as { getLogs?: (c: Connection) => Promise<string[]> })
        .getLogs;
      logs =
        typeof getLogs === "function" ? ((await getLogs(connection)) ?? []) : [];
      if (logs.length === 0) {
        throw error;
      }
    } else {
      logs = carried;
    }
  }

  const found = panguErrorFromLogs(logs);
  if (found === null) {
    throw new Error(`${action} failed, but not with a Pangu error:\n${logs.join("\n")}`);
  }
  console.log(`   ${action}: refused with ${found.name}`);
  return found.name;
}

async function tokenBalance(account: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(account);
  return info === null ? 0n : info.data.readBigUInt64LE(64);
}

function baseAta(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
}

/** The curve both sales use, with only the paying token's decimals changing. */
function curveFor(quoteDecimal: TokenDecimal, threshold: number) {
  return {
    token: {
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: quoteDecimal,
      tokenAuthorityOption: TokenAuthorityOption.CreatorUpdateAuthority,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 25,
          endingFeeBps: 25,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Disabled,
        poolFeeBps: 25,
        baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
      },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 100,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold: threshold,
  } as never;
}

/**
 * The largest buy this wallet can make, at most `wanted` and at most its cap.
 *
 * Two things shrink a buy: the room left under the cap, and the tokens left on
 * the curve. Meteora's quote refuses an exact-in swap larger than the curve can
 * fill, so the refusal is the signal to halve and try again. That is how the
 * last buyer lands exactly on the graduation threshold.
 */
async function buildBuy(
  wallet: PublicKey,
  mint: PublicKey,
  wanted: bigint,
  capRoom: bigint
): Promise<Awaited<ReturnType<typeof buyTransaction>>> {
  const fits = async (amountIn: bigint) => {
    try {
      const built = await buyTransaction({ connection, buyer: wallet, mint, amountIn });
      return built.expectedAmountOut <= capRoom ? built : null;
    } catch {
      return null;
    }
  };

  const straight = await fits(wanted);
  if (straight !== null) {
    return straight;
  }

  let low = 0n;
  let high = wanted;
  let best: Awaited<ReturnType<typeof buyTransaction>> | null = null;
  while (high - low > 10_000n) {
    const middle = (low + high) / 2n;
    const built = await fits(middle);
    if (built === null) {
      high = middle;
    } else {
      low = middle;
      best = built;
    }
  }
  if (best === null) {
    throw new Error("no buy of any size fits this wallet's cap and the curve");
  }
  return best;
}

/** Waits for the chain's own clock to pass a moment, which is how a price ages. */
async function waitUntilUnix(target: number): Promise<void> {
  while (Math.floor(Date.now() / 1000) < target) {
    await new Promise((wake) => setTimeout(wake, 2_000));
  }
}

async function main(): Promise<void> {
  const partner = Keypair.generate();
  const creator = Keypair.generate();
  const buyer = Keypair.generate();
  const outsider = Keypair.generate();
  const stranger = Keypair.generate();
  for (const wallet of [partner, creator, buyer, outsider, stranger]) {
    await airdrop(wallet.publicKey, 200);
  }

  step("a. the partner opens a launch template");
  const template = await launchTemplateTransaction({
    connection,
    partner: partner.publicKey,
    quoteMint: NATIVE_MINT,
    curve: curveFor(TokenDecimal.NINE, 5),
  });
  await send("launch template", template.transaction, [partner, template.config]);
  console.log(`   config ${template.config.publicKey.toBase58()}`);

  step("b. the creator opens the pool and the sale's rules in one transaction");
  const opened = await openSaleTransaction({
    connection,
    creator: creator.publicKey,
    config: template.config.publicKey,
    name: "Pangu SDK Share",
    symbol: "PSS",
    uri: "https://example.invalid/pss.json",
    sale: { capShareBps: 1_000, accessMode: 1 },
  });
  assert.ok(opened.bytes <= 1232, "the pool and rules do not fit in one transaction");
  await send("pool plus sale rules", opened.transaction, [creator, opened.baseMint]);
  const mint = opened.baseMint.publicKey;
  const sale = await getSale(connection, mint);
  assert.ok(sale !== null, "the rules were not written");
  assert.equal(sale.pool.toBase58(), opened.pool.toBase58());
  assert.equal(sale.issuer.toBase58(), creator.publicKey.toBase58());
  console.log(`   mint ${mint.toBase58()}, cap ${sale.cap} raw units`);

  step("c. the preflight says no record, then not approved");
  const noRecord = await preflightBuy({
    connection,
    buyer: buyer.publicKey,
    mint,
    amountOut: 1_000n,
  });
  assert.equal(noRecord.error, "BuyerRecordMissing");
  console.log(`   ${noRecord.error}: ${noRecord.reason}`);

  await send(
    "open buyer record",
    new Transaction().add(
      openBuyerRecordInstruction({ wallet: buyer.publicKey, mint })
    ),
    [buyer]
  );
  const notApproved = await preflightBuy({
    connection,
    buyer: buyer.publicKey,
    mint,
    amountOut: 1_000n,
  });
  assert.equal(notApproved.error, "NotApproved");
  console.log(`   ${notApproved.error}: ${notApproved.reason}`);

  step("d. the issuer approves the buyer and the buy goes through");
  await send(
    "approve buyer",
    new Transaction().add(
      approveBuyerInstruction({
        issuer: creator.publicKey,
        mint,
        wallet: buyer.publicKey,
      })
    ),
    [creator]
  );

  let spend = BigInt(LAMPORTS_PER_SOL) / 5n;
  let buy = await buyTransaction({
    connection,
    buyer: buyer.publicKey,
    mint,
    amountIn: spend,
  });
  while (buy.expectedAmountOut > sale.cap / 2n && spend > 1_000_000n) {
    spend /= 2n;
    buy = await buyTransaction({
      connection,
      buyer: buyer.publicKey,
      mint,
      amountIn: spend,
    });
  }
  const ready = await preflightBuy({
    connection,
    buyer: buyer.publicKey,
    mint,
    amountOut: buy.expectedAmountOut,
  });
  assert.equal(ready.ok, true, `the preflight refused a good buy: ${ready.reason}`);
  await send("first buy", buy.transaction, [buyer]);

  const held = await tokenBalance(baseAta(mint, buyer.publicKey));
  assert.equal(held, buy.expectedAmountOut, "the quote and the chain disagree");
  const record = await getBuyerRecord(connection, mint, buyer.publicKey);
  assert.equal(record?.netBought, held);

  step("e. the preflight predicts the cap, and the chain agrees");
  const roomLeft = sale.cap - held;
  const overCap = await preflightBuy({
    connection,
    buyer: buyer.publicKey,
    mint,
    amountOut: roomLeft + 1n,
  });
  assert.equal(overCap.error, "OverCap");
  assert.equal(overCap.capRoom, roomLeft);
  console.log(
    `   predicted OverCap with ${overCap.capRoom} raw units of room left: ${overCap.reason}`
  );

  const tooMuch = await buyTransaction({
    connection,
    buyer: buyer.publicKey,
    mint,
    amountIn: spend * 8n,
  });
  assert.ok(tooMuch.expectedAmountOut > roomLeft, "the second buy was inside the cap");
  assert.equal(await refusal("the buy past the cap", tooMuch.transaction, [buyer]), "OverCap");

  step("f. the holder sells back to the pool");
  const sell = await sellTransaction({
    connection,
    seller: buyer.publicKey,
    mint,
    amountIn: held / 4n,
  });
  await send("sell", sell.transaction, [buyer]);
  const afterSell = await getBuyerRecord(connection, mint, buyer.publicKey);
  assert.equal(afterSell?.netBought, held - held / 4n);

  step("g. the partner and the creator claim their fees");
  for (const who of ["partner", "creator"] as const) {
    const claim = await claimFeesTransaction({ connection, who, mint });
    const signer = who === "partner" ? partner : creator;
    assert.equal(claim.claimer.toBase58(), signer.publicKey.toBase58());
    await send(`${who} fee claim`, claim.transaction, [signer]);
    assert.equal(
      await tokenBalance(baseAta(mint, signer.publicKey)),
      0n,
      "a fee claim moved the sale token"
    );
  }

  step("h. fresh approved buyers fill the curve");
  const buyers: Keypair[] = [];
  for (let round = 0; round < 30; round += 1) {
    const progress = await saleProgress(connection, mint);
    if (progress.graduated) {
      break;
    }
    const next = Keypair.generate();
    buyers.push(next);
    await airdrop(next.publicKey, 200);
    await send(
      `approve buyer ${round + 1}`,
      new Transaction().add(
        approveBuyerInstruction({
          issuer: creator.publicKey,
          mint,
          wallet: next.publicKey,
        })
      ),
      [creator]
    );

    // Enough to finish the curve, fees included, or half a SOL, whichever is
    // smaller. buildBuy shrinks it to what the cap and the curve really allow.
    const left = progress.threshold - progress.quoteRaised;
    const wanted =
      left < BigInt(LAMPORTS_PER_SOL) / 2n
        ? (left * 10_100n) / 10_000n + 100_000n
        : BigInt(LAMPORTS_PER_SOL) / 2n;
    // The tokens run out before the paying side does, so the buy that finishes
    // a curve is a partial fill: DBC takes what is left and leaves the rest.
    const finishing = left < BigInt(LAMPORTS_PER_SOL) / 2n;
    const nextBuy = finishing
      ? await buyTransaction({
          connection,
          buyer: next.publicKey,
          mint,
          amountIn: wanted,
          fill: "partial",
        })
      : await buildBuy(next.publicKey, mint, wanted, sale.cap);
    await send(
      finishing ? "the buy that fills the curve" : `later buy ${round + 1}`,
      nextBuy.transaction,
      [next]
    );
  }

  const filled = await saleProgress(connection, mint);
  assert.equal(filled.graduated, true, "the curve never filled");
  assert.equal(
    await isSaleRunning(connection, mint),
    false,
    "DBC left the hook on the mint"
  );
  console.log(
    `   raised ${filled.quoteRaised} of ${filled.threshold} lamports, ${Math.round(filled.percent * 100)} percent`
  );

  step("i. anyone migrates the graduated pool to DAMM v2");
  const graduate = await graduateTransaction({
    connection,
    payer: stranger.publicKey,
    mint,
  });
  await send("migrate to DAMM v2", graduate.transaction, [stranger, ...graduate.signers]);
  const migrated = await saleProgress(connection, mint);
  assert.ok(migrated.dammPool !== null, "the DAMM v2 pool was not created");
  console.log(`   DAMM v2 pool ${migrated.dammPool.toBase58()}`);

  step("j. the sale's standing, from the records themselves");
  const finalSale = await getSale(connection, mint);
  const standing = saleStanding(finalSale!, await listBuyerRecords(connection, mint));
  assert.ok(standing.largestNetBought <= finalSale!.cap, "a wallet passed the cap");
  console.log(
    `   ${standing.buyers} buyers, largest holds ${(standing.largestShare * 100).toFixed(2)} percent of what is held, cap share ${(standing.capShare * 100).toFixed(2)} percent`
  );

  step("k. a buyer closes their record and gets the rent back");
  const before = await connection.getBalance(buyer.publicKey);
  await send(
    "close buyer record",
    new Transaction().add(
      closeBuyerRecordInstruction({ wallet: buyer.publicKey, mint })
    ),
    [buyer]
  );
  assert.equal(await getBuyerRecord(connection, mint, buyer.publicKey), null);
  assert.ok((await connection.getBalance(buyer.publicKey)) > before);

  await bandedSale(partner, creator, buyer);
  await unlistedDollarRefused(partner, creator);

  console.log("\n== what each action cost");
  console.log("| Action | Bytes | Compute units |");
  console.log("|---|---|---|");
  for (const entry of measurements) {
    console.log(`| ${entry.action} | ${entry.bytes} | ${entry.units} |`);
  }
}

/**
 * A banded sale on the fork, where the preflight has to predict both refusals
 * the band can raise before anything is signed: the price leaving the band, and
 * the price going stale, which is what a shut stock market looks like from
 * inside the chain.
 */
async function bandedSale(
  partner: Keypair,
  creator: Keypair,
  buyer: Keypair
): Promise<void> {
  const manifest = readManifest();
  const quoteDecimals = 6;

  step("l. the demo dollar the devnet build lists, and a banded template");
  // The devnet build sets a ceiling only on its listed dollars, so the banded
  // sales pay in the demo dollar that fork-validator.sh planted at genesis.
  const quoteMint = DEMO_DOLLAR_MINT;
  const dollarAuthority = demoDollarAuthority();
  const planted = await getMint(connection, quoteMint, "confirmed", TOKEN_PROGRAM_ID);
  assert.equal(planted.decimals, quoteDecimals, "the planted demo dollar has other decimals");
  assert.ok(
    planted.mintAuthority?.equals(dollarAuthority.publicKey),
    "the planted demo dollar names another mint authority"
  );
  assert.equal(planted.freezeAuthority, null, "the planted demo dollar can be frozen");

  const wallets = [buyer];
  for (let extra = 1; extra < BANDED_BUYERS; extra += 1) {
    const wallet = Keypair.generate();
    await airdrop(wallet.publicKey, 200);
    wallets.push(wallet);
  }
  for (const [index, wallet] of wallets.entries()) {
    const walletQuote = getAssociatedTokenAddressSync(
      quoteMint,
      wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    await send(
      `fund banded buyer ${index + 1} with dollars`,
      new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          partner.publicKey,
          walletQuote,
          wallet.publicKey,
          quoteMint,
          TOKEN_PROGRAM_ID
        ),
        createMintToInstruction(
          quoteMint,
          walletQuote,
          dollarAuthority.publicKey,
          10_000_000n * 10n ** BigInt(quoteDecimals),
          [],
          TOKEN_PROGRAM_ID
        )
      ),
      [partner, dollarAuthority]
    );
  }

  const template = await launchTemplateTransaction({
    connection,
    partner: partner.publicKey,
    quoteMint,
    curve: curveFor(TokenDecimal.SIX, 500_000),
  });
  await send("banded launch template", template.transaction, [
    partner,
    template.config,
  ]);

  // The shard is the only thing that differs between these sales: one feed,
  // three accounts, so three stock prices can exist on one chain at once. The
  // price account is not passed, it is derived from the shard and the feed id.
  const bandOf = (name: SaleName) => ({
    bps: BAND_BPS,
    priceFeedId: PRICE_FEED_ID,
    shard: manifest[name].shard,
    maxPriceAgeSecs: manifest[name].maxPriceAgeSecs,
    maxConfBps: MAX_CONF_BPS,
  });

  step("m. the banded sale, and a price that has to stay under the ceiling");
  const opened = await openSaleTransaction({
    connection,
    creator: creator.publicKey,
    config: template.config.publicKey,
    name: "Pangu Banded",
    symbol: "PBD",
    uri: "https://example.invalid/pbd.json",
    sale: { capShareBps: BANDED_CAP_BPS, accessMode: 0, band: bandOf("low") },
  });
  await send("banded pool plus rules", opened.transaction, [
    creator,
    opened.baseMint,
  ]);
  const mint = opened.baseMint.publicKey;
  const sale = (await getSale(connection, mint))!;
  assert.equal(sale.hasBand, true);
  assert.equal(sale.priceAccount.toBase58(), manifest.low.priceAccount);
  assert.equal(sale.priceShard, manifest.low.shard);
  assert.equal(sale.maxPriceAgeSecs, manifest.low.maxPriceAgeSecs);
  assert.equal(sale.maxConfBps, MAX_CONF_BPS);

  for (const [index, wallet] of wallets.entries()) {
    await send(
      `open banded buyer ${index + 1}'s record`,
      new Transaction().add(
        openBuyerRecordInstruction({ wallet: wallet.publicKey, mint })
      ),
      [wallet]
    );
  }

  const price = await readPrice(connection, sale);
  assert.equal(price.usable, true, `the price is not usable: ${price.reason}`);
  assert.equal(price.price.toString(), manifest.low.stockPrice);
  console.log(
    `   stock ${price.priceDollars.toFixed(4)} dollars, ceiling ${dollars(priceCeiling(sale, price.price)).toFixed(4)}, published ${price.ageSecs} seconds ago, confidence ${price.confBps} basis points`
  );

  step("n. buying until the preflight says the next buy leaves the band");
  const stepIn = 20_000n * 10n ** BigInt(quoteDecimals);
  let predicted = false;
  // Each round goes to the first wallet with room under the cap for the whole
  // step, so the only refusal that can end the walk is the band's.
  const roomOf = async (wallet: Keypair): Promise<bigint> =>
    sale.cap - ((await getBuyerRecord(connection, mint, wallet.publicKey))?.netBought ?? 0n);
  const nextBandedBuy = async () => {
    for (const wallet of wallets) {
      const room = await roomOf(wallet);
      if (room <= 0n) {
        continue;
      }
      try {
        const built = await buyTransaction({
          connection,
          buyer: wallet.publicKey,
          mint,
          amountIn: stepIn,
        });
        if (built.expectedAmountOut <= room) {
          return { wallet, built };
        }
      } catch {
        // The curve cannot fill the whole step; buildBuy below shrinks it.
      }
    }
    let widest = wallets[0]!;
    for (const wallet of wallets) {
      if ((await roomOf(wallet)) > (await roomOf(widest))) {
        widest = wallet;
      }
    }
    return {
      wallet: widest,
      built: await buildBuy(widest.publicKey, mint, stepIn, await roomOf(widest)),
    };
  };
  for (let round = 0; round < 40 && !predicted; round += 1) {
    const { wallet, built: next } = await nextBandedBuy();
    const check = await preflightBuy({
      connection,
      buyer: wallet.publicKey,
      mint,
      amountOut: next.expectedAmountOut,
    });
    if (check.error === "PriceOutsideBand") {
      predicted = true;
      console.log(
        `   round ${round + 1}: predicted PriceOutsideBand, curve would land at ${dollars(check.curvePrice!).toFixed(4)} against a ceiling of ${dollars(check.ceiling!).toFixed(4)}`
      );
      assert.equal(
        await refusal("the buy past the ceiling", next.transaction, [wallet]),
        "PriceOutsideBand"
      );
      break;
    }
    assert.equal(check.ok, true, `the preflight refused for ${check.error}`);
    await send(`banded buy ${round + 1}`, next.transaction, [wallet]);
  }
  assert.equal(predicted, true, "the curve never reached the ceiling");
  for (const wallet of wallets) {
    assert.ok((await roomOf(wallet)) >= 0n, "a banded buyer passed the cap");
  }

  const view = await getSale(connection, mint);
  const pool = await connection.getAccountInfo(view!.pool);
  const sqrtPrice =
    pool!.data.readBigUInt64LE(280) + (pool!.data.readBigUInt64LE(288) << 64n);
  const nowPrice = curvePriceDollars(sqrtPrice, view!.baseDecimals, view!.quoteDecimals);
  const nowCeiling = priceCeiling(view!, (await readPrice(connection, view!)).price);
  assert.ok(nowPrice <= nowCeiling, "the curve was allowed past the ceiling");
  console.log(
    `   curve sits at ${dollars(nowPrice).toFixed(4)} dollars, ceiling ${dollars(nowCeiling).toFixed(4)}`
  );

  step("o. a sale whose price nobody keeps fresh, which is a shut market");
  const shut = await openSaleTransaction({
    connection,
    creator: creator.publicKey,
    config: template.config.publicKey,
    name: "Pangu Shut",
    symbol: "PSH",
    uri: "https://example.invalid/psh.json",
    sale: { capShareBps: BANDED_CAP_BPS, accessMode: 0, band: bandOf("aging") },
  });
  await send("shut market pool plus rules", shut.transaction, [
    creator,
    shut.baseMint,
  ]);
  await send(
    "open the buyer's record, shut sale",
    new Transaction().add(
      openBuyerRecordInstruction({
        wallet: buyer.publicKey,
        mint: shut.baseMint.publicKey,
      })
    ),
    [buyer]
  );

  // Nobody has refreshed this sale's price since before the chain started, and
  // on a local chain nobody can: Pyth's receiver program is not here. That is
  // exactly what a shut stock market looks like from inside the program, so the
  // test waits for the account to age past this sale's own limit.
  await waitUntilUnix(
    manifest.aging.publishTime + manifest.aging.maxPriceAgeSecs + 5
  );

  const shutSale = (await getSale(connection, shut.baseMint.publicKey))!;
  const shutPrice = await readPrice(connection, shutSale);
  assert.equal(shutPrice.usable, false);
  assert.equal(shutPrice.error, "PriceStale");
  // The price itself is still perfectly readable. Nothing is wrong with it
  // except its age, and that alone shuts every buy.
  assert.ok(shutPrice.price > 0n, "the stale sale lost its price");
  assert.ok(
    shutPrice.ageSecs > shutSale.maxPriceAgeSecs,
    "the price had not aged past the sale's limit yet"
  );

  const closed = await preflightBuy({
    connection,
    buyer: buyer.publicKey,
    mint: shut.baseMint.publicKey,
    amountOut: 1_000_000n,
  });
  assert.equal(closed.error, "PriceStale");
  console.log(
    `   predicted PriceStale at ${shutPrice.priceDollars.toFixed(4)} dollars published ${Math.floor(shutPrice.ageSecs / 60)} minutes ago, against a limit of ${Math.floor(shutSale.maxPriceAgeSecs / 60)} minutes: ${closed.reason}`
  );

  // And the chain agrees, which is the point of sending it.
  const refused = await buyTransaction({
    connection,
    buyer: buyer.publicKey,
    mint: shut.baseMint.publicKey,
    amountIn: 1_000n * 10n ** BigInt(quoteDecimals),
  });
  assert.equal(
    await refusal("a buy against a stale price", refused.transaction, [buyer]),
    "PriceStale"
  );

  // The sale next door is untouched: each one names its own account and its own
  // limit, so one going stale says nothing about the other.
  assert.equal((await readPrice(connection, view!)).usable, true);
}

/**
 * A ceiling on a paying token that looks exactly like a dollar and is not on
 * the devnet build's list: six decimals, no freeze authority, a fresh address.
 * The template lands, because Meteora does not care what it is paid in, and the
 * pool and the rules are refused together in their one transaction.
 */
async function unlistedDollarRefused(partner: Keypair, creator: Keypair): Promise<void> {
  const manifest = readManifest();

  step("p. a ceiling on a fresh dollar-looking token is refused");
  const lookalike = Keypair.generate();
  await send(
    "create a dollar-looking token",
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: partner.publicKey,
        newAccountPubkey: lookalike.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE),
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        lookalike.publicKey,
        6,
        partner.publicKey,
        null,
        TOKEN_PROGRAM_ID
      )
    ),
    [partner, lookalike]
  );

  const template = await launchTemplateTransaction({
    connection,
    partner: partner.publicKey,
    quoteMint: lookalike.publicKey,
    curve: curveFor(TokenDecimal.SIX, 500_000),
  });
  await send("template on the unlisted token", template.transaction, [
    partner,
    template.config,
  ]);

  const opened = await openSaleTransaction({
    connection,
    creator: creator.publicKey,
    config: template.config.publicKey,
    name: "Pangu Unlisted",
    symbol: "PUNL",
    uri: "https://example.invalid/punl.json",
    sale: {
      capShareBps: BANDED_CAP_BPS,
      accessMode: 0,
      band: {
        bps: BAND_BPS,
        priceFeedId: PRICE_FEED_ID,
        shard: manifest.low.shard,
        maxPriceAgeSecs: manifest.low.maxPriceAgeSecs,
        maxConfBps: MAX_CONF_BPS,
      },
    },
  });
  assert.equal(
    await refusal("a ceiling on an unlisted paying token", opened.transaction, [
      creator,
      opened.baseMint,
    ]),
    "BandNeedsDollarQuote"
  );
  assert.equal(
    await connection.getAccountInfo(opened.pool),
    null,
    "the refused transaction left a pool behind"
  );
  assert.equal(
    await getSale(connection, opened.baseMint.publicKey),
    null,
    "the refused transaction left sale rules behind"
  );
}

main()
  .then(() => {
    console.log("\nSDK-FORK-OK");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
