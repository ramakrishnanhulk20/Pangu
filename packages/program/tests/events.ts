// Covers the two events an indexer or the app reads to follow a sale.
// Does NOT cover: the admin events, which carry only the mint and the wallet, or
// event ordering across several transfers in one transaction.

import { assert } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  buy,
  createTokenAccount,
  eventNamed,
  eventsFrom,
  fund,
  mustSucceed,
  openBuyerRecord,
  sell,
  setupSale,
} from "./sale-fixture";

describe("events", () => {
  it("reports the wallet, the amount and the running total on a buy", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);

    const result = mustSucceed(await buy(env, account, 250n));

    const bought = eventNamed(eventsFrom(env, result), "bought");
    assert.isTrue(bought.wallet.equals(buyer.publicKey));
    assert.equal(bought.amount.toString(), "250");
    assert.equal(bought.netBought.toString(), "250");
  });

  it("reports the wallet, the amount and the running total on a sell", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 250n));

    const result = mustSucceed(await sell(env, account, buyer, 100n));

    const sold = eventNamed(eventsFrom(env, result), "soldBack");
    assert.isTrue(sold.wallet.equals(buyer.publicKey));
    assert.equal(sold.amount.toString(), "100");
    assert.equal(sold.netBought.toString(), "150");
  });
});
