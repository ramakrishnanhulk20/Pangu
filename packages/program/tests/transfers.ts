// Covers the rule that the token only moves between a wallet and the pool vault
// while the sale runs.
// Does NOT cover: what happens after graduation, when DBC has removed the hook and
// the token moves like any other Token-2022 token.

import { assert } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  buy,
  createTokenAccount,
  expectError,
  fund,
  mintTokens,
  mustSucceed,
  openBuyerRecord,
  setupSale,
  tokenBalance,
  transferTokens,
} from "./sale-fixture";

describe("transfers", () => {
  it("refuses a move from one wallet to another", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    const friend = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const from = await createTokenAccount(env, buyer.publicKey);
    const to = await createTokenAccount(env, friend.publicKey);
    mustSucceed(await buy(env, from, 500n));

    expectError(
      await transferTokens(env, from, to, buyer, 100n),
      "WalletToWalletDuringSale"
    );

    assert.equal(await tokenBalance(env, from), 500n);
    assert.equal(await tokenBalance(env, to), 0n);
  });

  it("refuses a move between two token accounts of the same wallet", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    const first = await createTokenAccount(env, buyer.publicKey);
    const second = await createTokenAccount(env, buyer.publicKey);
    await mintTokens(env, first, 300n);

    expectError(
      await transferTokens(env, first, second, buyer, 300n),
      "WalletToWalletDuringSale"
    );

    assert.equal(await tokenBalance(env, first), 300n);
    assert.equal(await tokenBalance(env, second), 0n);
  });
});
