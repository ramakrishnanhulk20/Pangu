// The whole life of one Pangu sale, run against Meteora's real Dynamic Bonding
// Curve and DAMM v2 programs copied from mainnet into a local validator.
//
// Covers: the launch template, pool and rules in one transaction, the cap, the
// approved-buyer list, the fixed-owner rule on the receiving account, the exit,
// fee claims, graduation, migration and free trading afterwards.
//
// Does NOT cover: the price band and the credential access mode, which are not
// built; DAMM v2's own behaviour after migration; anything about the price a
// buyer gets, which is DBC's job and not Pangu's.

import { assert } from "chai";
import { BN } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeAccount3Instruction,
  createInitializeImmutableOwnerInstruction,
  getAccountLen,
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
  deriveDammV2PoolAddress,
  deriveDbcPoolAddress,
  deriveDbcTokenVaultAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ACCESS_ISSUER_LIST,
  DAMM_V2_CONFIG,
  PANGU_PROGRAM_ID,
  SWAP_EXACT_OUT,
  SWAP_PARTIAL_FILL,
  Sale,
  airdrop,
  approveBuyerIx,
  buildSwapTx,
  buildTransferTx,
  buyerRecordPda,
  closeBuyerRecordIx,
  connection,
  createSaleIx,
  dbcProgram,
  expectPanguError,
  hookAccounts,
  hookAccountsInfo,
  openBuyerRecordIx,
  pangu,
  readRecord,
  readRules,
  revokeBuyerIx,
  send,
  tokenBalance,
  transferHookOnMint,
} from "./fork-sale";

const TOKEN_NAME = "Pangu Test Share";
const TOKEN_SYMBOL = "PTS";
const TOKEN_URI = "https://example.invalid/pts.json";
const BASE_DECIMALS = 6;
const GRADUATION_SOL = 5;
/** Generous ceiling on what a buy may spend, in lamports. */
const MAX_SPEND = new BN(20 * 1_000_000_000);

