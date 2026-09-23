// The mainnet rehearsal's sales: the mainnet build of Pangu, deployed onto a
// forked copy of mainnet by deploy-mainnet.sh --rehearse, driven only through
// this package, paying in the real USDC and AAPLx mints.
//
// Covers:
//   (a) sales paid in USDC with a five percent ceiling on Apple's real Pyth
//       feed id and a fourteen day offering: a buy under the cap, a buy over it
//       refused, buying until the ceiling refuses, a sell back, and a second
//       curve under the same Apple price bought to graduation and migrated to
//       DAMM v2;
//   (b) a sale paid in AAPLx with no ceiling, a ceiling on it refused with
//       BandNeedsDollarQuote, a buy and a sell;
//   (c) a ceiling on the demo dollar refused, because the mainnet build does
//       not list it.
//
// Does NOT cover: a live Pyth price. Apple's price is written into its account
// before genesis, in the receiver's layout, and never moves, so the guardian
// signatures and the price moving mid-sale are not exercised; the devnet runs
// in docs/measurements/sdk-pyth.md cover a real update. Nor anything USDC's or
// AAPLx's issuers could do with their own powers over their tokens.

import { strict as assert } from "node:assert";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  DBC_PROGRAM_ID,
  PANGU_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  curvePriceDollars,
  dollarMints,
  dollars,
  getBuyerRecord,
  getSale,
  isSaleRunning,
  listBuyerRecords,
  priceCeiling,
  readPrice,
  saleStanding,
} from "../src/index.js";
import {
  buyTransaction,
  graduateTransaction,
  launchTemplateTransaction,
  openSaleTransaction,
  preflightBuy,
  saleProgress,
  sellTransaction,
} from "../src/dbc/index.js";
import {
  AAPLX_DECIMALS,
  AAPLX_MINT,
  AAPLX_TOKEN_BADGE,
  ACCOUNTS_DIR,
  APPLE_FEED_ID,
  APPLE_SHARD,
  BAND_BPS,
  DEMO_DOLLAR_MINT,
  FORK_ACCOUNTS_DIR,
  MAX_CONF_BPS,
  MAX_PRICE_AGE_SECS,
  OFFERING_SECS,
  USDC_DECIMALS,
  USDC_MINT,
  USDC_PER_WALLET,
  aaplxCurve,
  airdrop,
  chainNow,
  connection,
  loadWallet,
  printMeasurements,
  readManifest,
  refusal,
  refusedLogs,
  send,
  step,
  tokenBalance,
  usdcCurve,
} from "./rehearsal-setup.js";

/** Small enough that the cap binds well below the ceiling. */
const CROSSING_CAP_BPS = 500;
const GRADUATING_CAP_BPS = 2_000;
const USDC = 10n ** BigInt(USDC_DECIMALS);

const APPLE_BAND = {
  bps: BAND_BPS,
  priceFeedId: APPLE_FEED_ID,
  shard: APPLE_SHARD,
  maxPriceAgeSecs: MAX_PRICE_AGE_SECS,
  maxConfBps: MAX_CONF_BPS,
};

type Built = Awaited<ReturnType<typeof buyTransaction>>;

function baseAta(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
}

function usdcAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(USDC_MINT, owner, false, TOKEN_PROGRAM_ID);
}

async function netBought(mint: PublicKey, wallet: PublicKey): Promise<bigint> {
  return (await getBuyerRecord(connection, mint, wallet))?.netBought ?? 0n;
}

/**
 * The largest buy this wallet can make, at most `wanted` and at most `room`.
 * Meteora refuses an exact-in swap bigger than the curve can fill, so a refusal
 * is the signal to halve and try again.
 */
