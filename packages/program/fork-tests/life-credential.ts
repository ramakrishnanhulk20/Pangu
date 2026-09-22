// A Pangu sale that only lets wallets a named verifier has attested buy, run
// against the real Solana Attestation Service program copied from mainnet and
// Meteora's real Dynamic Bonding Curve.
//
// This is the test that proves the byte layouts Pangu reads by hand in
// programs/pangu/src/sas.rs match what the live program actually writes. Nothing
// here is crafted: every credential, schema and attestation is created by the
// service itself, through instructions built from its own source.
//
// Covers: opening a credential-mode sale in the same transaction as the pool, a
// buy by an attested wallet, the refusal of a wallet with no attestation, the
// refusal after a verifier revokes one, selling with no attestation at all, and
// the refusal of an attestation whose signing key the verifier has since taken
// off the credential.
//
// Does NOT cover: graduation and migration in this mode (life.ts covers those
// once and they do not touch the access rules), tokenized attestations, schema
// versioning, and what a real issuer such as Sumsub would put in the data blob.

import { assert } from "chai";
import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
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
  PANGU_PROGRAM_ID,
  SAS_PROGRAM_ID,
  SWAP_EXACT_OUT,
  Sale,
  airdrop,
  attestationPda,
  buildSwapTx,
  changeAuthorizedSignersIx,
  closeAttestationIx,
  connection,
  createAttestationIx,
  createCredentialIx,
  createSaleIx,
  createSchemaIx,
  credentialPda,
  expectPanguError,
  openBuyerRecordIx,
  readRecord,
  readRules,
  schemaPda,
  send,
  tokenBalance,
} from "./fork-sale";

const ACCESS_VERIFIER_CREDENTIAL = 2;
const TOKEN_NAME = "Pangu Verified Share";
const TOKEN_SYMBOL = "PVS";
const TOKEN_URI = "https://example.invalid/pvs.json";
const GRADUATION_SOL = 5;
/** Generous ceiling on what a buy may spend, in lamports. */
const MAX_SPEND = new BN(20 * 1_000_000_000);

const CREDENTIAL_NAME = "pangu-verifier";
const SCHEMA_NAME = "shareholder";
/** One u8 field. The service checks the blob against this layout byte for byte. */
const SCHEMA_LAYOUT = [0];
const SCHEMA_FIELDS = ["verified"];
const ATTESTATION_BLOB = Buffer.from([1]);

