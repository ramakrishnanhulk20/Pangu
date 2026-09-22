// Covers the buy path of the hook: the per-wallet cap, the approved-buyer list, and
// the rule that tokens only leave the vault into an account with a fixed owner.
// Does NOT cover: sells (see sells.ts), wallet-to-wallet moves (see transfers.ts),
// price bands, or a buy routed through the real DBC swap instruction.

import { assert } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  ACCESS_ISSUER_LIST,
  approveBuyer,
  buy,
  createAssociatedTokenAccount,
  createTokenAccount,
  expectError,
  fund,
  mustSucceed,
  openBuyerRecord,
  readRecord,
  readRules,
  revokeBuyer,
  setupSale,
  tokenBalance,
} from "./sale-fixture";

describe("buys", () => {
  it("lets an open sale buy under the cap and counts it", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);

    const result = mustSucceed(await buy(env, account, 400n));
    console.log(
      `      compute units, buy through the hook: ${result.computeUnitsConsumed}`
    );

    assert.equal(await tokenBalance(env, account), 400n);
    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "400");
    const rules = await readRules(env);
    assert.equal(rules.buyers, 1);
    assert.equal(rules.totalNetBought.toString(), "400");
  });

  it("allows a buy that lands exactly on the cap", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);

    mustSucceed(await buy(env, account, 1_000n));

    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "1000");
  });

  it("refuses a buy one unit over the cap", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);

    expectError(await buy(env, account, 1_001n), "OverCap");
    assert.equal(await tokenBalance(env, account), 0n);
  });

  it("adds buys together, so two small ones cannot pass the cap", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);

    mustSucceed(await buy(env, account, 700n));
    expectError(await buy(env, account, 400n), "OverCap");

    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "700");
  });

  it("refuses a buyer who never opened a record", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    const account = await createTokenAccount(env, buyer.publicKey);

    expectError(await buy(env, account, 10n), "BuyerRecordMissing");
  });

  it("refuses an unapproved wallet when the issuer's list is in force", async () => {
    const env = await setupSale({
      cap: 1_000n,
      accessMode: ACCESS_ISSUER_LIST,
    });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);

    expectError(await buy(env, account, 10n), "NotApproved");
  });

  it("lets an approved wallet buy when the list is in force", async () => {
    const env = await setupSale({
      cap: 1_000n,
      accessMode: ACCESS_ISSUER_LIST,
    });
    const buyer = Keypair.generate();
    mustSucceed(await approveBuyer(env, buyer.publicKey));
    const account = await createTokenAccount(env, buyer.publicKey);

    mustSucceed(await buy(env, account, 250n));

    assert.equal(await tokenBalance(env, account), 250n);
  });

  it("stops a revoked wallet from buying again", async () => {
    const env = await setupSale({
      cap: 1_000n,
      accessMode: ACCESS_ISSUER_LIST,
    });
    const buyer = Keypair.generate();
    mustSucceed(await approveBuyer(env, buyer.publicKey));
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 100n));

    mustSucceed(await revokeBuyer(env, buyer.publicKey));

    expectError(await buy(env, account, 100n), "NotApproved");
  });

  it("lets a buy land in the buyer's associated token account", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const ata = await createAssociatedTokenAccount(env, buyer.publicKey);

    mustSucceed(await buy(env, ata, 300n));

    assert.equal(await tokenBalance(env, ata), 300n);
    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "300");
  });

  it("refuses a buy into an account whose owner can still change", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey, {
      immutableOwner: false,
    });

    expectError(await buy(env, account, 100n), "ReceivingAccountOwnerCanChange");

    assert.equal(await tokenBalance(env, account), 0n);
    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "0");
  });

  it("counts two token accounts of one wallet against one cap", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const first = await createTokenAccount(env, buyer.publicKey);
    const second = await createTokenAccount(env, buyer.publicKey);

    mustSucceed(await buy(env, first, 600n));
    expectError(await buy(env, second, 500n), "OverCap");
    mustSucceed(await buy(env, second, 400n));

    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "1000");
    assert.equal(await tokenBalance(env, first), 600n);
    assert.equal(await tokenBalance(env, second), 400n);
  });
});
