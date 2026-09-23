// Covers opening a sale and every reason opening one is refused.
// Does NOT cover: the verifier-credential mode (see credential.ts), price bands, a
// real DBC pool account (the pool here is a stand-in with the same owner, length,
// discriminator and field offsets), or what happens to a sale after graduation.
// The launch template is a stand-in too, except in the test that reads a
// template dumped from mainnet and compares the program's offsets with Meteora's
// own decoding of the same bytes. The freeze rule is proven for the issuer's own
// key only; an authority held by another wallet the issuer controls is a named
// non-goal in the threat model.

import * as fs from "fs";
import * as path from "path";
import { assert } from "chai";
import { BorshAccountsCoder } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveIdl } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ACCESS_ISSUER_LIST,
  ACCESS_OPEN,
  ACCESS_VERIFIER_CREDENTIAL,
  COLLECT_FEE_MODE_OUTPUT_TOKEN,
  COLLECT_FEE_MODE_QUOTE_TOKEN,
  CONFIG_COLLECT_FEE_MODE_OFFSET,
  CONFIG_SWAP_BASE_AMOUNT_OFFSET,
  HOOK_CONFIG_DISCRIMINATOR,
  HOOK_CONFIG_LEN,
  accountAt,
  expectError,
  expectFailure,
  fund,
  mustSucceed,
  placeDbcConfig,
  readRules,
  sendCreateSale,
  setupEnv,
} from "./sale-fixture";

