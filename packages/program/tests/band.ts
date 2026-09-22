// Covers the price band: opening a banded sale, and every reason a buy through
// one is allowed or refused.
//
// Pyth's receiver program is not loaded here. Its accounts are written byte for
// byte at the one address they can live at, which is the only way to aim a stale,
// short, partly verified or contradictory price at the hook. Whether those bytes
// match what the live program writes was proven against Pyth's real mainnet
// account, written up in docs/measurements/price-band-pyth.md, and the band is
// run end to end against a real DBC swap in fork-tests/life-band.ts.
//
// Does NOT cover: the Wormhole guardian signatures themselves. Pangu does not
// re-verify them. It relies on the account being a program address only Pyth's
// price feed program can create, owned by a receiver program that checks those
// signatures before it writes, and on the update saying `Full` rather than
// `Partial`. The measurements file says what that leaves unproven.

import { assert } from "chai";
import { Decimal } from "decimal.js";
import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getExtraAccountMetas } from "@solana/spl-token";
import {
  TokenDecimal,
  getPriceFromSqrtPrice,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ACCESS_ISSUER_LIST,
  ACCESS_VERIFIER_CREDENTIAL,
  BandArgs,
  Env,
  SQRT_PRICE_ONE,
  accountAt,
  approveBuyer,
  attest,
  buy,
  createPlainMint,
  createTokenAccount,
  expectError,
  expectFailure,
  fund,
  mintTokens,
  mustSucceed,
  openBuyerRecord,
  placeVerifier,
  readRules,
  sell,
  sendCreateSale,
  setClock,
  setPoolSqrtPrice,
  setupEnv,
  tokenBalance,
  writePriceUpdate,
} from "./sale-fixture";
import {
  PANGU_SHARD_ID,
  dollarsAtExponent,
  feedId,
  priceFeedAddress,
  PRICE_SCALE,
} from "./quote";

const PRICE_FEED = feedId(1);
const OTHER_FEED = feedId(99);

/** DBC's own limit, from constants.rs. */
const MAX_SQRT_PRICE = 79_226_673_521_066_979_257_578_248_091n;

/** US equities come off Pyth at this exponent. */
const EQUITY_EXPONENT = -5;
const MAX_AGE_SECS = 120;
/** One percent, which is wide for a liquid stock and tight enough to test. */
const MAX_CONF_BPS = 100;
const CAP = 1_000_000n;

/** A chosen "now" well clear of the epoch, and a slot well clear of zero. */
const NOW = 1_789_761_602n;
let slotCursor = 5_000_000n;

