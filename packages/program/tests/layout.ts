// Covers the layout version byte on SaleRules: where it sits, what create_sale
// writes there, and what each instruction that reads the rules does when the
// byte is not this build's number.
//
// The byte is rewritten by hand here, because create_sale only ever writes the
// current version, so an account from another build cannot be made any other
// way inside one test run.
//
// Does NOT cover: an account from the real earlier build on devnet, a second
// version ever being added, or the SDK's own refusal, which is proven in
// packages/sdk/test/accounts.test.ts.

import { assert } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  ACCESS_ISSUER_LIST,
  RULES_LAYOUT_VERSION_OFFSET,
  accountAt,
  approveBuyer,
  buy,
  createTokenAccount,
  expectError,
  fund,
  mustSucceed,
  openBuyerRecord,
  readRecord,
  readRules,
  revokeBuyer,
  sell,
  setRulesLayoutVersion,
  setupSale,
  tokenBalance,
} from "./sale-fixture";

/** The eight byte discriminator plus SaleRules::INIT_SPACE, pinned in create_sale.rs. */
const RULES_ACCOUNT_LEN = 8 + 354;

describe("the SaleRules layout version", () => {
  it("writes version 1 at byte 298 without changing the account's size", async () => {
    const env = await setupSale({ cap: 1_000n });

    const account = await accountAt(env, env.rules);
    const bytes = Buffer.from(account!.data);
    // The version was carved out of the spare bytes on purpose. If the account
    // grew or the byte moved, an account written by either build would be read
    // by the other at the wrong offsets, which is the whole thing this stops.
    assert.equal(bytes.length, RULES_ACCOUNT_LEN);
    assert.equal(bytes.readUInt8(RULES_LAYOUT_VERSION_OFFSET), 1);
    assert.equal((await readRules(env)).layoutVersion, 1);
  });

  it("buys and sells as before on a sale this build opened", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);

    mustSucceed(await buy(env, account, 400n));
    mustSucceed(await sell(env, account, buyer, 100n));

    assert.equal(await tokenBalance(env, account), 300n);
    assert.equal((await readRecord(env, buyer.publicKey)).netBought.toString(), "300");
    assert.equal((await readRules(env)).totalNetBought.toString(), "300");
  });

  it("refuses a buy against rules from another layout", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);
    await setRulesLayoutVersion(env, 0);

    expectError(await buy(env, account, 100n), "WrongLayoutVersion");
    assert.equal(await tokenBalance(env, account), 0n);
  });

  it("still lets a holder sell when the rules are from another layout", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 800n));
    await setRulesLayoutVersion(env, 0);

    mustSucceed(await sell(env, account, buyer, 800n));

    // The exit never fails, and counters this build cannot trust are left where
    // they are rather than moved on a guess.
    assert.equal(await tokenBalance(env, account), 0n);
    assert.equal((await readRecord(env, buyer.publicKey)).netBought.toString(), "800");
    const rules = await readRules(env);
    assert.equal(rules.totalNetBought.toString(), "800");
    assert.equal(rules.buyers, 1);
    assert.equal(rules.layoutVersion, 0);
  });

  it("refuses an approval against rules from another layout", async () => {
    const env = await setupSale({ cap: 1_000n, accessMode: ACCESS_ISSUER_LIST });
    const buyer = Keypair.generate();
    await setRulesLayoutVersion(env, 0);

    expectError(await approveBuyer(env, buyer.publicKey), "WrongLayoutVersion");
  });

  it("refuses a revoke and a new buyer record against rules from another layout", async () => {
    const env = await setupSale({ cap: 1_000n, accessMode: ACCESS_ISSUER_LIST });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await approveBuyer(env, buyer.publicKey));
    await setRulesLayoutVersion(env, 0);

    expectError(await revokeBuyer(env, buyer.publicKey), "WrongLayoutVersion");
    expectError(await openBuyerRecord(env, buyer), "WrongLayoutVersion");
  });
});
