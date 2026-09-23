// Covers the offering period: create_sale refusing an end that has already
// passed, every rule holding while the offering runs, every rule lifting once
// it has ended, and a buyer closing a record that still counts tokens after the
// end.
//
// The runtime's clock is moved forward by hand to reach the end, which is the
// only way to cross it inside one test run.
//
// Does NOT cover: a sale with no end, which is every other test file, and a
// real DBC swap after the end, which is the same transfer through the same hook
// with DBC's own accounts around it.

import { assert } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ACCESS_ISSUER_LIST,
  Env,
  approveBuyer,
  buy,
  closeBuyerRecord,
  createTokenAccount,
  eventsFrom,
  expectError,
  fund,
  mintTokens,
  mustSucceed,
  openBuyerRecord,
  readRecord,
  readRules,
  sell,
  sendCreateSale,
  setClock,
  setupEnv,
  tokenBalance,
  transferTokens,
} from "./sale-fixture";

const CAP = 1_000n;
const OFFERING_SECS = 3_600n;

interface OfferingSale {
  env: Env;
  endsAt: bigint;
  /** Approved, holding 500 tokens bought through the pool. */
  holder: Keypair;
  holderAccount: PublicKey;
  /** Never approved, with a record open and an empty token account. */
  outsider: Keypair;
  outsiderAccount: PublicKey;
}

async function chainNow(env: Env): Promise<bigint> {
  return (await env.client.getClock()).unixTimestamp;
}

/** Moves the runtime's clock to a given second, keeping the slot where it is. */
async function warpTo(env: Env, unixTimestamp: bigint) {
  const clock = await env.client.getClock();
  await setClock(env, clock.slot, unixTimestamp);
}

/** An issuer-list sale whose offering ends an hour from now, with one holder. */
async function offeringSale(): Promise<OfferingSale> {
  const env = await setupEnv();
  const endsAt = (await chainNow(env)) + OFFERING_SECS;
  mustSucceed(
    await sendCreateSale(env, {
      cap: CAP,
      accessMode: ACCESS_ISSUER_LIST,
      endsAt,
    })
  );
  await mintTokens(env, env.vault, 1_000_000n);

  const holder = Keypair.generate();
  fund(env, holder.publicKey);
  mustSucceed(await approveBuyer(env, holder.publicKey));
  const holderAccount = await createTokenAccount(env, holder.publicKey);
  mustSucceed(await buy(env, holderAccount, 500n));

  const outsider = Keypair.generate();
  fund(env, outsider.publicKey);
  mustSucceed(await openBuyerRecord(env, outsider));
  const outsiderAccount = await createTokenAccount(env, outsider.publicKey);

  return { env, endsAt, holder, holderAccount, outsider, outsiderAccount };
}

describe("the offering period", () => {
  it("is stored and announced at creation", async () => {
    const env = await setupEnv();
    const endsAt = (await chainNow(env)) + OFFERING_SECS;
    const meta = mustSucceed(await sendCreateSale(env, { endsAt }));

    assert.equal((await readRules(env)).endsAt.toString(), endsAt.toString());
    const created = eventsFrom(env, meta).find(
      (event) => event.name.toLowerCase() === "salecreated"
    );
    assert.isDefined(created, "no SaleCreated event");
    assert.equal(created!.data.endsAt.toString(), endsAt.toString());
    assert.isTrue(created!.data.quoteMint.equals(env.quoteMint));
  });

  it("refuses an end time that has already passed", async () => {
    const env = await setupEnv();
    const past = (await chainNow(env)) - 1n;
    expectError(await sendCreateSale(env, { endsAt: past }), "EndInThePast");
  });

  it("keeps every rule while the offering runs", async () => {
    const sale = await offeringSale();
    const { env } = sale;
    await warpTo(env, sale.endsAt - 1n);

    // An unapproved wallet buying past the cap.
    expectError(await buy(env, sale.outsiderAccount, CAP + 1n), "NotApproved");
    // One wallet handing tokens to another.
    expectError(
      await transferTokens(env, sale.holderAccount, sale.outsiderAccount, sale.holder, 10n),
      "WalletToWalletDuringSale"
    );
    // A sell goes through, as it always does, and lowers the holder's count.
    mustSucceed(await sell(env, sale.holderAccount, sale.holder, 100n));
    assert.equal((await readRecord(env, sale.holder.publicKey)).netBought.toString(), "400");
  });

  it("lifts every rule once the offering has ended, and counts nothing", async () => {
    const sale = await offeringSale();
    const { env } = sale;
    await warpTo(env, sale.endsAt);

    const bought = mustSucceed(await buy(env, sale.outsiderAccount, CAP + 1n));
    assert.equal(await tokenBalance(env, sale.outsiderAccount), CAP + 1n);

    // A wallet with no record at all, receiving from another wallet.
    const stranger = Keypair.generate();
    const strangerAccount = await createTokenAccount(env, stranger.publicKey);
    mustSucceed(
      await transferTokens(env, sale.holderAccount, strangerAccount, sale.holder, 10n)
    );
    assert.equal(await tokenBalance(env, strangerAccount), 10n);

    const sold = mustSucceed(await sell(env, sale.holderAccount, sale.holder, 100n));

    // The counters stay where the offering left them, and nothing is announced.
    assert.equal((await readRecord(env, sale.holder.publicKey)).netBought.toString(), "500");
    assert.equal((await readRecord(env, sale.outsider.publicKey)).netBought.toString(), "0");
    const rules = await readRules(env);
    assert.equal(rules.totalNetBought.toString(), "500");
    assert.equal(rules.buyers, 1);
    assert.deepEqual(eventsFrom(env, bought), []);
    assert.deepEqual(eventsFrom(env, sold), []);
  });

  it("lets a buyer close a record that still counts tokens once it has ended", async () => {
    const sale = await offeringSale();
    const { env } = sale;
    expectError(await closeBuyerRecord(env, sale.holder), "SaleStillRunning");

    await warpTo(env, sale.endsAt);
    mustSucceed(await closeBuyerRecord(env, sale.holder));
    assert.isNull(await readRecord(env, sale.holder.publicKey));
  });
});