describe("create_sale with a price band", () => {
  it("stores the band and publishes the mode's accounts plus two", async () => {
    const { env, priceAccount } = await bandedSale({
      accessMode: ACCESS_ISSUER_LIST,
    });

    const rules = await readRules(env);
    assert.equal(rules.bandBps, 500);
    assert.isTrue(rules.priceAccount.equals(priceAccount));
    assert.deepEqual(Array.from(rules.priceFeedId), PRICE_FEED);
    assert.equal(rules.priceShard, PANGU_SHARD_ID);
    assert.equal(rules.maxPriceAgeSecs, MAX_AGE_SECS);
    assert.equal(rules.maxConfBps, MAX_CONF_BPS);
    assert.equal(rules.baseDecimals, 6);
    assert.equal(rules.quoteDecimals, 6);

    assert.equal(await extraAccountCount(env), 5);
  });

  it("publishes eight accounts when the band runs on top of a credential, and a buy still works", async () => {
    const env = await setupEnv({ quoteDecimals: 6 });
    const verifier = placeVerifier(env);
    const settings = band();
    mustSucceed(
      await sendCreateSale(env, {
        cap: CAP,
        accessMode: ACCESS_VERIFIER_CREDENTIAL,
        credential: verifier.credential,
        schema: verifier.schema,
        band: settings,
      })
    );

    assert.equal(await extraAccountCount(env), 8);

    // The worst case a sale can carry: a verifier's credential and a band, so
    // the hook reads an attestation and a Pyth price on the same buy.
    await mintTokens(env, env.vault, 10_000n);
    const buyer = Keypair.generate();
    fund(env, buyer.publicKey);
    mustSucceed(await openBuyerRecord(env, buyer));
    attest(env, verifier, buyer.publicKey);
    const account = await createTokenAccount(env, buyer.publicKey);

    const sale: BandedSale = {
      env,
      buyer,
      account,
      priceAccount: settings.priceAccount!,
    };
    await refresh(sale, { dollars: 2n * PRICE_SCALE });

    const result = mustSucceed(await buyFrom(sale, 400n));
    console.log(
      `      compute units, buy with a credential and a band: ${result.computeUnitsConsumed}`
    );
    assert.equal(await tokenBalance(env, account), 400n);
  });

  it("refuses a price account that is not the one this shard and feed produce", async () => {
    const env = await setupEnv({ quoteDecimals: 6 });
    expectError(
      await sendCreateSale(env, {
        band: { ...band(), priceAccount: Keypair.generate().publicKey },
      }),
      "WrongPriceAccount"
    );
  });

  it("refuses a price account derived under a different shard", async () => {
    // The address is the whole promise: it binds the sale to one feed on one
    // shard. A rules account naming a real Pyth account from another shard would
    // read a price nobody in this sale is refreshing.
    const env = await setupEnv({ quoteDecimals: 6 });
    expectError(
      await sendCreateSale(env, {
        band: {
          ...band(),
          priceAccount: priceFeedAddress(0, PRICE_FEED),
        },
      }),
      "WrongPriceAccount"
    );
  });

  it("refuses a price account derived from another feed id", async () => {
    // Same shard, real Pyth account, wrong stock. Deriving the address in the
    // program is what makes naming another asset's price impossible.
    const env = await setupEnv({ quoteDecimals: 6 });
    expectError(
      await sendCreateSale(env, {
        band: {
          ...band(),
          priceAccount: priceFeedAddress(PANGU_SHARD_ID, OTHER_FEED),
        },
      }),
      "WrongPriceAccount"
    );
  });

  it("refuses a band whose feed id is zero", async () => {
    const env = await setupEnv({ quoteDecimals: 6 });
    const zero = Array.from({ length: 32 }, () => 0);
    expectError(
      await sendCreateSale(env, {
        band: {
          ...band(),
          priceFeedId: zero,
          priceAccount: priceFeedAddress(PANGU_SHARD_ID, zero),
        },
      }),
      "InvalidBand"
    );
  });

  it("refuses a price age of zero seconds and of more than an hour", async () => {
    const env = await setupEnv({ quoteDecimals: 6 });
    expectError(
      await sendCreateSale(env, { band: { ...band(), maxPriceAgeSecs: 0 } }),
      "InvalidBand"
    );
    expectError(
      await sendCreateSale(env, { band: { ...band(), maxPriceAgeSecs: 3_601 } }),
      "InvalidBand"
    );
    mustSucceed(
      await sendCreateSale(env, { band: { ...band(), maxPriceAgeSecs: 3_600 } })
    );
  });

  it("refuses a confidence limit of zero and of more than ten percent", async () => {
    const env = await setupEnv({ quoteDecimals: 6 });
    expectError(
      await sendCreateSale(env, { band: { ...band(), maxConfBps: 0 } }),
      "InvalidBand"
    );
    expectError(
      await sendCreateSale(env, { band: { ...band(), maxConfBps: 1_001 } }),
      "InvalidBand"
    );
    mustSucceed(
      await sendCreateSale(env, { band: { ...band(), maxConfBps: 1_000 } })
    );
  });

  it("refuses a band wider than fifty percent", async () => {
    const env = await setupEnv({ quoteDecimals: 6 });
    expectError(
      await sendCreateSale(env, { band: { ...band(), bandBps: 5_001 } }),
      "InvalidBand"
    );
    mustSucceed(
      await sendCreateSale(env, { band: { ...band(), bandBps: 5_000 } })
    );
  });

  it("refuses a paying token the template does not name", async () => {
    const env = await setupEnv({ quoteDecimals: 6 });
    // A real mint, with the decimals an attacker would want the band to use, but
    // not the token this pool's template says buyers pay in.
    const imposter = await createPlainMint(env, 9);
    expectError(
      await sendCreateSale(env, {
        band: band(),
        quoteMintAccount: imposter,
      }),
      "InvalidBand"
    );
  });

  it("refuses band settings on a sale that has no band", async () => {
    const env = await setupEnv({ quoteDecimals: 6 });
    expectError(
      await sendCreateSale(env, { band: { ...band(), bandBps: 0 } }),
      "InvalidBand"
    );
  });

  it("keeps the pool at byte 40, the price account at 209 and the feed id at 241", async () => {
    // The band's extra accounts are fixed addresses, but the app and the SDK both
    // read these fields straight out of the account, and the credential seeds a
    // few bytes earlier can never move. This is the test that stops a silent
    // reshuffle landing.
    const { env, priceAccount } = await bandedSale({});
    const bytes = Buffer.from((await accountAt(env, env.rules))!.data);
    assert.isTrue(new PublicKey(bytes.subarray(40, 72)).equals(env.pool));
    assert.isTrue(new PublicKey(bytes.subarray(209, 241)).equals(priceAccount));
    assert.deepEqual(Array.from(bytes.subarray(241, 273)), PRICE_FEED);
    assert.equal(bytes.readUInt16LE(273), PANGU_SHARD_ID);
    assert.equal(bytes.length, 8 + 354);
  });
});