async function buildBuy(
  wallet: PublicKey,
  mint: PublicKey,
  wanted: bigint,
  room: bigint
): Promise<Built | null> {
  const fits = async (amountIn: bigint): Promise<Built | null> => {
    try {
      const built = await buyTransaction({ connection, buyer: wallet, mint, amountIn });
      return built.expectedAmountOut <= room ? built : null;
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
  let best: Built | null = null;
  while (high - low > USDC / 100n) {
    const middle = (low + high) / 2n;
    const built = await fits(middle);
    if (built === null) {
      high = middle;
    } else {
      low = middle;
      best = built;
    }
  }
  return best;
}

/** Adds DBC's badge for the paying token to the pool instruction the SDK built. */
function withBadge(transaction: Transaction, badge: PublicKey): Transaction {
  const pool = transaction.instructions.find((instruction) =>
    instruction.programId.equals(DBC_PROGRAM_ID)
  );
  assert.ok(pool !== undefined, "the transaction has no DBC instruction");
  pool.keys.push({ pubkey: badge, isSigner: false, isWritable: false });
  return transaction;
}

async function curvePriceNow(mint: PublicKey): Promise<bigint> {
  const sale = (await getSale(connection, mint))!;
  const pool = await connection.getAccountInfo(sale.pool);
  const sqrtPrice = pool!.data.readBigUInt64LE(280) + (pool!.data.readBigUInt64LE(288) << 64n);
  return curvePriceDollars(sqrtPrice, sale.baseDecimals, sale.quoteDecimals);
}

async function main(): Promise<void> {
  const program = await connection.getAccountInfo(PANGU_PROGRAM_ID);
  assert.ok(program?.executable, "Pangu is not deployed on the fork");
  const manifest = readManifest();

  const partner = Keypair.generate();
  const creator = Keypair.generate();
  const stranger = Keypair.generate();
  for (const wallet of [partner, creator, stranger]) {
    await airdrop(wallet.publicKey, 100);
  }
  const buyers = manifest.usdcWallets.map((file) => loadWallet(ACCOUNTS_DIR, file));
  for (const wallet of buyers) {
    await airdrop(wallet.publicKey, 20);
    assert.equal(
      await tokenBalance(usdcAta(wallet.publicKey)),
      USDC_PER_WALLET * USDC,
      "a rehearsal wallet was not handed its USDC at genesis"
    );
  }

  await usdcCrossingSale(partner, creator, buyers);
  await usdcGraduatingSale(partner, creator, stranger, buyers);
  await aaplxSale();
  await demoDollarRefused(partner, creator);

  printMeasurements("what each action cost on the fork");
}

async function usdcCrossingSale(
  partner: Keypair,
  creator: Keypair,
  buyers: Keypair[]
): Promise<void> {
  const manifest = readManifest();
  step("a1. the mainnet build lists USDC and nothing else");
  const listed = dollarMints("mainnet");
  assert.equal(listed.length, 1);
  assert.ok(listed[0]!.equals(USDC_MINT), "the SDK's mainnet list is not USDC");

  step("a2. a USDC template and a sale with a 5 percent ceiling on Apple and a 14 day offering");
  const template = await launchTemplateTransaction({
    connection,
    partner: partner.publicKey,
    quoteMint: USDC_MINT,
    curve: usdcCurve("crossing"),
  });
  await send("USDC launch template", template.transaction, [partner, template.config]);

  const endsAt = (await chainNow()) + OFFERING_SECS;
  const opened = await openSaleTransaction({
    connection,
    creator: creator.publicKey,
    config: template.config.publicKey,
    name: "Pangu Apple Rehearsal",
    symbol: "PAAPL",
    uri: "https://example.invalid/paapl.json",
    sale: { capShareBps: CROSSING_CAP_BPS, accessMode: 0, band: APPLE_BAND, endsAt },
  });
  await send("USDC pool plus rules with a ceiling", opened.transaction, [creator, opened.baseMint]);
  const mint = opened.baseMint.publicKey;
  const sale = (await getSale(connection, mint))!;
  assert.ok(sale.quoteMint?.equals(USDC_MINT), "the rules do not record USDC as the paying token");
  assert.equal(sale.hasBand, true);
  assert.equal(sale.bandBps, BAND_BPS);
  assert.equal(sale.priceAccount.toBase58(), manifest.priceAccount);
  assert.equal(sale.priceFeedId, APPLE_FEED_ID);
  assert.equal(sale.endsAt, endsAt);

  const price = await readPrice(connection, sale);
  assert.equal(price.usable, true, `Apple's price is not usable: ${price.reason}`);
  assert.equal(price.price.toString(), manifest.stockPrice);
  console.log(
    `   mint ${mint.toBase58()}, cap ${sale.cap} raw units, offering ends ${new Date(endsAt * 1000).toISOString()}`
  );
  console.log(
    `   Apple ${price.priceDollars.toFixed(5)} dollars on shard ${sale.priceShard}, ceiling ${dollars(priceCeiling(sale, price.price)).toFixed(6)}, confidence ${price.confBps} basis points`
  );

  step("a3. a buy under the cap");
  const first = buyers[0]!;
  const usdcBefore = await tokenBalance(usdcAta(first.publicKey));
  const small = await buyTransaction({
    connection,
    buyer: first.publicKey,
    mint,
    amountIn: 100n * USDC,
  });
  assert.ok(small.expectedAmountOut < sale.cap, "a 100 USDC buy is already over the cap");
  const ready = await preflightBuy({
    connection,
    openingRecord: true,
    buyer: first.publicKey,
    mint,
    amountOut: small.expectedAmountOut,
  });
  assert.equal(ready.ok, true, `the preflight refused a good buy: ${ready.reason}`);
  await send("buy under the cap, USDC", small.transaction, [first]);
  const held = await tokenBalance(baseAta(mint, first.publicKey));
  assert.equal(held, small.expectedAmountOut, "the quote and the chain disagree");
  assert.equal(await netBought(mint, first.publicKey), held);
  assert.equal(await tokenBalance(usdcAta(first.publicKey)), usdcBefore - 100n * USDC);
  console.log(`   paid 100 USDC for ${held} raw units`);

  step("a4. a buy over the cap is refused");
  const room = sale.cap - held;
  let spend = 100n * USDC;
  let over: Built | null = null;
  for (let tries = 0; tries < 30 && over === null; tries += 1) {
    const built = await buyTransaction({ connection, buyer: first.publicKey, mint, amountIn: spend });
    if (built.expectedAmountOut > room) {
      over = built;
    } else {
      spend = (spend * 3n) / 2n;
    }
  }
  assert.ok(over !== null, "no buy of any size passed the cap");
  const predicted = await preflightBuy({
    connection,
    openingRecord: true,
    buyer: first.publicKey,
    mint,
    amountOut: over.expectedAmountOut,
  });
  assert.equal(predicted.error, "OverCap", `the preflight said ${predicted.error}, not OverCap`);
  assert.equal(await refusal("buy over the cap, USDC", over.transaction, [first]), "OverCap");
  console.log(`   ${Number(spend) / 1e6} USDC would have bought past the ${room} raw units of room`);

  step("a5. buying until the ceiling refuses");
  const step_ = 5_000n * USDC;
  let refused = false;
  for (let round = 0; round < 80 && !refused; round += 1) {
    let chosen: { wallet: Keypair; built: Built } | null = null;
    for (const wallet of buyers) {
      const left = sale.cap - (await netBought(mint, wallet.publicKey));
      if (left <= 0n) {
        continue;
      }
      const built = await buildBuy(wallet.publicKey, mint, step_, left);
      if (built !== null && built.expectedAmountOut > 0n) {
        chosen = { wallet, built };
        break;
      }
    }
    assert.ok(chosen !== null, "every wallet is at its cap before the ceiling was reached");
    const check = await preflightBuy({
      connection,
      openingRecord: true,
      buyer: chosen.wallet.publicKey,
      mint,
      amountOut: chosen.built.expectedAmountOut,
    });
    if (check.error === "PriceOutsideBand") {
      console.log(
        `   round ${round + 1}: the preflight says the curve would land at ${dollars(check.curvePrice!).toFixed(6)} against a ceiling of ${dollars(check.ceiling!).toFixed(6)}`
      );
      assert.equal(
        await refusal("buy past the ceiling, USDC", chosen.built.transaction, [chosen.wallet]),
        "PriceOutsideBand"
      );
      refused = true;
      break;
    }
    assert.equal(check.ok, true, `the preflight refused for ${check.error}`);
    await send(`walk to the ceiling, buy ${round + 1}`, chosen.built.transaction, [chosen.wallet]);
  }
  assert.equal(refused, true, "the curve never reached the ceiling");
  const nowPrice = await curvePriceNow(mint);
  const nowCeiling = priceCeiling(sale, (await readPrice(connection, sale)).price);
  assert.ok(nowPrice <= nowCeiling, "the curve was let past the ceiling");
  for (const wallet of buyers) {
    assert.ok((await netBought(mint, wallet.publicKey)) <= sale.cap, "a wallet passed the cap");
  }
  console.log(`   curve at ${dollars(nowPrice).toFixed(6)}, ceiling ${dollars(nowCeiling).toFixed(6)}`);

  step("a6. a holder sells back at the ceiling");
  const holding = await tokenBalance(baseAta(mint, first.publicKey));
  const usdcBeforeSell = await tokenBalance(usdcAta(first.publicKey));
  const sell = await sellTransaction({
    connection,
    seller: first.publicKey,
    mint,
    amountIn: holding / 2n,
  });
  await send("sell back, USDC", sell.transaction, [first]);
  assert.equal(await netBought(mint, first.publicKey), holding - holding / 2n);
  const usdcBack = (await tokenBalance(usdcAta(first.publicKey))) - usdcBeforeSell;
  assert.ok(usdcBack > 0n, "the sell paid nothing back");
  console.log(`   sold ${holding / 2n} raw units back for ${Number(usdcBack) / 1e6} USDC`);
}

async function usdcGraduatingSale(
  partner: Keypair,
  creator: Keypair,
  stranger: Keypair,
  buyers: Keypair[]
): Promise<void> {
  const manifest = readManifest();
  step("a7. a second USDC curve under the same Apple price and ceiling, bought to graduation");
  const template = await launchTemplateTransaction({
    connection,
    partner: partner.publicKey,
    quoteMint: USDC_MINT,
    curve: usdcCurve("graduating"),
  });
  await send("USDC launch template, graduating curve", template.transaction, [
    partner,
    template.config,
  ]);
  const endsAt = (await chainNow()) + OFFERING_SECS;
  const opened = await openSaleTransaction({
    connection,
    creator: creator.publicKey,
    config: template.config.publicKey,
    name: "Pangu Apple Graduation",
    symbol: "PAAPG",
    uri: "https://example.invalid/paapg.json",
    sale: { capShareBps: GRADUATING_CAP_BPS, accessMode: 0, band: APPLE_BAND, endsAt },
  });
  await send("USDC pool plus rules, graduating curve", opened.transaction, [
    creator,
    opened.baseMint,
  ]);
  const mint = opened.baseMint.publicKey;
  const sale = (await getSale(connection, mint))!;
  assert.equal(sale.priceAccount.toBase58(), manifest.priceAccount, "the two sales read different prices");
  assert.equal(sale.endsAt, endsAt);

  const stepIn = 20_000n * USDC;
  for (let round = 0; round < 40; round += 1) {
    const progress = await saleProgress(connection, mint);
    if (progress.graduated) {
      break;
    }
    let widest = buyers[0]!;
    let widestRoom = -1n;
    for (const wallet of buyers) {
      const left = sale.cap - (await netBought(mint, wallet.publicKey));
      if (left > widestRoom) {
        widest = wallet;
        widestRoom = left;
      }
    }
    assert.ok(widestRoom > 0n, "every wallet is at its cap and the curve is not full");
    const left = progress.threshold - progress.quoteRaised;
    // The buy that finishes a curve is a partial fill: DBC takes what is left
    // on the curve and leaves the rest of the payment with the buyer.
    const finishing = left < stepIn;
    const built = finishing
      ? await buyTransaction({
          connection,
          buyer: widest.publicKey,
          mint,
          amountIn: (left * 10_100n) / 10_000n + USDC,
          fill: "partial",
        })
      : await buildBuy(widest.publicKey, mint, stepIn, widestRoom);
    assert.ok(built !== null, "no buy fits this wallet's room");
    const check = await preflightBuy({
      connection,
      openingRecord: true,
      buyer: widest.publicKey,
      mint,
      amountOut: built.expectedAmountOut,
    });
    assert.equal(check.ok, true, `the preflight refused for ${check.error}`);
    await send(
      finishing ? "the buy that fills the curve, USDC" : `graduating curve, buy ${round + 1}`,
      built.transaction,
      [widest]
    );
  }
  const filled = await saleProgress(connection, mint);
  assert.equal(filled.graduated, true, "the curve never filled");
  assert.equal(await isSaleRunning(connection, mint), false, "DBC left the hook on the mint");
  const finalPrice = await curvePriceNow(mint);
  const ceiling = priceCeiling(sale, BigInt(manifest.stockPrice));
  assert.ok(finalPrice <= ceiling, "the curve finished above the ceiling");
  console.log(
    `   raised ${Number(filled.quoteRaised) / 1e6} of ${Number(filled.threshold) / 1e6} USDC, curve finished at ${dollars(finalPrice).toFixed(6)} under a ceiling of ${dollars(ceiling).toFixed(6)}`
  );

  step("a8. anyone migrates the graduated pool to DAMM v2");
  const graduate = await graduateTransaction({ connection, payer: stranger.publicKey, mint });
  await send("migrate to DAMM v2, USDC", graduate.transaction, [stranger, ...graduate.signers]);
  const migrated = await saleProgress(connection, mint);
  assert.ok(migrated.dammPool !== null, "the DAMM v2 pool was not created");
  const standing = saleStanding(sale, await listBuyerRecords(connection, mint));
  assert.ok(standing.largestNetBought <= sale.cap, "a wallet passed the cap");
  console.log(
    `   DAMM v2 pool ${migrated.dammPool.toBase58()}, ${standing.buyers} buyers, largest ${(standing.largestShare * 100).toFixed(2)} percent against a cap share of ${(standing.capShare * 100).toFixed(2)} percent`
  );
}

async function aaplxSale(): Promise<void> {
  step("b1. an AAPLx template, with DBC's badge for AAPLx");
  const partner = loadWallet(FORK_ACCOUNTS_DIR, "stock-partner");
  const buyer = loadWallet(FORK_ACCOUNTS_DIR, "stock-buyer");
  const creator = Keypair.generate();
  for (const wallet of [partner, buyer, creator]) {
    await airdrop(wallet.publicKey, 20);
  }
  const buyerAaplx = getAssociatedTokenAddressSync(
    AAPLX_MINT,
    buyer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const aaplxBefore = await tokenBalance(buyerAaplx);
  assert.ok(aaplxBefore > 0n, "the stock buyer was not handed AAPLx, check fork-validator.sh");
  assert.ok(
    (await connection.getAccountInfo(AAPLX_TOKEN_BADGE))?.owner.equals(DBC_PROGRAM_ID),
    "AAPLx's DBC badge is not on the fork"
  );

  const template = await launchTemplateTransaction({
    connection,
    partner: partner.publicKey,
    quoteMint: AAPLX_MINT,
    curve: aaplxCurve(),
    tokenBadge: AAPLX_TOKEN_BADGE,
  });
  await send("AAPLx launch template", template.transaction, [partner, template.config]);
  const endsAt = (await chainNow()) + OFFERING_SECS;
  const terms = { capShareBps: 1_000, accessMode: 0, endsAt };

  step("b2. the pool as openSaleTransaction builds it, with no badge on the pool instruction");
  const bare = await openSaleTransaction({
    connection,
    creator: creator.publicKey,
    config: template.config.publicKey,
    name: "Pangu AAPLx Rehearsal",
    symbol: "PAAX",
    uri: "https://example.invalid/paax.json",
    sale: terms,
  });
  const bareLogs = await refusedLogs("AAPLx pool without the badge", bare.transaction, [
    creator,
    bare.baseMint,
  ]);
  const said = bareLogs.find((line) => line.includes("Error Message")) ?? bareLogs.at(-1) ?? "";
  console.log(`   refused by DBC: ${said.replace(/^Program log: /, "")}`);
  assert.equal(await connection.getAccountInfo(bare.pool), null, "a pool was left behind");

  step("b3. a ceiling on a sale paid in AAPLx is refused");
  const banded = await openSaleTransaction({
    connection,
    creator: creator.publicKey,
    config: template.config.publicKey,
    name: "Pangu AAPLx Ceiling",
    symbol: "PAAC",
    uri: "https://example.invalid/paac.json",
    sale: { ...terms, band: APPLE_BAND },
  });
  assert.equal(
    await refusal(
      "ceiling on an AAPLx sale",
      withBadge(banded.transaction, AAPLX_TOKEN_BADGE),
      [creator, banded.baseMint]
    ),
    "BandNeedsDollarQuote"
  );
  assert.equal(await connection.getAccountInfo(banded.pool), null, "the refused pool was left behind");

  step("b4. the AAPLx sale with no ceiling, the badge added to the pool instruction");
  const opened = await openSaleTransaction({
    connection,
    creator: creator.publicKey,
    config: template.config.publicKey,
    name: "Pangu AAPLx Rehearsal",
    symbol: "PAAX",
    uri: "https://example.invalid/paax.json",
    sale: terms,
  });
  await send(
    "AAPLx pool plus rules",
    withBadge(opened.transaction, AAPLX_TOKEN_BADGE),
    [creator, opened.baseMint]
  );
  const mint = opened.baseMint.publicKey;
  const sale = (await getSale(connection, mint))!;
  assert.ok(sale.quoteMint?.equals(AAPLX_MINT), "the rules do not record AAPLx as the paying token");
  assert.equal(sale.hasBand, false);

  step("b5. a buy and a sell, paid in AAPLx");
  const buy = await buyTransaction({
    connection,
    buyer: buyer.publicKey,
    mint,
    amountIn: 10n ** BigInt(AAPLX_DECIMALS),
  });
  assert.ok(buy.expectedAmountOut <= sale.cap, "one AAPLx buys past the cap");
  await send("buy, AAPLx", buy.transaction, [buyer]);
  const held = await tokenBalance(baseAta(mint, buyer.publicKey));
  assert.equal(held, buy.expectedAmountOut);
  assert.equal(await netBought(mint, buyer.publicKey), held);
  assert.equal(await tokenBalance(buyerAaplx), aaplxBefore - 10n ** BigInt(AAPLX_DECIMALS));

  const sell = await sellTransaction({ connection, seller: buyer.publicKey, mint, amountIn: held / 2n });
  await send("sell, AAPLx", sell.transaction, [buyer]);
  assert.equal(await netBought(mint, buyer.publicKey), held - held / 2n);
  const back = (await tokenBalance(buyerAaplx)) - (aaplxBefore - 10n ** BigInt(AAPLX_DECIMALS));
  assert.ok(back > 0n, "the sell paid no AAPLx back");
  console.log(
    `   1 AAPLx bought ${held} raw units; selling half returned ${Number(back) / 10 ** AAPLX_DECIMALS} AAPLx`
  );
}

async function demoDollarRefused(partner: Keypair, creator: Keypair): Promise<void> {
  step("c. a ceiling on the demo dollar is refused by the mainnet build");
  assert.ok(
    !dollarMints("mainnet").some((mint) => mint.equals(DEMO_DOLLAR_MINT)),
    "the SDK's mainnet list carries the demo dollar"
  );
  assert.ok(
    dollarMints("devnet").some((mint) => mint.equals(DEMO_DOLLAR_MINT)),
    "the SDK's devnet list no longer carries the demo dollar"
  );
  const template = await launchTemplateTransaction({
    connection,
    partner: partner.publicKey,
    quoteMint: DEMO_DOLLAR_MINT,
    curve: usdcCurve("crossing"),
  });
  await send("demo dollar launch template", template.transaction, [partner, template.config]);
  const opened = await openSaleTransaction({
    connection,
    creator: creator.publicKey,
    config: template.config.publicKey,
    name: "Pangu Demo Dollar",
    symbol: "PDEMO",
    uri: "https://example.invalid/pdemo.json",
    sale: {
      capShareBps: CROSSING_CAP_BPS,
      accessMode: 0,
      band: APPLE_BAND,
      endsAt: (await chainNow()) + OFFERING_SECS,
    },
  });
  assert.equal(
    await refusal("ceiling on the demo dollar", opened.transaction, [creator, opened.baseMint]),
    "BandNeedsDollarQuote"
  );
  assert.equal(await connection.getAccountInfo(opened.pool), null, "the refused pool was left behind");
  assert.equal(await getSale(connection, opened.baseMint.publicKey), null, "rules were written anyway");
}

main()
  .then(() => {
    console.log("\nREHEARSAL-SALES-OK");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