describe("a credential-gated Pangu sale against the real attestation service", () => {
  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");

  const partner = Keypair.generate();
  const creator = Keypair.generate();
  // The verifier runs the credential. Its first signing key attests buyer A, a
  // second one attests buyer B, and the second one is later taken away.
  const verifier = Keypair.generate();
  const firstSigner = Keypair.generate();
  const secondSigner = Keypair.generate();
  const buyerA = Keypair.generate();
  const buyerB = Keypair.generate();
  const config = Keypair.generate();
  const baseMintKeypair = Keypair.generate();

  const credential = credentialPda(verifier.publicKey, CREDENTIAL_NAME);
  const schema = schemaPda(credential, SCHEMA_NAME);

  let sale: Sale;
  let cap: BN;
  let swapBaseAmount: BN;
  let attestationA: PublicKey;

  before(async () => {
    for (const wallet of [
      partner,
      creator,
      verifier,
      firstSigner,
      secondSigner,
      buyerA,
      buyerB,
    ]) {
      await airdrop(wallet.publicKey, 100);
    }
  });

  it("a. the verifier opens a credential and a schema on the attestation service", async () => {
    const tx = new Transaction().add(
      createCredentialIx(
        verifier.publicKey,
        verifier.publicKey,
        CREDENTIAL_NAME,
        [firstSigner.publicKey, secondSigner.publicKey]
      ),
      createSchemaIx(
        verifier.publicKey,
        verifier.publicKey,
        credential,
        SCHEMA_NAME,
        "the wallet passed this verifier's checks",
        SCHEMA_LAYOUT,
        SCHEMA_FIELDS
      )
    );
    await send("create credential and schema", tx, verifier, [verifier]);

    const credentialAccount = await connection.getAccountInfo(credential);
    const schemaAccount = await connection.getAccountInfo(schema);
    assert.isNotNull(credentialAccount, "the credential was not created");
    assert.isNotNull(schemaAccount, "the schema was not created");
    assert.equal(credentialAccount!.owner.toBase58(), SAS_PROGRAM_ID.toBase58());
    assert.equal(credentialAccount!.data[0], 0, "not a credential account");
    assert.equal(schemaAccount!.data[0], 1, "not a schema account");
    console.log(
      `      credential ${credential.toBase58()}, schema ${schema.toBase58()}`
    );
  });

  it("b. the verifier attests buyer A, using A's wallet as the nonce", async () => {
    attestationA = attestationPda(credential, schema, buyerA.publicKey);
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 3600);
    const tx = new Transaction().add(
      createAttestationIx({
        payer: firstSigner.publicKey,
        authorizedSigner: firstSigner.publicKey,
        credential,
        schema,
        nonce: buyerA.publicKey,
        data: ATTESTATION_BLOB,
        expiry,
      })
    );
    await send("create attestation", tx, firstSigner, [firstSigner]);

    // The layout Pangu reads by hand, read the same way here against the bytes
    // the real program just wrote.
    const account = await connection.getAccountInfo(attestationA);
    assert.isNotNull(account, "the attestation was not created");
    const data = account!.data;
    assert.equal(data[0], 2, "not an attestation account");
    assert.equal(new PublicKey(data.subarray(1, 33)).toBase58(), buyerA.publicKey.toBase58());
    assert.equal(new PublicKey(data.subarray(33, 65)).toBase58(), credential.toBase58());
    assert.equal(new PublicKey(data.subarray(65, 97)).toBase58(), schema.toBase58());
    const blobLength = data.readUInt32LE(97);
    assert.equal(blobLength, ATTESTATION_BLOB.length);
    const signerAt = 101 + blobLength;
    assert.equal(
      new PublicKey(data.subarray(signerAt, signerAt + 32)).toBase58(),
      firstSigner.publicKey.toBase58()
    );
    assert.equal(data.readBigInt64LE(signerAt + 32), expiry);
    assert.equal(data.length, 173 + blobLength);
  });

  it("c. the creator opens the pool and a credential-mode sale in one transaction", async () => {
    const curve = buildCurve({
      token: {
        tokenType: TokenType.Token2022,
        tokenBaseDecimal: TokenDecimal.SIX,
        tokenQuoteDecimal: TokenDecimal.NINE,
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
      migrationQuoteThreshold: GRADUATION_SOL,
    });

    const configTx = await dbcClient.partner.createConfigWithTransferHook({
      config: config.publicKey,
      feeClaimer: partner.publicKey,
      leftoverReceiver: partner.publicKey,
      payer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      transferHookProgram: PANGU_PROGRAM_ID,
      ...curve,
    });
    await send("create config, credential mode", configTx, partner, [
      partner,
      config,
    ]);
    swapBaseAmount = (await dbcClient.state.getPoolConfig(config.publicKey))!
      .swapBaseAmount;
    cap = swapBaseAmount.divn(10);

    const baseMint = baseMintKeypair.publicKey;
    const pool = deriveDbcPoolAddress(NATIVE_MINT, baseMint, config.publicKey);
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
        ACCESS_VERIFIER_CREDENTIAL,
        { dbcConfig: config.publicKey, verifier: { credential, schema } }
      )
    );
    await send("create pool plus create_sale, credential mode", poolTx, creator, [
      creator,
      baseMintKeypair,
    ]);

    sale = {
      config: config.publicKey,
      pool,
      baseMint,
      quoteMint: NATIVE_MINT,
      baseVault: deriveDbcTokenVaultAddress(pool, baseMint),
      quoteVault: deriveDbcTokenVaultAddress(pool, NATIVE_MINT),
      quoteProgram: TOKEN_PROGRAM_ID,
      credential,
      schema,
    };

    const rules = await readRules(baseMint);
    assert.equal(rules.accessMode, ACCESS_VERIFIER_CREDENTIAL);
    assert.equal(rules.credential.toBase58(), credential.toBase58());
    assert.equal(rules.schema.toBase58(), schema.toBase58());
  });

  it("d. the attested buyer A buys", async () => {
    await openRecord(buyerA);

    const tx = await buildSwapTx({
      sale,
      owner: buyerA,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: cap.divn(2),
      amount1: MAX_SPEND,
    });
    await send("first buy, credential mode", tx, buyerA, [buyerA]);

    const record = await readRecord(sale.baseMint, buyerA.publicKey);
    assert.equal(record.netBought.toString(), cap.divn(2).toString());
  });

  it("e. buyer B, whom nobody attested, is refused", async () => {
    await openRecord(buyerB);

    const tx = await buildSwapTx({
      sale,
      owner: buyerB,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: cap.divn(4),
      amount1: MAX_SPEND,
    });
    await expectPanguError(tx, buyerB, [buyerB], "CredentialInvalid");
  });

  it("f. the verifier revokes A's attestation and A cannot buy again", async () => {
    const revoke = new Transaction().add(
      closeAttestationIx(
        firstSigner.publicKey,
        firstSigner.publicKey,
        credential,
        attestationA
      )
    );
    await send("close attestation", revoke, firstSigner, [firstSigner]);
    assert.isNull(
      await connection.getAccountInfo(attestationA),
      "revoking did not close the account"
    );

    const tx = await buildSwapTx({
      sale,
      owner: buyerA,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: cap.divn(4),
      amount1: MAX_SPEND,
    });
    await expectPanguError(tx, buyerA, [buyerA], "CredentialInvalid");
  });

  it("g. A can still sell everything back with no attestation at all", async () => {
    const before = await readRecord(sale.baseMint, buyerA.publicKey);
    const amount = new BN(before.netBought.toString());

    const tx = await buildSwapTx({
      sale,
      owner: buyerA,
      swapBaseForQuote: true,
      amount0: amount,
      amount1: new BN(0),
    });
    await send("sell, credential mode", tx, buyerA, [buyerA]);

    const after = await readRecord(sale.baseMint, buyerA.publicKey);
    assert.equal(after.netBought.toString(), "0");
    const ata = getAssociatedTokenAddressSync(
      sale.baseMint,
      buyerA.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    assert.equal(await tokenBalance(ata), 0n);
  });

  it("h. a second authorized signer attests B, and B buys", async () => {
    const tx = new Transaction().add(
      createAttestationIx({
        payer: secondSigner.publicKey,
        authorizedSigner: secondSigner.publicKey,
        credential,
        schema,
        nonce: buyerB.publicKey,
        data: ATTESTATION_BLOB,
        // Zero is the service's "never expires". Their own example code would
        // read it as expired, so this is the branch worth proving.
        expiry: 0n,
      })
    );
    await send("create attestation, second signer", tx, secondSigner, [
      secondSigner,
    ]);

    const buy = await buildSwapTx({
      sale,
      owner: buyerB,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: cap.divn(4),
      amount1: MAX_SPEND,
    });
    await send("buy, second signer's attestation", buy, buyerB, [buyerB]);

    const record = await readRecord(sale.baseMint, buyerB.publicKey);
    assert.equal(record.netBought.toString(), cap.divn(4).toString());
  });

  it("i. taking that signer off the credential stops B's next buy at once", async () => {
    const change = new Transaction().add(
      changeAuthorizedSignersIx(
        verifier.publicKey,
        verifier.publicKey,
        credential,
        [firstSigner.publicKey]
      )
    );
    await send("change authorized signers", change, verifier, [verifier]);

    // B's attestation is untouched and still says everything it said before.
    // The attestation service itself would still call it valid, because it only
    // ever checked the signer on the day it was issued.
    const account = await connection.getAccountInfo(
      attestationPda(credential, schema, buyerB.publicKey)
    );
    assert.isNotNull(account, "B's attestation was closed, which is not the test");
    const blobLength = account!.data.readUInt32LE(97);
    assert.equal(
      new PublicKey(
        account!.data.subarray(101 + blobLength, 133 + blobLength)
      ).toBase58(),
      secondSigner.publicKey.toBase58()
    );

    const tx = await buildSwapTx({
      sale,
      owner: buyerB,
      swapBaseForQuote: false,
      swapMode: SWAP_EXACT_OUT,
      amount0: cap.divn(4),
      amount1: MAX_SPEND,
    });
    await expectPanguError(
      tx,
      buyerB,
      [buyerB],
      "CredentialSignerNotAuthorized"
    );
  });

  it("j. B can still sell what it already holds", async () => {
    const before = await readRecord(sale.baseMint, buyerB.publicKey);
    const tx = await buildSwapTx({
      sale,
      owner: buyerB,
      swapBaseForQuote: true,
      amount0: new BN(before.netBought.toString()),
      amount1: new BN(0),
    });
    await send("sell after the signer was removed", tx, buyerB, [buyerB]);

    const after = await readRecord(sale.baseMint, buyerB.publicKey);
    assert.equal(after.netBought.toString(), "0");
  });

  async function openRecord(wallet: Keypair) {
    const tx = new Transaction().add(
      await openBuyerRecordIx(wallet.publicKey, sale.baseMint)
    );
    await send("open buyer record", tx, wallet, [wallet]);
  }
});