describe("buys inside a price band", () => {
  it("passes when the curve price sits under the ceiling", async () => {
    const sale = await bandedSale({});
    // A one to one curve on six and six decimals is a dollar a token, and the
    // stock is at two dollars.
    await refresh(sale, { dollars: 2n * PRICE_SCALE });

    const result = mustSucceed(await buyFrom(sale, 400n));
    console.log(
      `      compute units, buy through a banded hook: ${result.computeUnitsConsumed}`
    );
    assert.equal(await tokenBalance(sale.env, sale.account), 400n);
  });

  it("passes when the curve price lands exactly on the ceiling", async () => {
    const sale = await bandedSale({});
    const curve = curveCeiling(SQRT_PRICE_ONE, 6, 6);
    const dollars = stockPriceOnTheCeiling(curve, 500);
    assert.equal(
      bandCeiling(dollars, 500).toString(),
      curve.toString(),
      "this stock price does not put the curve exactly on the ceiling"
    );

    await refresh(sale, { dollars, exponent: -18 });
    mustSucceed(await buyFrom(sale, 400n));
  });

  it("refuses a buy one unit of price above the ceiling", async () => {
    const sale = await bandedSale({});
    const curve = curveCeiling(SQRT_PRICE_ONE, 6, 6);
    const dollars = stockPriceOnTheCeiling(curve, 500) - 1n;
    assert.isTrue(bandCeiling(dollars, 500) < curve);

    await refresh(sale, { dollars, exponent: -18 });
    expectError(await buyFrom(sale, 400n), "PriceOutsideBand");
  });

  it("never refuses a buy far below the stock price", async () => {
    const sale = await bandedSale({});
    await refresh(sale, { dollars: 10_000n * PRICE_SCALE });
    mustSucceed(await buyFrom(sale, 400n));
  });

  it("refuses a price one second older than the sale allows", async () => {
    const sale = await bandedSale({});
    await refresh(sale, { dollars: 2n * PRICE_SCALE, ageSecs: MAX_AGE_SECS });
    mustSucceed(await buyFrom(sale, 100n));

    await refresh(sale, { dollars: 2n * PRICE_SCALE, ageSecs: MAX_AGE_SECS + 1 });
    expectError(await buyFrom(sale, 100n), "PriceStale");
  });

  it("refuses a price published further ahead than a minute", async () => {
    const sale = await bandedSale({});
    // A publisher whose clock is a minute fast is tolerated. An hour is a broken
    // feed that would otherwise hold a sale open forever.
    await refresh(sale, { dollars: 2n * PRICE_SCALE, ageSecs: -60 });
    mustSucceed(await buyFrom(sale, 100n));

    await refresh(sale, { dollars: 2n * PRICE_SCALE, ageSecs: -3_600 });
    expectError(await buyFrom(sale, 100n), "PriceStale");
  });

  it("refuses a price account owned by another program", async () => {
    const sale = await bandedSale({});
    await refresh(sale, {
      dollars: 2n * PRICE_SCALE,
      owner: Keypair.generate().publicKey,
    });
    expectError(await buyFrom(sale, 100n), "WrongPriceAccount");
  });

  it("refuses a real looking price for a different feed at the expected address", async () => {
    const sale = await bandedSale({});
    await refresh(sale, { dollars: 2n * PRICE_SCALE, feed: OTHER_FEED });
    expectError(await buyFrom(sale, 100n), "WrongPriceAccount");
  });

  it("refuses an update only part of the guardians signed", async () => {
    const sale = await bandedSale({});
    await refresh(sale, {
      dollars: 2n * PRICE_SCALE,
      partialSignatures: 5,
    });
    expectError(await buyFrom(sale, 100n), "PriceNotFullyVerified");
  });

  it("refuses a confidence interval wider than the sale accepts", async () => {
    const sale = await bandedSale({});
    // One percent exactly passes a one percent limit.
    await refresh(sale, { dollars: 2n * PRICE_SCALE, confBps: 100 });
    mustSucceed(await buyFrom(sale, 100n));

    // Five percent does not. Pyth is saying its publishers do not agree, and a
    // ceiling measured against a number nobody agrees on is not a ceiling.
    await refresh(sale, { dollars: 2n * PRICE_SCALE, confBps: 500 });
    expectError(await buyFrom(sale, 100n), "PriceTooUncertain");
  });

  it("refuses a stock price of zero or below", async () => {
    const sale = await bandedSale({});
    await refresh(sale, { dollars: 0n });
    expectError(await buyFrom(sale, 100n), "PriceStale");

    await refresh(sale, { dollars: -2n * PRICE_SCALE });
    expectError(await buyFrom(sale, 100n), "PriceStale");
  });

  it("refuses bytes that are not a price update at all", async () => {
    const sale = await bandedSale({});
    await refresh(sale, {
      dollars: 2n * PRICE_SCALE,
      discriminator: Buffer.alloc(8),
    });
    expectError(await buyFrom(sale, 100n), "WrongPriceAccount");
  });

  it("refuses a truncated price account without crashing", async () => {
    const sale = await bandedSale({});
    // A fully verified update needs 133 bytes, so 132 is the last cut that must
    // fail. Pyth allocates 134, the width a partly verified one would need.
    for (const truncateTo of [0, 7, 41, 72, 132]) {
      await refresh(sale, { dollars: 2n * PRICE_SCALE, truncateTo });
      expectError(await buyFrom(sale, 100n), "WrongPriceAccount");
    }
  });

  it("refuses an exponent no dollar price can be carried at", async () => {
    const sale = await bandedSale({});
    // A positive exponent means a price quantised coarser than a dollar, so 30
    // here would mean three hundred dollars with no cents at all.
    await refresh(sale, { dollars: 0n, rawPrice: 30n, exponent: 1 });
    expectError(await buyFrom(sale, 100n), "WrongPriceAccount");

    // Finer than the band's own 1e18 scale, so the number could not be carried.
    await refresh(sale, {
      dollars: 0n,
      rawPrice: 30_592_000_000_000n,
      exponent: -19,
    });
    expectError(await buyFrom(sale, 100n), "WrongPriceAccount");
  });

  it("refuses a price account nobody has ever refreshed", async () => {
    // Before the first refresh the address holds nothing at all. A sale opened
    // ahead of its first refresh refuses buys rather than reading empty bytes.
    const sale = await bandedSale({});
    sale.env.ctx.setAccount(sale.priceAccount, {
      lamports: 0,
      data: Buffer.alloc(0),
      owner: PublicKey.default,
      executable: false,
      rentEpoch: 0,
    });
    expectError(await buyFrom(sale, 100n), "WrongPriceAccount");
  });

  it("does not care who refreshed the price", async () => {
    // Pyth's refresh is permissionless, so the write authority on the account is
    // whoever last paid for an update. Reading it would make a sale depend on one
    // wallet staying alive, which is the thing the shard is meant to avoid.
    const sale = await bandedSale({});
    await refresh(sale, {
      dollars: 2n * PRICE_SCALE,
      writeAuthority: Keypair.generate().publicKey,
    });
    mustSucceed(await buyFrom(sale, 100n));
  });

  it("counts a price's age in seconds and not in slots", async () => {
    // The update was posted long ago in slot terms but published a moment ago.
    // Freshness is publish time against the chain clock, so this passes.
    const sale = await bandedSale({});
    await refresh(sale, { dollars: 2n * PRICE_SCALE, postedSlot: 1n });
    mustSucceed(await buyFrom(sale, 100n));
  });

  it("lets the widest band a sale may set reach half again above the stock", async () => {
    const sale = await bandedSale({ bandBps: 5_000 });
    const curve = curveCeiling(SQRT_PRICE_ONE, 6, 6);
    const dollars = stockPriceOnTheCeiling(curve, 5_000);
    await refresh(sale, { dollars, exponent: -18 });
    mustSucceed(await buyFrom(sale, 100n));

    await refresh(sale, { dollars: dollars - 1n, exponent: -18 });
    expectError(await buyFrom(sale, 100n), "PriceOutsideBand");
  });

  it("refuses a pool account swapped for another DBC pool", async () => {
    const sale = await bandedSale({});
    await refresh(sale, { dollars: 2n * PRICE_SCALE });

    // The pool is a fixed address in the published list, so Token-2022 works out
    // the swap for itself and refuses the transfer before Pangu is even called.
    // The hook compares the pool against the rules anyway, because a published
    // list is not a reason to trust what arrives.
    const other = await setupEnv({ quoteDecimals: 6 });
    const result = expectFailure(
      await buyFrom(sale, 100n, (keys) => {
        const at = keys.findIndex((key) => key.pubkey.equals(sale.env.pool));
        keys[at] = { ...keys[at], pubkey: other.pool };
      })
    );
    assert.equal(await tokenBalance(sale.env, sale.account), 0n);
    console.log(`      swapped pool refused by: ${result.result}`);
  });

  it("still enforces the cap and the approved list inside a banded sale", async () => {
    const sale = await bandedSale({ accessMode: ACCESS_ISSUER_LIST, cap: 500n });
    await refresh(sale, { dollars: 2n * PRICE_SCALE });

    expectError(await buyFrom(sale, 100n), "NotApproved");
    mustSucceed(await approveBuyer(sale.env, sale.buyer.publicKey));
    mustSucceed(await buyFrom(sale, 500n));
    expectError(await buyFrom(sale, 1n), "OverCap");
  });

  it("reads a tokenised feed's finer exponent as the same dollar price", async () => {
    // Pyth publishes Equity.US.AAPL/USD at 10^-5 and Crypto.AAPLX/USD at 10^-8.
    // The band has to see the same dollars either way.
    const sale = await bandedSale({});
    // The curve opens at a dollar. Two dollars at the tokenised exponent is
    // comfortably above it, half a dollar comfortably below.
    await refresh(sale, { dollars: 2n * PRICE_SCALE, exponent: -8 });
    mustSucceed(await buyFrom(sale, 100n));

    await refresh(sale, { dollars: PRICE_SCALE / 2n, exponent: -8 });
    expectError(await buyFrom(sale, 100n), "PriceOutsideBand");
  });
});

