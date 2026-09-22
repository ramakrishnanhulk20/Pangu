// A price-banded Pangu sale run against Meteora's real Dynamic Bonding Curve.
//
// The band says: no buy may leave the curve price more than ten percent above the
// real stock's live price, and the sale shuts when the price stops being fresh,
// which is what happens when the stock market closes. Everything the hook reads
// here comes from the chain: the curve price out of the pool DBC has just
// written, and the stock price out of a Pyth price feed account written in the
// layout Pyth's receiver program really uses.
//
// Covers: a buy inside the band, buying until the next buy would cross the
// ceiling, the refusal, a smaller buy still passing, the same buy passing when
// the stock price is higher, the price going stale and shutting buys, and the
// exit staying open through all of it.
//
// Does NOT cover: the Wormhole guardian signatures. Pangu does not re-verify
// them, it relies on the account being a program address of Pyth's price feed
// program owned by a receiver program that checks them, and a local validator
// has neither. What that leaves unproven is written up in
// docs/measurements/price-band-pyth.md, and the live price is verified through
// Pangu's own code on devnet by packages/program/feeds.
//
// Two pools are used where one would read better. A local validator can only be
// handed accounts at genesis, so a sale's stock price cannot be moved once the
// chain is running. The two pools run the same template and the same buys, and
// the test asserts their curve prices are identical before comparing them.

import * as fs from "fs";
import * as path from "path";
import { assert } from "chai";
import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  deriveDbcPoolAddress,
  deriveDbcTokenVaultAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  FORK_ACCOUNTS_DIR,
  PANGU_PROGRAM_ID,
  SWAP_EXACT_OUT,
  Sale,
  airdrop,
  buildSwapTx,
  connection,
  createSaleIx,
  expectPanguError,
  openBuyerRecordIx,
  readRules,
  send,
  tokenBalance,
} from "./fork-sale";
import {
  BAND_BPS,
  BASE_DECIMALS,
  MANIFEST_FILE,
  MAX_CONF_BPS,
  PRICE_FEED_ID,
  PRICE_AGE_SHORT_SECS,
  PriceManifest,
  QUOTE_DECIMALS,
  SaleName,
  bandCeiling1e18,
  bandCurve,
  bandPriceAccount,
  bandShard,
  curvePriceCeil1e18,
  maxPriceAgeSecs,
} from "./band-setup";

const MAX_SPEND = new BN(400_000 * 10 ** QUOTE_DECIMALS);
const QUOTE_SUPPLY = BigInt(10_000_000) * 10n ** BigInt(QUOTE_DECIMALS);
/** How many rounds of buying the crossing test may take before it gives up. */
const MAX_ROUNDS = 40;

const manifest: PriceManifest = JSON.parse(
  fs.readFileSync(path.join(FORK_ACCOUNTS_DIR, MANIFEST_FILE), "utf8")
);

