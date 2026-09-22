// Covers closing a buyer record: once the sale is over, and mid-sale when the
// record counts nothing.
// Does NOT cover: DBC's own graduation trade. The test clears the mint's hook the
// way DBC does, with a Token-2022 update signed by the hook authority.

import { assert } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  ACCESS_ISSUER_LIST,
  accountAt,
  approveBuyer,
  balanceOf,
  buy,
  buyerRecordPda,
  closeBuyerRecord,
  createTokenAccount,
  expectError,
  fund,
  graduate,
  mustSucceed,
  openBuyerRecord,
  readRecord,
  sell,
  setupSale,
} from "./sale-fixture";

describe("close_buyer_record", () => {
  it("refuses while the sale runs and the record still counts tokens", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 100n));

    expectError(await closeBuyerRecord(env, buyer), "SaleStillRunning");

    assert.isNotNull(
      await accountAt(env, buyerRecordPda(env.mint, buyer.publicKey))
    );
  });

  it("returns the rent once the hook is gone", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const record = buyerRecordPda(env.mint, buyer.publicKey);
    const rent = await balanceOf(env, record);
    const before = await balanceOf(env, buyer.publicKey);

    mustSucceed(await graduate(env));
    mustSucceed(await closeBuyerRecord(env, buyer));

    assert.isNull(await accountAt(env, record));
    assert.equal(await balanceOf(env, buyer.publicKey), before + rent);
  });

  it("closes a record at zero while the sale is still running", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const record = buyerRecordPda(env.mint, buyer.publicKey);
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 250n));
    mustSucceed(await sell(env, account, buyer, 250n));

    mustSucceed(await closeBuyerRecord(env, buyer));
    assert.isNull(await accountAt(env, record));

    // Opening it again gives a record the sale has never seen.
    mustSucceed(await openBuyerRecord(env, buyer));
    const reopened = await readRecord(env, buyer.publicKey);
    assert.equal(reopened.netBought.toString(), "0");
    assert.isFalse(reopened.approved);
  });

  it("makes a reopened record wait for the issuer again", async () => {
    const env = await setupSale({ cap: 1_000n, accessMode: ACCESS_ISSUER_LIST });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    mustSucceed(await approveBuyer(env, buyer.publicKey));
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 400n));
    mustSucceed(await sell(env, account, buyer, 400n));

    mustSucceed(await closeBuyerRecord(env, buyer));
    mustSucceed(await openBuyerRecord(env, buyer));

    // Closing and reopening is not a way around the issuer's list.
    expectError(await buy(env, account, 100n), "NotApproved");
    mustSucceed(await approveBuyer(env, buyer.publicKey));
    mustSucceed(await buy(env, account, 100n));
    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "100");
  });
});