describe("sells are never held up by the band", () => {
  it("passes when the market has shut and nobody has published since", async () => {
    const sale = await holdingSale();
    await refresh(sale, {
      dollars: 2n * PRICE_SCALE,
      ageSecs: MAX_AGE_SECS * 100,
    });
    expectError(await buyFrom(sale, 1n), "PriceStale");
    mustSucceed(await sellFrom(sale, 100n));
    assert.equal(await tokenBalance(sale.env, sale.account), 900n);
  });

  it("passes when the curve is miles above the stock price", async () => {
    const sale = await holdingSale();
    await refresh(sale, { dollars: PRICE_SCALE / 1_000n });
    expectError(await buyFrom(sale, 1n), "PriceOutsideBand");
    mustSucceed(await sellFrom(sale, 100n));
    assert.equal(await tokenBalance(sale.env, sale.account), 900n);
  });

  it("passes when only part of the guardians signed the price", async () => {
    const sale = await holdingSale();
    await refresh(sale, { dollars: 2n * PRICE_SCALE, partialSignatures: 3 });
    expectError(await buyFrom(sale, 1n), "PriceNotFullyVerified");
    mustSucceed(await sellFrom(sale, 100n));
    assert.equal(await tokenBalance(sale.env, sale.account), 900n);
  });

  it("passes when the price account holds nothing at all", async () => {
    const sale = await holdingSale();
    sale.env.ctx.setAccount(sale.priceAccount, {
      lamports: 0,
      data: Buffer.alloc(0),
      owner: PublicKey.default,
      executable: false,
      rentEpoch: 0,
    });
    expectError(await buyFrom(sale, 1n), "WrongPriceAccount");
    mustSucceed(await sellFrom(sale, 100n));
    assert.equal(await tokenBalance(sale.env, sale.account), 900n);
  });

  it("passes when the price account is owned by a program nobody knows", async () => {
    const sale = await holdingSale();
    await refresh(sale, {
      dollars: 2n * PRICE_SCALE,
      owner: Keypair.generate().publicKey,
    });
    expectError(await buyFrom(sale, 1n), "WrongPriceAccount");
    mustSucceed(await sellFrom(sale, 100n));
    assert.equal(await tokenBalance(sale.env, sale.account), 900n);
  });
});