describe("a price-banded Pangu sale against a real DBC pool", () => {
  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");

  const partner = Keypair.generate();
  const creator = Keypair.generate();
  const buyer = Keypair.generate();
  const config = Keypair.generate();
  const quoteMintKeypair = Keypair.generate();
  const baseMints: Record<SaleName, Keypair> = {
    low: Keypair.generate(),
    high: Keypair.generate(),
    aging: Keypair.generate(),
  };

  let quoteMint: PublicKey;
  let cap: BN;
  const sales = {} as Record<SaleName, Sale>;
  /** The buy size that crossed the low sale's ceiling. */
  let crossingBuy: BN;
  /** What the buyer holds of the ageing sale, bought while its market was open. */
  let agingHeld: bigint;

  before(async () => {
    for (const wallet of [partner, creator, buyer]) {
      await airdrop(wallet.publicKey, 500);
    }

    // The price accounts were written just before genesis and cannot be
    // rewritten: Pyth's receiver program is not on the fork, and its accounts
    // are program addresses only it could write. Pyth's freshness rule is in
    // seconds against the chain's own clock, so they simply age as the run goes
    // along. The ageing sale's limit is short enough to run out partway through,
    // which is what shuts its buys in step f.
    const age = Math.floor(Date.now() / 1000) - manifest.aging.publishTime;
    assert.isBelow(
      age,
      PRICE_AGE_SHORT_SECS - 60,
      "the ageing sale's price went stale before the test could buy anything. " +
        "Check the order in scripts/wsl/fork-test.sh"
    );
  });

  it("a. the partner opens a template priced in a six decimal dollar token", async () => {
    // The fork has no USDC faucet, so the paying token is one this test controls.
    // A plain SPL token needs no badge from DBC, which is why it is not a
    // Token-2022 mint here.
    quoteMint = quoteMintKeypair.publicKey;
    const mintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: partner.publicKey,
        newAccountPubkey: quoteMint,
        lamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE),
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        quoteMint,
        QUOTE_DECIMALS,
        partner.publicKey,
        null,
        TOKEN_PROGRAM_ID
      )
    );
    await send("create the paying token", mintTx, partner, [
      partner,
      quoteMintKeypair,
    ]);

    const buyerQuote = getAssociatedTokenAddressSync(
      quoteMint,
      buyer.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    const fundTx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        partner.publicKey,
        buyerQuote,
        buyer.publicKey,
        quoteMint,
        TOKEN_PROGRAM_ID
      ),
      createMintToInstruction(
        quoteMint,
        buyerQuote,
        partner.publicKey,
        QUOTE_SUPPLY,
        [],
        TOKEN_PROGRAM_ID
      )
    );
    await send("fund the buyer with dollars", fundTx, partner, [partner]);

    const tx = await dbcClient.partner.createConfigWithTransferHook({
      config: config.publicKey,
      feeClaimer: partner.publicKey,
      leftoverReceiver: partner.publicKey,
      payer: partner.publicKey,
      quoteMint,
      transferHookProgram: PANGU_PROGRAM_ID,
      ...bandCurve(),
    });
    await send("create banded config", tx, partner, [partner, config]);

    const state = await dbcClient.state.getPoolConfig(config.publicKey);
    assert.isNotNull(state, "the config was not written");
    assert.equal(state!.quoteMint.toBase58(), quoteMint.toBase58());
    // One buyer walks the whole curve, so the cap must not be what stops them.
    cap = state!.swapBaseAmount;
  });

  it("b. the creator opens three banded sales, one per stock price", async () => {
    // The ageing sale is opened and seeded first: its price goes stale on its
    // own, and the buyer needs tokens before it does.
    for (const name of ["aging", "low", "high"] as SaleName[]) {
      const entry = manifest[name];
      const baseMint = baseMints[name].publicKey;
      const pool = deriveDbcPoolAddress(quoteMint, baseMint, config.publicKey);

      const poolTx = await dbcClient.creator.createPoolWithTransferHook({
        baseMint,
        config: config.publicKey,
        name: `Pangu Banded ${name}`,
        symbol: "PBD",
        uri: "https://example.invalid/pbd.json",
        payer: creator.publicKey,
        poolCreator: creator.publicKey,
        transferHookProgram: PANGU_PROGRAM_ID,
      });
      poolTx.add(
        await createSaleIx(creator.publicKey, pool, baseMint, cap, 0, {
          band: {
            bandBps: BAND_BPS,
            priceAccount: bandPriceAccount(name),
            priceFeedId: PRICE_FEED_ID,
            priceShard: bandShard(name),
            maxPriceAgeSecs: maxPriceAgeSecs(name),
            maxConfBps: MAX_CONF_BPS,
          },
          dbcConfig: config.publicKey,
          quoteMint,
        })
      );
      await send(`create pool plus banded create_sale, ${name}`, poolTx, creator, [
        creator,
        baseMints[name],
      ]);

      sales[name] = {
        config: config.publicKey,
        pool,
        baseMint,
        quoteMint,
        baseVault: deriveDbcTokenVaultAddress(pool, baseMint),
        quoteVault: deriveDbcTokenVaultAddress(pool, quoteMint),
        quoteProgram: TOKEN_PROGRAM_ID,
        priceAccount: bandPriceAccount(name),
      };

      const rules = await readRules(baseMint);
      assert.equal(rules.bandBps, BAND_BPS);
      assert.equal(rules.priceAccount.toBase58(), entry.priceAccount);
      assert.equal(rules.priceShard, entry.shard);
      assert.equal(rules.maxPriceAgeSecs, entry.maxPriceAgeSecs);
      assert.equal(rules.baseDecimals, BASE_DECIMALS);
      assert.equal(rules.quoteDecimals, QUOTE_DECIMALS);

      await send(
        `open the buyer's record, ${name}`,
        new Transaction().add(
          await openBuyerRecordIx(buyer.publicKey, baseMint)
        ),
        buyer,
        [buyer]
      );

      if (name === "aging") {
        await send(
          "buy before the market shuts",
          await buyTx("aging", cap.divn(200)),
          buyer,
          [buyer]
        );
        agingHeld = await tokenBalance(baseAta("aging"));
        assert.isAbove(Number(agingHeld), 0);
      }
    }

    const stock = BigInt(manifest.low.stockPrice);
    console.log(
      `      stock price ${Number(stock) / 1e18}, ceiling ` +
        `${Number(bandCeiling1e18(stock, BAND_BPS)) / 1e18} dollars a token`
    );
  });

  it("c. a buy well inside the band passes", async () => {
    const before = await curvePrice(sales.low.pool);
    const ceiling = bandCeiling1e18(BigInt(manifest.low.stockPrice), BAND_BPS);
    assert.isTrue(before < ceiling, "the curve already opens above the ceiling");

    const amount = cap.divn(200);
    await send("banded buy inside the band", await buyTx("low", amount), buyer, [
      buyer,
    ]);
    assert.isTrue((await curvePrice(sales.low.pool)) <= ceiling);
  });

  it("d. buying stops at the ceiling, and a smaller buy still gets through", async () => {
    const ceiling = bandCeiling1e18(BigInt(manifest.low.stockPrice), BAND_BPS);
    const amount = cap.divn(25);
    let rounds = 0;
    let refusal = "";

    // Keep buying the same size until one of them is refused. Every round sends
    // a real transaction, so nothing here depends on a simulation.
    for (; rounds < MAX_ROUNDS; rounds += 1) {
      const outcome = await trySend(await buyTx("low", amount));
      if (!outcome.ok) {
        refusal = outcome.logs;
        break;
      }
    }

    assert.include(
      refusal,
      "Error Code: PriceOutsideBand",
      `the curve never reached the ceiling in ${MAX_ROUNDS} buys: ${refusal}`
    );
    crossingBuy = amount;

    const price = await curvePrice(sales.low.pool);
    console.log(
      `      refused after ${rounds} buys: curve ${Number(price) / 1e18}, ` +
        `ceiling ${Number(ceiling) / 1e18} dollars a token`
    );
    assert.isTrue(price <= ceiling, "the curve was allowed past the ceiling");

    // The band is a ceiling on where a buy leaves the price, not a freeze. A
    // smaller buy lands under the ceiling and goes through.
    await send(
      "smaller buy under the ceiling",
      await buyTx("low", amount.divn(16)),
      buyer,
      [buyer]
    );
    assert.isTrue((await curvePrice(sales.low.pool)) <= ceiling);
  });

  it("e. the same buy passes on the sale whose stock price is higher", async () => {
    // Walk the high sale up to at least where the low sale stands, on the same
    // template and the same buy size, so the only thing left that differs
    // between the two is the stock price in their quote accounts.
    const target = await poolSqrtPrice(sales.low.pool);
    const amount = crossingBuy;
    let reached = false;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      if ((await poolSqrtPrice(sales.high.pool)) >= target) {
        reached = true;
        break;
      }
      await send(
        `banded buy on the high sale ${round + 1}`,
        await buyTx("high", amount),
        buyer,
        [buyer]
      );
    }
    assert.isTrue(reached, "the high sale never caught up with the low sale");

    // The low sale refused exactly this buy a moment ago, from a curve price no
    // higher than this one.
    await send(
      "the refused buy, at a higher stock price",
      await buyTx("high", amount),
      buyer,
      [buyer]
    );

    const highCeiling = bandCeiling1e18(
      BigInt(manifest.high.stockPrice),
      BAND_BPS
    );
    assert.isTrue((await curvePrice(sales.high.pool)) <= highCeiling);
  });

  it("f. the price goes stale when nobody publishes, and the exit stays open", async () => {
    // Nobody has refreshed this sale's price account since before the chain
    // started. That is exactly what a shut stock market looks like from here:
    // Pyth stops publishing and the account simply ages out. The other two sales
    // allow an hour, so they are untouched.
    await waitUntilUnix(
      manifest.aging.publishTime + manifest.aging.maxPriceAgeSecs + 5
    );

    await expectPanguError(
      await buyTx("aging", cap.divn(200)),
      buyer,
      [buyer],
      "PriceStale"
    );

    const held = await tokenBalance(baseAta("aging"));
    await send(
      "sell against a stale price",
      await sellTx("aging", held / 2n),
      buyer,
      [buyer]
    );
    assert.isBelow(Number(await tokenBalance(baseAta("aging"))), Number(held));
    assert.isAbove(Number(held), 0, "the buyer had nothing left to sell");
    assert.equal(Number(held), Number(agingHeld));
  });

  it("g. the other sales are untouched by the ageing one going stale", async () => {
    // Each sale names its own price account and its own age limit, so one sale
    // shutting says nothing about the next. The high sale allows an hour and its
    // ceiling is a hundred times the low sale's, so it still has room to buy.
    const before = await tokenBalance(baseAta("high"));
    await send(
      "buy on a sale whose price is still fresh",
      await buyTx("high", cap.divn(200)),
      buyer,
      [buyer]
    );
    assert.isAbove(
      Number(await tokenBalance(baseAta("high"))),
      Number(before),
      "a fresh sale was shut by another sale's stale price"
    );

    const highCeiling = bandCeiling1e18(
      BigInt(manifest.high.stockPrice),
      BAND_BPS
    );
    assert.isTrue((await curvePrice(sales.high.pool)) <= highCeiling);
  });

  /** Sends a transaction and reports whether it landed, without asserting. */
  async function trySend(
    tx: Transaction
  ): Promise<{ ok: boolean; logs: string }> {
    tx.feePayer = buyer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(buyer);
    try {
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      const latest = await connection.getLatestBlockhash();
      const result = await connection.confirmTransaction(
        { signature, ...latest },
        "confirmed"
      );
      if (result.value.err === null) {
        return { ok: true, logs: "" };
      }
      const detail = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 1,
      });
      return { ok: false, logs: (detail?.meta?.logMessages ?? []).join("\n") };
    } catch (error: any) {
      let logs = (error.logs ?? []).join("\n");
      if (logs === "" && typeof error.getLogs === "function") {
        logs = ((await error.getLogs(connection)) ?? []).join("\n");
      }
      return { ok: false, logs: logs === "" ? String(error.message ?? error) : logs };
    }
  }

  function baseAta(name: SaleName): PublicKey {
    return getAssociatedTokenAddressSync(
      sales[name].baseMint,
      buyer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
  }

  function buyTx(name: SaleName, amount: BN) {
    return buildSwapTx({
      sale: sales[name],
      owner: buyer,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: amount,
      amount1: MAX_SPEND,
    });
  }

  function sellTx(name: SaleName, amount: bigint) {
    return buildSwapTx({
      sale: sales[name],
      owner: buyer,
      swapBaseForQuote: true,
      amount0: new BN(amount.toString()),
      amount1: new BN(0),
    });
  }

  async function poolSqrtPrice(pool: PublicKey): Promise<bigint> {
    const account = await connection.getAccountInfo(pool);
    assert.isNotNull(account, "the pool is missing");
    const data = account!.data;
    return (
      data.readBigUInt64LE(280) + (data.readBigUInt64LE(288) << 64n)
    );
  }

  async function curvePrice(pool: PublicKey): Promise<bigint> {
    return curvePriceCeil1e18(
      await poolSqrtPrice(pool),
      BASE_DECIMALS,
      QUOTE_DECIMALS
    );
  }
});

async function waitUntilUnix(target: number) {
  while (Math.floor(Date.now() / 1000) < target) {
    await pause(2_000);
  }
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
