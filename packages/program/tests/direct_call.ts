// Covers the one thing that makes the counters worth anything: calling the hook
// outside a real transfer must change nothing.
// Does NOT cover: calls with malformed accounts, which Anchor rejects before the
// handler runs, or calls from another on-chain program, which arrive the same way.

import { assert } from "chai";
import { Keypair } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import {
  buy,
  buyerRecordPda,
  createTokenAccount,
  expectError,
  fund,
  mustSucceed,
  openBuyerRecord,
  readRecord,
  readRules,
  send,
  setupSale,
} from "./sale-fixture";

describe("direct call to the hook", () => {
  it("fails and moves no counter when nothing is being transferred", async () => {
    const env = await setupSale({ cap: 1_000n });
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    const account = await createTokenAccount(env, buyer.publicKey);
    mustSucceed(await buy(env, account, 400n));

    const ix = await env.program.methods
      .execute(new BN(1_000_000))
      .accountsPartial({
        sourceToken: env.vault,
        mint: env.mint,
        destinationToken: account,
        authority: env.poolAuthority.publicKey,
        extraAccountMetaList: env.extraMetas,
        rules: env.rules,
        destinationRecord: buyerRecordPda(env.mint, buyer.publicKey),
        sourceRecord: buyerRecordPda(env.mint, env.poolAuthority.publicKey),
      })
      .instruction();

    // No signer is needed: the hook takes the authority as a plain account, which
    // is the whole point of the check it is about to fail.
    expectError(await send(env, [ix]), "NotTransferring");

    const record = await readRecord(env, buyer.publicKey);
    assert.equal(record.netBought.toString(), "400");
    const rules = await readRules(env);
    assert.equal(rules.totalNetBought.toString(), "400");
  });
});