describe("the band's price maths", () => {
  it("agrees with Meteora's own price helper across the curve", async () => {
    const roots = [
      SQRT_PRICE_ONE,
      SQRT_PRICE_ONE / 1_000n,
      SQRT_PRICE_ONE * 7n + 12_345n,
      4_295_048_016n,
      23_499_038_395_676_116n,
      MAX_SQRT_PRICE,
    ];
    for (const root of roots) {
      for (const baseDecimals of [6, 9]) {
        for (const quoteDecimals of [6, 9]) {
          const mine = new Decimal(
            curveCeiling(root, baseDecimals, quoteDecimals).toString()
          ).div(new Decimal(10).pow(18));
          const theirs = new Decimal(
            getPriceFromSqrtPrice(
              new BN(root.toString()),
              baseDecimals as TokenDecimal,
              quoteDecimals as TokenDecimal
            ).toString()
          );
          // Two allowances, and nothing else. One unit of the band's own 1e18
          // scale, because the ceiling rounds up to the next whole unit and near
          // the bottom of DBC's curve a token is worth less than one. And a
          // relative sliver, because decimal.js carries twenty significant
          // digits, so at a wide sqrt price the SDK's own answer is already
          // rounded past the eighteenth decimal place.
          const unit = new Decimal(10).pow(-18);
          const slack = theirs.mul(new Decimal(1e-15));
          const allowed = Decimal.max(unit, slack);
          const where = `${root} ${baseDecimals}/${quoteDecimals}: mine ${mine}, SDK ${theirs}`;
          assert.isTrue(mine.minus(theirs).abs().lte(allowed), where);
          // Rounding only ever goes up, so a fraction of a unit can never be the
          // reason a buy is let through.
          assert.isTrue(mine.gte(theirs.minus(slack)), where);
        }
      }
    }
  });

  it("holds at the largest sqrt price DBC allows", async () => {
    const sale = await bandedSale({ baseDecimals: 9, quoteDecimals: 6 });
    await setPoolSqrtPrice(sale.env, MAX_SQRT_PRICE);

    const ceiling = curveCeiling(MAX_SQRT_PRICE, 9, 6);
    // Far too big to be a real stock price, so the band refuses it rather than
    // overflowing on the way to the comparison.
    await refresh(sale, { dollars: 2n * PRICE_SCALE });
    expectError(await buyFrom(sale, 100n), "PriceOutsideBand");
    assert.isTrue(ceiling > 2n * PRICE_SCALE);
  });
});

