// The same launch, but priced in a real stock token instead of SOL.
//
// AAPLx is a live Token-2022 mint on mainnet with a permanent delegate, a pausable
// switch, a scaled UI amount and an empty transfer hook. It is cloned into the fork
// together with its DBC token badge, and one test wallet is handed a rewritten copy
// of a real AAPLx token account, because nobody local holds the mint authority.
//
// Covers: template, pool plus rules in one transaction, a price ceiling refused
// because AAPLx is not a dollar, a buy under the cap, and a buy over it.
// Does NOT cover: graduation with a stock quote, or anything AAPLx's issuer could
// do with its permanent delegate.

import { assert } from "chai";
import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  DynamicBondingCurveClient,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  buildCurve,
  deriveDbcPoolAddress,
  deriveDbcTokenVaultAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  AAPLX_MINT,
  AAPLX_TOKEN_BADGE,
  ACCESS_ISSUER_LIST,
  PANGU_PROGRAM_ID,
  SWAP_EXACT_OUT,
  Sale,
  airdrop,
  approveBuyerIx,
  buildSwapTx,
  connection,
  createSaleIx,
  expectPanguError,
  loadForkWallet,
  readRecord,
  saleRulesPda,
  send,
  tokenBalance,
  transferHookOnMint,
} from "./fork-sale";
import {
  BAND_BPS,
  MAX_CONF_BPS,
  PRICE_FEED_ID,
  bandPriceAccount,
  bandShard,
  maxPriceAgeSecs,
} from "./band-setup";

const TOKEN_NAME = "Pangu Stock Quote";
const TOKEN_SYMBOL = "PSQ";
const TOKEN_URI = "https://example.invalid/psq.json";
const AAPLX_DECIMALS = 8;
/** Graduation threshold in whole AAPLx. */
const GRADUATION_AAPLX = 100;
const MAX_SPEND = new BN(1_000 * 10 ** AAPLX_DECIMALS);

