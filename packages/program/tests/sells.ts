// Covers the sell path: selling back to the pool vault always works.
// Does NOT cover: buys (see buys.ts), what DBC pays the seller, or the price the
// seller gets. Pangu never touches money, only the count of tokens bought.

import { assert } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  ACCESS_ISSUER_LIST,
  approveBuyer,
  buy,
  createTokenAccount,
  fund,
  mintTokens,
  mustSucceed,
  openBuyerRecord,
  readRecord,
  readRules,
  revokeBuyer,
  sell,
  setupSale,
  tokenBalance,
} from "./sale-fixture";

describe("sells", () => {
  it("lowers the record when a holder sells back", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 800n));

    const result = mustSucceed(await sell(env, account, buyer, 300n));
    console.log(
      `      compute units, sell through the hook: ${result.computeUnitsConsumed}`
    );

    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "500");
    assert.equal(await tokenBalance(env, account), 500n);
    const rules = await readRules(env);
    assert.equal(rules.totalNetBought.toString(), "500");
    assert.equal(rules.buyers, 1);
  });

  it("lets a revoked wallet sell everything it holds", async () => {
    const env = await setupSale({
      cap: 1_000n,
      accessMode: ACCESS_ISSUER_LIST,
    });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await approveBuyer(env, buyer.publicKey));
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 600n));
    mustSucceed(await revokeBuyer(env, buyer.publicKey));

    mustSucceed(await sell(env, account, buyer, 600n));

    assert.equal(await tokenBalance(env, account), 0n);
    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "0");
  });

  it("lets a wallet with no record at all sell", async () => {
    const env = await setupSale({ cap: 1_000n });
    const holder = Keypair.generate();
    fund(env, holder.publicKey);
    const account = await createTokenAccount(env, holder.publicKey);
    await mintTokens(env, account, 250n);

    mustSucceed(await sell(env, account, holder, 250n));

    assert.equal(await tokenBalance(env, account), 0n);
    assert.isNull(await readRecord(env, holder.publicKey));
  });

  it("lets a holder sell from an account whose owner can still change", async () => {
    const env = await setupSale({ cap: 1_000n });
    const holder = Keypair.generate();
    fund(env, holder.publicKey);
    const account = await createTokenAccount(env, holder.publicKey, {
      immutableOwner: false,
    });
    await mintTokens(env, account, 400n);

    mustSucceed(await sell(env, account, holder, 400n));

    assert.equal(await tokenBalance(env, account), 0n);
  });

  it("floors the record at zero when the sell is larger than it", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 100n));
    await mintTokens(env, account, 900n);

    mustSucceed(await sell(env, account, buyer, 1_000n));

    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "0");
    const rules = await readRules(env);
    assert.equal(rules.totalNetBought.toString(), "0");
  });

  it("takes a wallet off the buyer count when its record returns to zero", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 500n));
    assert.equal((await readRules(env)).buyers, 1);

    mustSucceed(await sell(env, account, buyer, 500n));

    assert.equal((await readRules(env)).buyers, 0);
  });
});