interface BandedSale {
  env: Env;
  buyer: Keypair;
  account: PublicKey;
  priceAccount: PublicKey;
}

interface BandedSaleOptions {
  accessMode?: number;
  bandBps?: number;
  cap?: bigint;
  baseDecimals?: number;
  quoteDecimals?: number;
}

function band(overrides: BandArgs = {}) {
  const feed = overrides.priceFeedId ?? PRICE_FEED;
  const shard = overrides.priceShard ?? PANGU_SHARD_ID;
  return {
    bandBps: 500,
    priceAccount: priceFeedAddress(shard, feed),
    priceFeedId: feed,
    priceShard: shard,
    maxPriceAgeSecs: MAX_AGE_SECS,
    maxConfBps: MAX_CONF_BPS,
    ...overrides,
  };
}

/** A banded sale with a funded vault, an open buyer record and a token account. */
async function bandedSale(options: BandedSaleOptions): Promise<BandedSale> {
  const env = await setupEnv({
    baseDecimals: options.baseDecimals ?? 6,
    quoteDecimals: options.quoteDecimals ?? 6,
  });
  const settings = band({ bandBps: options.bandBps ?? 500 });
  mustSucceed(
    await sendCreateSale(env, {
      cap: options.cap ?? CAP,
      accessMode: options.accessMode ?? 0,
      band: settings,
    })
  );
  await mintTokens(env, env.vault, 10_000_000n);

  const buyer = Keypair.generate();
  fund(env, buyer.publicKey);
  mustSucceed(await openBuyerRecord(env, buyer));
  const account = await createTokenAccount(env, buyer.publicKey);

  return { env, buyer, account, priceAccount: settings.priceAccount };
}