describe("a Pangu sale priced in a real stock token", () => {
  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");

  const partner = loadForkWallet("stock-partner");
  const buyer = loadForkWallet("stock-buyer");
  const creator = Keypair.generate();
  const config = Keypair.generate();
  const baseMintKeypair = Keypair.generate();

  let sale: Sale;
  let cap: BN;
  let swapBaseAmount: BN;
  let firstBuy: BN;
  let oneOverCap: BN;

  before(async () => {
    for (const wallet of [partner, creator, buyer]) {
      await airdrop(wallet.publicKey, 100);
    }
    const quoteBalance = await tokenBalance(
      getAssociatedTokenAddressSync(
        AAPLX_MINT,
        buyer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      )
    );
    assert.isAbove(
      Number(quoteBalance),
      0,
      "the test wallet was not given AAPLx, check fork-validator.sh"
    );
    const hook = await transferHookOnMint(AAPLX_MINT);
    assert.equal(
      hook!.program.toBase58(),
      PublicKey.default.toBase58(),
      "AAPLx now names a transfer hook program, which DBC cannot carry on the quote side"
    );
  });

  it("a. the partner creates a template quoted in AAPLx", async () => {
    const curve = buildCurve({
      token: {
        tokenType: TokenType.Token2022,
        tokenBaseDecimal: TokenDecimal.SIX,
        tokenQuoteDecimal: TokenDecimal.EIGHT,
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
        collectFeeMode: CollectFeeMode.QuoteToken,
        creatorTradingFeePercentage: 50,
        poolCreationFee: 0,
        enableFirstSwapWithMinFee: false,
      },
      migration: {
        migrationOption: MigrationOption.MET_DAMM_V2,
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
      migrationQuoteThreshold: GRADUATION_AAPLX,
    });

    const tx = await dbcClient.partner.createConfigWithTransferHook({
      config: config.publicKey,
      feeClaimer: partner.publicKey,
      leftoverReceiver: partner.publicKey,
      payer: partner.publicKey,
      quoteMint: AAPLX_MINT,
      tokenBadge: AAPLX_TOKEN_BADGE,
      transferHookProgram: PANGU_PROGRAM_ID,
      ...curve,
    });
    await send("create config, stock quote", tx, partner, [partner, config]);

    const state = await dbcClient.state.getPoolConfig(config.publicKey);
    assert.isNotNull(state, "the config was not written");
    assert.equal(state!.quoteMint.toBase58(), AAPLX_MINT.toBase58());
    // quoteTokenFlag 1 means DBC recorded the quote as a Token-2022 mint.
    assert.equal(state!.quoteTokenFlag, 1);
    swapBaseAmount = state!.swapBaseAmount;
  });

  it("b. the creator opens the pool and the sale rules in one transaction", async () => {
    const baseMint = baseMintKeypair.publicKey;
    const pool = deriveDbcPoolAddress(AAPLX_MINT, baseMint, config.publicKey);
    cap = swapBaseAmount.divn(10);

    const poolTx = await dbcClient.creator.createPoolWithTransferHook({
      baseMint,
      config: config.publicKey,
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      uri: TOKEN_URI,
      payer: creator.publicKey,
      poolCreator: creator.publicKey,
      tokenBadge: AAPLX_TOKEN_BADGE,
      transferHookProgram: PANGU_PROGRAM_ID,
    });
    poolTx.add(
      await createSaleIx(
        creator.publicKey,
        pool,
        baseMint,
        cap,
        ACCESS_ISSUER_LIST,
        { dbcConfig: config.publicKey, quoteMint: AAPLX_MINT }
      )
    );
    await send("create pool plus create_sale, stock quote", poolTx, creator, [
      creator,
      baseMintKeypair,
    ]);

    sale = {
      config: config.publicKey,
      pool,
      baseMint,
      quoteMint: AAPLX_MINT,
      baseVault: deriveDbcTokenVaultAddress(pool, baseMint),
      quoteVault: deriveDbcTokenVaultAddress(pool, AAPLX_MINT),
      quoteProgram: TOKEN_2022_PROGRAM_ID,
    };

    const hook = await transferHookOnMint(baseMint);
    assert.equal(hook!.program.toBase58(), PANGU_PROGRAM_ID.toBase58());
  });

  it("c. a price ceiling on a sale paid in AAPLx is refused", async () => {
    // The ceiling is a dollar price, and AAPLx is counted in shares. Every band
    // setting here is valid, so the paying token is the only thing refused, and
    // the pool it would have opened with goes down with the same transaction.
    const bandedMint = Keypair.generate();
    const pool = deriveDbcPoolAddress(
      AAPLX_MINT,
      bandedMint.publicKey,
      config.publicKey
    );
    const tx = await dbcClient.creator.createPoolWithTransferHook({
      baseMint: bandedMint.publicKey,
      config: config.publicKey,
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      uri: TOKEN_URI,
      payer: creator.publicKey,
      poolCreator: creator.publicKey,
      tokenBadge: AAPLX_TOKEN_BADGE,
      transferHookProgram: PANGU_PROGRAM_ID,
    });
    tx.add(
      await createSaleIx(
        creator.publicKey,
        pool,
        bandedMint.publicKey,
        cap,
        ACCESS_ISSUER_LIST,
        {
          band: {
            bandBps: BAND_BPS,
            priceAccount: bandPriceAccount("high"),
            priceFeedId: PRICE_FEED_ID,
            priceShard: bandShard("high"),
            maxPriceAgeSecs: maxPriceAgeSecs("high"),
            maxConfBps: MAX_CONF_BPS,
          },
          dbcConfig: config.publicKey,
          quoteMint: AAPLX_MINT,
        }
      )
    );
    await expectPanguError(
      tx,
      creator,
      [creator, bandedMint],
      "BandNeedsDollarQuote"
    );
    assert.isNull(
      await connection.getAccountInfo(saleRulesPda(bandedMint.publicKey)),
      "rules were written anyway"
    );
    assert.isNull(await connection.getAccountInfo(pool), "the pool was left behind");
  });

  it("d. an approved buyer buys under the cap, paying in AAPLx", async () => {
    const approve = new Transaction().add(
      await approveBuyerIx(creator.publicKey, sale.baseMint, buyer.publicKey)
    );
    await send("approve buyer, stock quote", approve, creator, [creator]);

    firstBuy = cap.divn(2);
    oneOverCap = cap.sub(firstBuy).addn(1);
    const tx = await buildSwapTx({
      sale,
      owner: buyer,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: firstBuy,
      amount1: MAX_SPEND,
    });
    await send("first buy, stock quote", tx, buyer, [buyer]);

    const ata = getAssociatedTokenAddressSync(
      sale.baseMint,
      buyer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const record = await readRecord(sale.baseMint, buyer.publicKey);
    assert.equal(record.netBought.toString(), firstBuy.toString());
    assert.equal((await tokenBalance(ata)).toString(), firstBuy.toString());
  });

  it("e. the same buyer cannot cross the cap", async () => {
    const tx = await buildSwapTx({
      sale,
      owner: buyer,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: oneOverCap,
      amount1: MAX_SPEND,
    });
    await expectPanguError(tx, buyer, [buyer], "OverCap");
  });
});