describe("a Pangu sale inside a real DBC transfer-hook pool", () => {
  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");

  const partner = Keypair.generate();
  const creator = Keypair.generate();
  const buyer = Keypair.generate();
  const friend = Keypair.generate();
  const outsider = Keypair.generate();
  const stranger = Keypair.generate();
  const config = Keypair.generate();
  const baseMintKeypair = Keypair.generate();

  let sale: Sale;
  let cap: BN;
  let swapBaseAmount: BN;
  let migrationQuoteThreshold: BN;
  let baseReserveAtStart: BN;
  let buyerAta: PublicKey;
  let firstBuy: BN;
  let oneOverCap: BN;
  let secondAccount: PublicKey;
  const laterBuyers: Keypair[] = [];

  before(async () => {
    for (const wallet of [partner, creator, buyer, friend, outsider, stranger]) {
      await airdrop(wallet.publicKey, 100);
    }
  });

  it("a. the partner creates a transfer-hook launch template", async () => {
    const curve = buildCurve({
      token: {
        tokenType: TokenType.Token2022,
        tokenBaseDecimal: TokenDecimal.SIX,
        tokenQuoteDecimal: TokenDecimal.NINE,
        // No mint authority once the pool exists. Minting is not a transfer, so the
        // hook would never see it, and create_sale refuses a mint that still has
        // one. DBC still mints the whole supply into the vault first.
        tokenAuthorityOption: TokenAuthorityOption.CreatorUpdateAuthority,
        totalTokenSupply: 1_000_000_000,
        leftover: 0,
      },
      fee: {
        baseFeeParams: {
          // A flat fee at the lowest the program allows: a scheduler with no
          // periods, starting and ending at 25 bps.
          baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
          feeSchedulerParam: {
            startingFeeBps: 25,
            endingFeeBps: 25,
            numberOfPeriod: 0,
            totalDuration: 0,
          },
        },
        dynamicFeeEnabled: false,
        // C11. Fees are taken in the paying token only, so no fee claim can ever
        // move the sale token while the hook is live.
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
      migrationQuoteThreshold: GRADUATION_SOL,
    });

    const tx = await dbcClient.partner.createConfigWithTransferHook({
      config: config.publicKey,
      feeClaimer: partner.publicKey,
      leftoverReceiver: partner.publicKey,
      payer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      transferHookProgram: PANGU_PROGRAM_ID,
      ...curve,
    });
    await send("create config", tx, partner, [partner, config]);

    const state = await dbcClient.state.getPoolConfig(config.publicKey);
    assert.isNotNull(state, "the config was not written");
    assert.equal(state!.tokenType, TokenType.Token2022);
    assert.equal(state!.collectFeeMode, CollectFeeMode.QuoteToken);
    swapBaseAmount = state!.swapBaseAmount;
    migrationQuoteThreshold = state!.migrationQuoteThreshold;
    console.log(`      config ${config.publicKey.toBase58()}`);
  });

  it("b. the creator opens the pool and the sale rules in one transaction", async () => {
    const baseMint = baseMintKeypair.publicKey;
    const pool = deriveDbcPoolAddress(NATIVE_MINT, baseMint, config.publicKey);

    // The cap is a tenth of what the curve sells before graduation, read from the
    // config rather than written in by hand.
    cap = swapBaseAmount.divn(10);

    const poolTx = await dbcClient.creator.createPoolWithTransferHook({
      baseMint,
      config: config.publicKey,
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      uri: TOKEN_URI,
      payer: creator.publicKey,
      poolCreator: creator.publicKey,
      transferHookProgram: PANGU_PROGRAM_ID,
    });
    poolTx.add(
      await createSaleIx(
        creator.publicKey,
        pool,
        baseMint,
        cap,
        ACCESS_ISSUER_LIST,
        { dbcConfig: config.publicKey }
      )
    );

    await send("create pool plus create_sale", poolTx, creator, [
      creator,
      baseMintKeypair,
    ]);

    const poolState = await dbcClient.state.getPool(pool);
    assert.isNotNull(poolState, "the pool was not written");
    baseReserveAtStart = poolState!.poolState.baseReserve;

    sale = {
      config: config.publicKey,
      pool,
      baseMint,
      quoteMint: NATIVE_MINT,
      baseVault: deriveDbcTokenVaultAddress(pool, baseMint),
      quoteVault: deriveDbcTokenVaultAddress(pool, NATIVE_MINT),
      quoteProgram: TOKEN_PROGRAM_ID,
    };
    buyerAta = getAssociatedTokenAddressSync(
      baseMint,
      buyer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const rules = await readRules(baseMint);
    assert.equal(rules.pool.toBase58(), pool.toBase58());
    assert.equal(rules.baseVault.toBase58(), sale.baseVault.toBase58());
    assert.equal(rules.issuer.toBase58(), creator.publicKey.toBase58());
    assert.equal(rules.cap.toString(), cap.toString());
    const hook = await transferHookOnMint(baseMint);
    assert.equal(hook!.program.toBase58(), PANGU_PROGRAM_ID.toBase58());
    console.log(
      `      pool ${pool.toBase58()}, cap ${cap.toString()} of ${swapBaseAmount.toString()} on the curve`
    );
  });

  it("c. a buy from a wallet with no record is refused", async () => {
    const tx = await buildSwapTx({
      sale,
      owner: stranger,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: cap.divn(4),
      amount1: MAX_SPEND,
    });
    await expectPanguError(tx, stranger, [stranger], "BuyerRecordMissing");
  });

  it("d. an approved buyer buys under the cap", async () => {
    const approve = new Transaction().add(
      await approveBuyerIx(creator.publicKey, sale.baseMint, buyer.publicKey)
    );
    await send("approve buyer", approve, creator, [creator]);

    // The SDK's own swap2WithTransferHook resolves a hook's extra accounts
    // against placeholder token accounts, so it cannot find a record that is
    // derived from the real destination owner. Proven here, then worked around by
    // building the same instruction with the accounts Pangu actually needs.
    let sdkOutcome = "the SDK resolved the wrong accounts";
    try {
      const sdkTx = await dbcClient.pool.swap2WithTransferHook({
        swapMode: 0,
        swapBaseForQuote: false,
        amountIn: new BN(1_000_000),
        minimumAmountOut: new BN(0),
        owner: buyer.publicKey,
        pool: sale.pool,
        referralTokenAccount: null,
        payer: buyer.publicKey,
      });
      const resolved = sdkTx.instructions[sdkTx.instructions.length - 1].keys
        .map((key) => key.pubkey.toBase58())
        .join(",");
      assert.notInclude(
        resolved,
        buyerRecordPda(sale.baseMint, buyer.publicKey).toBase58(),
        "the SDK helper unexpectedly resolved the buyer's record"
      );
    } catch (error: any) {
      const detail = String(error.message ?? "").trim();
      sdkOutcome = `the SDK threw ${error.constructor.name}${detail === "" ? "" : `: ${detail}`}`;
    }
    console.log(`      SDK swap helper: ${sdkOutcome}`);

    firstBuy = cap.divn(2);
    // What it would take to land exactly one unit past the cap from here.
    oneOverCap = cap.sub(firstBuy).addn(1);
    const tx = await buildSwapTx({
      sale,
      owner: buyer,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: firstBuy,
      amount1: MAX_SPEND,
    });
    await send("first buy", tx, buyer, [buyer]);

    const received = await tokenBalance(buyerAta);
    const record = await readRecord(sale.baseMint, buyer.publicKey);
    assert.equal(record.netBought.toString(), received.toString());
    assert.equal(record.netBought.toString(), firstBuy.toString());
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

  it("f. a second token account does not give the buyer a second cap", async () => {
    secondAccount = await createTokenAccount(buyer, sale.baseMint, true);
    const overCap = await buildSwapTx({
      sale,
      owner: buyer,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: oneOverCap,
      amount1: MAX_SPEND,
      outputTokenAccount: secondAccount,
    });
    await expectPanguError(overCap, buyer, [buyer], "OverCap");

    const changeableOwner = await createTokenAccount(buyer, sale.baseMint, false);
    const intoChangeable = await buildSwapTx({
      sale,
      owner: buyer,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: cap.divn(4),
      amount1: MAX_SPEND,
      outputTokenAccount: changeableOwner,
    });
    await expectPanguError(
      intoChangeable,
      buyer,
      [buyer],
      "ReceivingAccountOwnerCanChange"
    );
  });

  it("g. a wallet with a record but no approval is refused", async () => {
    const open = new Transaction().add(
      await openBuyerRecordIx(outsider.publicKey, sale.baseMint)
    );
    await send("open buyer record", open, outsider, [outsider]);

    const tx = await buildSwapTx({
      sale,
      owner: outsider,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: cap.divn(4),
      amount1: MAX_SPEND,
    });
    await expectPanguError(tx, outsider, [outsider], "NotApproved");
  });

  it("h. the token cannot move wallet to wallet during the sale", async () => {
    const approve = new Transaction().add(
      await approveBuyerIx(creator.publicKey, sale.baseMint, friend.publicKey)
    );
    await send("approve second buyer", approve, creator, [creator]);

    const friendAta = getAssociatedTokenAddressSync(
      sale.baseMint,
      friend.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const makeAccount = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        friend.publicKey,
        friendAta,
        friend.publicKey,
        sale.baseMint,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await send("open the friend's token account", makeAccount, friend, [friend]);

    const tx = await buildTransferTx(
      sale.baseMint,
      buyerAta,
      friendAta,
      buyer.publicKey,
      1_000n,
      BASE_DECIMALS
    );
    await expectPanguError(tx, buyer, [buyer], "WalletToWalletDuringSale");
  });

  it("i. a revoked holder can still sell back to the pool", async () => {
    const revoke = new Transaction().add(
      await revokeBuyerIx(creator.publicKey, sale.baseMint, buyer.publicKey)
    );
    await send("revoke buyer", revoke, creator, [creator]);

    const before = await readRecord(sale.baseMint, buyer.publicKey);
    const amount = cap.divn(4);
    const tx = await buildSwapTx({
      sale,
      owner: buyer,
      swapBaseForQuote: true,
      amount0: amount,
      amount1: new BN(0),
    });
    await send("sell", tx, buyer, [buyer]);

    const after = await readRecord(sale.baseMint, buyer.publicKey);
    assert.equal(
      after.netBought.toString(),
      before.netBought.sub(amount).toString()
    );
  });

  it("j. the partner and the creator claim their fees mid-sale", async () => {
    await send(
      "partner fee claim",
      await claimFeesTx("partner", partner.publicKey),
      partner,
      [partner]
    );
    await send(
      "creator fee claim",
      await claimFeesTx("creator", creator.publicKey),
      creator,
      [creator]
    );

    // C11 in one line: no sale token left the vault on either claim.
    const partnerBase = getAssociatedTokenAddressSync(
      sale.baseMint,
      partner.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const creatorBase = getAssociatedTokenAddressSync(
      sale.baseMint,
      creator.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    assert.equal(await tokenBalance(partnerBase), 0n);
    assert.equal(await tokenBalance(creatorBase), 0n);
  });

  it("k. fresh buyers fill the curve and DBC takes the hook off the mint", async () => {
    for (let round = 0; round < 20; round += 1) {
      const poolState = await dbcClient.state.getPool(sale.pool);
      if (poolState!.poolState.quoteReserve.gte(migrationQuoteThreshold)) {
        break;
      }
      const sold = baseReserveAtStart.sub(poolState!.poolState.baseReserve);
      const left = swapBaseAmount.sub(sold);

      const next = Keypair.generate();
      laterBuyers.push(next);
      await airdrop(next.publicKey, 100);
      const approve = new Transaction().add(
        await approveBuyerIx(creator.publicKey, sale.baseMint, next.publicKey)
      );
      await send(`approve buyer ${round + 1}`, approve, creator, [creator]);

      const last = left.lte(cap);
      const tx = await buildSwapTx({
        sale,
        owner: next,
        swapBaseForQuote: false,
        swapMode: last ? SWAP_PARTIAL_FILL : SWAP_EXACT_OUT,
        amount0: last ? MAX_SPEND : cap,
        amount1: last ? new BN(0) : MAX_SPEND,
      });
      await send(last ? "completing swap" : "later buy", tx, next, [next]);
    }

    const poolState = await dbcClient.state.getPool(sale.pool);
    assert.isTrue(
      poolState!.poolState.quoteReserve.gte(migrationQuoteThreshold),
      "the curve never completed"
    );

    const hook = await transferHookOnMint(sale.baseMint);
    assert.equal(
      hook!.program.toBase58(),
      PublicKey.default.toBase58(),
      "the hook program is still on the mint"
    );
    assert.equal(
      hook!.authority.toBase58(),
      PublicKey.default.toBase58(),
      "the hook authority is still on the mint"
    );
  });

  it("l. anyone can migrate the graduated pool to DAMM v2", async () => {
    const { transaction, firstPositionNftKeypair, secondPositionNftKeypair } =
      await dbcClient.migration.migrateToDammV2({
        pool: sale.pool,
        dammConfig: DAMM_V2_CONFIG,
        payer: stranger.publicKey,
      });
    await send("migrate", transaction, stranger, [
      stranger,
      firstPositionNftKeypair,
      secondPositionNftKeypair,
    ]);

    const dammPool = deriveDammV2PoolAddress(
      DAMM_V2_CONFIG,
      sale.baseMint,
      sale.quoteMint
    );
    const account = await connection.getAccountInfo(dammPool);
    assert.isNotNull(account, "the DAMM v2 pool was not created");
  });

  it("m. after graduation the token moves freely", async () => {
    const nobodyAta = getAssociatedTokenAddressSync(
      sale.baseMint,
      stranger.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const tx = await buildTransferTx(
      sale.baseMint,
      buyerAta,
      nobodyAta,
      buyer.publicKey,
      1_000n,
      BASE_DECIMALS
    );
    tx.instructions.splice(
      1,
      0,
      createAssociatedTokenAccountIdempotentInstruction(
        buyer.publicKey,
        nobodyAta,
        stranger.publicKey,
        sale.baseMint,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await send("wallet to wallet after graduation", tx, buyer, [buyer]);

    assert.equal(await tokenBalance(nobodyAta), 1_000n);
  });

  it("n. a buyer closes their record and gets the rent back", async () => {
    const before = await connection.getBalance(buyer.publicKey);
    const tx = new Transaction().add(
      await closeBuyerRecordIx(buyer.publicKey, sale.baseMint)
    );
    await send("close buyer record", tx, buyer, [buyer]);

    assert.isNull(await readRecord(sale.baseMint, buyer.publicKey));
    assert.isAbove(await connection.getBalance(buyer.publicKey), before);
  });

  it("o. no wallet holds more than the cap share of the sale", async () => {
    const accounts = await connection.getProgramAccounts(PANGU_PROGRAM_ID, {
      filters: [
        { dataSize: 8 + 32 + 32 + 1 + 8 + 1 },
        { memcmp: { offset: 8, bytes: sale.baseMint.toBase58() } },
      ],
    });
    let held = 0n;
    let largest = 0n;
    for (const entry of accounts) {
      const record = pangu.coder.accounts.decode(
        "buyerRecord",
        entry.account.data
      );
      const net = BigInt(record.netBought.toString());
      held += net;
      if (net > largest) {
        largest = net;
      }
    }

    const sold = BigInt(swapBaseAmount.toString());
    const capShare = (BigInt(cap.toString()) * 10_000n) / sold;
    const largestShare = (largest * 10_000n) / sold;
    const shareOfHeld = held === 0n ? 0n : (largest * 10_000n) / held;
    console.log(
      `      ${accounts.length} records. Largest wallet: ${Number(largestShare) / 100}% of every token the curve sold, cap share ${Number(capShare) / 100}%.`
    );
    console.log(
      `      Of the tokens still held from the sale it is ${Number(shareOfHeld) / 100}%, higher only because other wallets sold back.`
    );
    assert.isAtMost(Number(largestShare), Number(capShare));
    assert.isAtMost(Number(largest), Number(BigInt(cap.toString())));
  });

  async function claimFeesTx(
    role: "partner" | "creator",
    claimer: PublicKey
  ): Promise<Transaction> {
    const baseAta = getAssociatedTokenAddressSync(
      sale.baseMint,
      claimer,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const quoteAta = getAssociatedTokenAddressSync(
      sale.quoteMint,
      claimer,
      false,
      TOKEN_PROGRAM_ID
    );
    const pre = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      createAssociatedTokenAccountIdempotentInstruction(
        claimer,
        baseAta,
        claimer,
        sale.baseMint,
        TOKEN_2022_PROGRAM_ID
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        claimer,
        quoteAta,
        claimer,
        sale.quoteMint,
        TOKEN_PROGRAM_ID
      ),
    ];
    const shared = {
      poolAuthority: new PublicKey(
        "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"
      ),
      pool: sale.pool,
      tokenAAccount: baseAta,
      tokenBAccount: quoteAta,
      baseVault: sale.baseVault,
      quoteVault: sale.quoteVault,
      baseMint: sale.baseMint,
      quoteMint: sale.quoteMint,
      tokenBaseProgram: TOKEN_2022_PROGRAM_ID,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
    };
    const hook = hookAccounts(sale.baseMint, PANGU_PROGRAM_ID, claimer);

    if (role === "partner") {
      return dbcProgram.methods
        .claimTradingFee2(new BN(0), new BN("18446744073709551615"), hookAccountsInfo)
        .accountsPartial({
          ...shared,
          config: sale.config,
          feeClaimer: claimer,
        })
        .remainingAccounts(hook)
        .preInstructions(pre)
        .transaction();
    }
    return dbcProgram.methods
      .claimCreatorTradingFee2(
        new BN(0),
        new BN("18446744073709551615"),
        hookAccountsInfo
      )
      .accountsPartial({ ...shared, creator: claimer })
      .remainingAccounts(hook)
      .preInstructions(pre)
      .transaction();
  }

  async function createTokenAccount(
    owner: Keypair,
    mint: PublicKey,
    immutableOwner: boolean
  ): Promise<PublicKey> {
    const account = Keypair.generate();
    const extensions = immutableOwner
      ? [ExtensionType.ImmutableOwner, ExtensionType.TransferHookAccount]
      : [ExtensionType.TransferHookAccount];
    const space = getAccountLen(extensions);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: owner.publicKey,
        newAccountPubkey: account.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(space),
        space,
        programId: TOKEN_2022_PROGRAM_ID,
      })
    );
    if (immutableOwner) {
      tx.add(
        createInitializeImmutableOwnerInstruction(
          account.publicKey,
          TOKEN_2022_PROGRAM_ID
        )
      );
    }
    tx.add(
      createInitializeAccount3Instruction(
        account.publicKey,
        mint,
        owner.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await send(
      immutableOwner
        ? "open a second token account"
        : "open a token account whose owner can change",
      tx,
      owner,
      [owner, account]
    );
    return account.publicKey;
  }
});