/** A banded sale whose buyer already holds a thousand tokens. */
async function holdingSale(): Promise<BandedSale> {
  const sale = await bandedSale({});
  await refresh(sale, { dollars: 2n * PRICE_SCALE });
  mustSucceed(await buyFrom(sale, 1_000n));
  return sale;
}

interface RefreshOptions {
  /** The stock price in dollars, scaled by 1e18. */
  dollars: bigint;
  /** The exponent Pyth publishes it at. Defaults to a US equity's. */
  exponent?: number;
  /**
   * The whole number to publish, instead of working it out from `dollars`. Only
   * for exponents the band refuses, where the dollar arithmetic would overflow
   * or round to nothing before the exponent is ever looked at.
   */
  rawPrice?: bigint;
  /** How many seconds ago it was published. Negative means the future. */
  ageSecs?: number;
  /** The confidence interval, in basis points of the price. */
  confBps?: number;
  feed?: number[];
  owner?: PublicKey;
  /** Whoever last paid for an update. Pangu must not read it. */
  writeAuthority?: PublicKey;
  /** The slot the update was posted in. Pangu must not read it either. */
  postedSlot?: bigint;
  /** Writes a partly verified update, with this many guardian signatures. */
  partialSignatures?: number;
  discriminator?: Buffer;
  truncateTo?: number;
}

/** Moves the clock forward and writes the price account the sale reads. */
async function refresh(sale: BandedSale, options: RefreshOptions) {
  slotCursor += 10_000n;
  const now = NOW;
  await setClock(sale.env, slotCursor, now);

  const exponent = options.exponent ?? EQUITY_EXPONENT;
  const price = options.rawPrice ?? dollarsAtExponent(options.dollars, exponent);
  const confBps = BigInt(options.confBps ?? 0);
  const conf = price > 0n ? (price * confBps) / 10_000n : 0n;

  writePriceUpdate(
    sale.env,
    sale.priceAccount,
    {
      feedId: options.feed ?? PRICE_FEED,
      price,
      conf,
      exponent,
      publishTime: now - BigInt(options.ageSecs ?? 1),
      writeAuthority: options.writeAuthority,
      postedSlot: options.postedSlot,
      partialSignatures: options.partialSignatures,
      discriminator: options.discriminator,
      truncateTo: options.truncateTo,
    },
    options.owner
  );
}

function buyFrom(
  sale: BandedSale,
  amount: bigint,
  rewrite?: (keys: any[]) => void
) {
  return buy(sale.env, sale.account, amount, rewrite);
}

function sellFrom(sale: BandedSale, amount: bigint) {
  return sell(sale.env, sale.account, sale.buyer, amount);
}

/**
 * The same fixed point maths the program does, in one place, so a test can name
 * the exact stock price that puts the curve on the ceiling.
 *
 * Dollars per whole token, scaled by 1e18, rounded up.
 */
function curveCeiling(
  sqrtPrice: bigint,
  baseDecimals: number,
  quoteDecimals: number
): bigint {
  const numerator = sqrtPrice * sqrtPrice * 10n ** BigInt(18 + baseDecimals);
  const denominator = (1n << 128n) * 10n ** BigInt(quoteDecimals);
  const whole = numerator / denominator;
  return numerator % denominator === 0n ? whole : whole + 1n;
}

/** The highest curve price a band allows, scaled by 1e18, rounded down. */
function bandCeiling(stockPrice: bigint, bandBps: number): bigint {
  return (stockPrice * BigInt(10_000 + bandBps)) / 10_000n;
}

/** The lowest stock price whose ceiling still reaches this curve price. */
function stockPriceOnTheCeiling(curve: bigint, bandBps: number): bigint {
  const factor = BigInt(10_000 + bandBps);
  let price = (curve * 10_000n + factor - 1n) / factor;
  while (bandCeiling(price, bandBps) < curve) {
    price += 1n;
  }
  return price;
}

async function extraAccountCount(env: Env): Promise<number> {
  const list = await accountAt(env, env.extraMetas);
  return getExtraAccountMetas({ data: Buffer.from(list!.data) } as any).length;
}
