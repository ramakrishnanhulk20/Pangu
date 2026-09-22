// Covers who may change the approved-buyer list and what approving does not touch.
// Does NOT cover: how an issuer decides who to approve, which is a business choice
// the program deliberately does not judge, or approvals in modes other than 1.

import { assert } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  ACCESS_ISSUER_LIST,
  approveBuyer,
  buy,
  createTokenAccount,
  expectError,
  fund,
  mustSucceed,
  readRecord,
  setupSale,
} from "./sale-fixture";

describe("approvals", () => {
  it("refuses anyone but the issuer", async () => {
    const env = await setupSale({
      cap: 1_000n,
      accessMode: ACCESS_ISSUER_LIST,
    });
    const stranger = Keypair.generate();
    fund(env, stranger.publicKey);
    const buyer = Keypair.generate();

    expectError(
      await approveBuyer(env, buyer.publicKey, stranger),
      "NotIssuer"
    );

    assert.isNull(await readRecord(env, buyer.publicKey));
  });

  it("keeps what a wallet already bought when it is approved again", async () => {
    const env = await setupSale({
      cap: 1_000n,
      accessMode: ACCESS_ISSUER_LIST,
    });
    const buyer = Keypair.generate();
    mustSucceed(await approveBuyer(env, buyer.publicKey));
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 300n));

    mustSucceed(await approveBuyer(env, buyer.publicKey));

    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "300");
    assert.isTrue(record.approved);
  });
});