describe("create_sale", () => {
  it("stores every rule and publishes the hook's account list", async () => {
    const env = await setupEnv();
    const result = mustSucceed(
      await sendCreateSale(env, { cap: 5_000n, accessMode: ACCESS_ISSUER_LIST })
    );
    console.log(
      `      compute units, create_sale: ${result.computeUnitsConsumed}`
    );

    const rules = await readRules(env);
    assert.isTrue(rules.mint.equals(env.mint));
    assert.isTrue(rules.pool.equals(env.pool));
    assert.isTrue(rules.baseVault.equals(env.vault));
    assert.isTrue(rules.issuer.equals(env.issuer.publicKey));
    assert.equal(rules.cap.toString(), "5000");
    assert.equal(rules.accessMode, ACCESS_ISSUER_LIST);
    assert.isTrue(rules.credential.equals(PublicKey.default));
    assert.isTrue(rules.schema.equals(PublicKey.default));
    assert.equal(rules.bandBps, 0);
    assert.isTrue(rules.priceAccount.equals(PublicKey.default));
    assert.equal(rules.priceShard, 0);
    assert.equal(rules.maxPriceAgeSecs, 0);
    assert.equal(rules.maxConfBps, 0);
    assert.equal(rules.baseDecimals, 0);
    assert.equal(rules.quoteDecimals, 0);
    assert.equal(rules.buyers, 0);
    assert.equal(rules.totalNetBought.toString(), "0");
    assert.isTrue(rules.quoteMint.equals(env.quoteMint), "the paying token was not stored");
    assert.equal(rules.endsAt.toString(), "0");

    const metas = await accountAt(env, env.extraMetas);
    assert.isNotNull(metas, "the extra account meta list was not created");
  });

  it("refuses a signer who did not create the pool", async () => {
    const env = await setupEnv();
    const stranger = Keypair.generate();
    fund(env, stranger.publicKey);
    expectError(
      await sendCreateSale(env, { signer: stranger }),
      "NotPoolCreator"
    );
  });

  it("refuses a pool account that is not owned by DBC", async () => {
    const env = await setupEnv({ poolOwner: Keypair.generate().publicKey });
    expectError(await sendCreateSale(env), "NotAHookPool");
  });

  it("refuses a pool account with the wrong discriminator", async () => {
    const env = await setupEnv({
      poolDiscriminator: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
    });
    expectError(await sendCreateSale(env), "NotAHookPool");
  });

  it("refuses a pool that sells a different token", async () => {
    const env = await setupEnv({ poolBaseMint: Keypair.generate().publicKey });
    expectError(await sendCreateSale(env), "WrongMint");
  });

  it("refuses a pool whose vault is not DBC's own address", async () => {
    const env = await setupEnv({ poolBaseVault: Keypair.generate().publicKey });
    expectError(await sendCreateSale(env), "NotAHookPool");
  });

  it("refuses a mint whose transfer hook is another program", async () => {
    const env = await setupEnv({ hookProgram: Keypair.generate().publicKey });
    expectError(await sendCreateSale(env), "HookProgramMismatch");
  });

  it("refuses a mint that can still be minted", async () => {
    const env = await setupEnv({ keepMintAuthority: true });
    expectError(await sendCreateSale(env), "MintAuthorityStillSet");
  });

  it("refuses a launch template that is not this pool's", async () => {
    const env = await setupEnv();
    const stranger = Keypair.generate().publicKey;
    placeDbcConfig(env, stranger, PublicKey.default);
    expectError(
      await sendCreateSale(env, { dbcConfigAccount: stranger }),
      "WrongLaunchTemplate"
    );
  });

  it("refuses a template that collects fees in the sale token", async () => {
    // With fees taken on the output side the pool pays them in the token being
    // sold, which moves the sale token through the hook on a path the cap was
    // never written for.
    const env = await setupEnv({
      collectFeeMode: COLLECT_FEE_MODE_OUTPUT_TOKEN,
    });
    expectError(await sendCreateSale(env), "FeesNotInQuoteToken");
  });

  it("opens on a template that collects fees in the paying token", async () => {
    const env = await setupEnv({ collectFeeMode: COLLECT_FEE_MODE_QUOTE_TOKEN });
    mustSucceed(await sendCreateSale(env));
  });

  it("refuses a paying token that is not the one the template names", async () => {
    const env = await setupEnv();
    const other = await setupEnv();
    expectError(
      await sendCreateSale(env, { quoteMintAccount: other.quoteMint }),
      "WrongMint"
    );
  });

  it("refuses a paying token the issuer can freeze", async () => {
    // A frozen pool vault or seller account cannot be paid, which would turn the
    // always-open exit into a switch the issuer holds.
    const env = await setupEnv({ quoteFreezeAuthority: "issuer" });
    expectError(await sendCreateSale(env), "IssuerControlsPayingToken");
    assert.isNull(await accountAt(env, env.rules), "rules were written anyway");
  });

  it("opens on the same kind of paying token with no freeze authority", async () => {
    const env = await setupEnv({ quoteFreezeAuthority: null });
    mustSucceed(await sendCreateSale(env));
    assert.isTrue((await readRules(env)).quoteMint.equals(env.quoteMint));
  });

  it("refuses a cap equal to everything the curve sells", async () => {
    const env = await setupEnv({ curveSupply: 5_000n });
    expectError(await sendCreateSale(env, { cap: 5_000n }), "CapCoversWholeSale");
  });

  it("opens with a cap one unit below what the curve sells", async () => {
    const env = await setupEnv({ curveSupply: 5_000n });
    mustSucceed(await sendCreateSale(env, { cap: 4_999n }));
    assert.equal((await readRules(env)).cap.toString(), "4999");
  });

  it("refuses a cap of zero", async () => {
    const env = await setupEnv();
    expectError(await sendCreateSale(env, { cap: 0n }), "ZeroCap");
  });

  it("refuses an access mode that does not exist", async () => {
    const env = await setupEnv();
    expectError(
      await sendCreateSale(env, { accessMode: ACCESS_VERIFIER_CREDENTIAL + 1 }),
      "InvalidAccessMode"
    );
  });

  it("refuses a band that names no price feed", async () => {
    const env = await setupEnv();
    expectError(
      await sendCreateSale(env, { band: { bandBps: 100 } }),
      "InvalidBand"
    );
  });

  it("reads the same launch template the Meteora SDK does", () => {
    // Real bytes from mainnet, saved by hand with `solana account`. The program
    // reads one byte at a fixed offset; Meteora's own IDL reads the whole struct.
    // If the two ever disagree, the offset is wrong.
    const bytes = fs.readFileSync(
      path.join(__dirname, "..", "feeds", "live-config.bin")
    );
    assert.equal(bytes.length, HOOK_CONFIG_LEN);
    assert.isTrue(bytes.subarray(0, 8).equals(HOOK_CONFIG_DISCRIMINATOR));

    const coder = new BorshAccountsCoder(DynamicBondingCurveIdl as any);
    const decoded = coder.decode("ConfigWithTransferHook", bytes).config;
    assert.equal(
      bytes.readUInt8(CONFIG_COLLECT_FEE_MODE_OFFSET),
      decoded.collect_fee_mode
    );
    assert.equal(decoded.collect_fee_mode, COLLECT_FEE_MODE_QUOTE_TOKEN);
    assert.isTrue(
      new PublicKey(bytes.subarray(8, 40)).equals(decoded.quote_mint)
    );
    // The cap is held under the curve's own supply, read at this offset.
    assert.equal(
      bytes.readBigUInt64LE(CONFIG_SWAP_BASE_AMOUNT_OFFSET).toString(),
      decoded.swap_base_amount.toString()
    );
  });

  it("cannot be run twice for the same mint", async () => {
    const env = await setupEnv();
    mustSucceed(
      await sendCreateSale(env, { cap: 5_000n, accessMode: ACCESS_OPEN })
    );

    expectFailure(await sendCreateSale(env, { cap: 1n }));

    const rules = await readRules(env);
    assert.equal(rules.cap.toString(), "5000", "the first rules were replaced");
  });
});
