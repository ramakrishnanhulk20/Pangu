// Writes the accounts the mainnet rehearsal needs before its validator starts,
// because a validator can only be handed accounts on its command line.
//
//   - Apple's Pyth price account, for the real Equity.US.AAPL/USD feed id on
//     Pangu's own shard, in the layout Pyth's receiver writes and owned by the
//     receiver. The price is placed so the crossing curve reaches its five
//     percent ceiling partway up and the graduating curve finishes below it.
//   - USDC token accounts for throwaway wallets. USDC is cloned from mainnet and
//     nobody local holds Circle's mint authority, so each account is written
//     with its balance already in it, at the wallet's own associated address.
//
// Usage: tsx fork-test/rehearsal-accounts.ts
// Prints one "<address> <file>" line per account for fork-validator.sh's
// REHEARSAL_ACCOUNT_LIST, and leaves a manifest the rehearsal reads.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  AccountState,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { buildCurve } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  PYTH_RECEIVER_PROGRAM_ID,
  curvePriceDollars,
  decodePriceUpdate,
  priceCeiling,
  priceFeedAddress,
} from "../src/index.js";
import { panguCurve } from "../src/dbc/index.js";
import {
  ACCOUNTS_DIR,
  APPLE_EXPONENT,
  APPLE_FEED_ID,
  APPLE_SHARD,
  BAND_BPS,
  CEILING_OVER_START,
  MAX_CONF_BPS,
  USDC_DECIMALS,
  USDC_MINT,
  USDC_PER_WALLET,
  USDC_WALLETS,
  loadOrCreateWallet,
  usdcCurve,
  writeManifest,
  type UsdcCurveName,
} from "./rehearsal-setup.js";

/** sha256("account:PriceUpdateV2")[0..8], as Pyth's own mainnet AAPL account carries it. */
const PRICE_UPDATE_DISCRIMINATOR = [34, 241, 35, 99, 157, 126, 244, 205];
/**
 * Pyth sizes the account for the wider, partly verified form, so a fully
 * verified update sits in 134 bytes with one byte of padding behind it.
 */
const PRICE_UPDATE_LEN = 134;
const FULLY_VERIFIED = 1;
/** Rent for 134 and 165 bytes, what the real accounts hold. */
const PRICE_ACCOUNT_LAMPORTS = 1_823_520;
const TOKEN_ACCOUNT_LAMPORTS = 2_039_280;

function writeAccount(
  name: string,
  address: PublicKey,
  owner: PublicKey,
  lamports: number,
  data: Buffer
): void {
  const file = join(ACCOUNTS_DIR, `${name}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      pubkey: address.toBase58(),
      account: {
        lamports,
        data: [data.toString("base64"), "base64"],
        owner: owner.toBase58(),
        executable: false,
        rentEpoch: 0,
        space: data.length,
      },
    })
  );
  console.log(`${address.toBase58()} ${file}`);
}

function priceUpdate(rawPrice: bigint, conf: bigint, publishTime: number): Buffer {
  const data = Buffer.alloc(PRICE_UPDATE_LEN);
  let at = 0;
  Buffer.from(PRICE_UPDATE_DISCRIMINATOR).copy(data, at);
  at += 8;
  // The write authority. Pangu does not read it; the band tests plant the same.
  PublicKey.default.toBuffer().copy(data, at);
  at += 32;
  data.writeUInt8(FULLY_VERIFIED, at);
  at += 1;
  Buffer.from(APPLE_FEED_ID, "hex").copy(data, at);
  at += 32;
  data.writeBigInt64LE(rawPrice, at);
  data.writeBigUInt64LE(conf, at + 8);
  data.writeInt32LE(APPLE_EXPONENT, at + 16);
  data.writeBigInt64LE(BigInt(publishTime), at + 20);
  data.writeBigInt64LE(BigInt(publishTime), at + 28);
  // The moving average Pangu does not read, written so the fields behind it sit
  // where a real account keeps them.
  data.writeBigInt64LE(rawPrice, at + 36);
  data.writeBigUInt64LE(conf, at + 44);
  data.writeBigUInt64LE(1n, at + 52);
  return data;
}

function curvePrices(name: UsdcCurveName): { start: bigint; migration: bigint } {
  const built = buildCurve(panguCurve(usdcCurve(name)));
  return {
    start: curvePriceDollars(BigInt(built.sqrtStartPrice.toString()), 6, USDC_DECIMALS),
    // The first point is the end of the segment the sale trades on, the highest
    // the price can go before graduation.
    migration: curvePriceDollars(BigInt(built.curve[0]!.sqrtPrice.toString()), 6, USDC_DECIMALS),
  };
}

function main(): void {
  mkdirSync(ACCOUNTS_DIR, { recursive: true });

  const crossing = curvePrices("crossing");
  const graduating = curvePrices("graduating");

  // Apple's price, so the crossing curve's ceiling sits at twice its opening
  // price. Written as Pyth writes an equity: a whole number at exponent -5.
  const wantedCeiling = crossing.start * CEILING_OVER_START;
  const wantedPrice = (wantedCeiling * 10_000n) / BigInt(10_000 + BAND_BPS);
  const scale = 10n ** BigInt(18 + APPLE_EXPONENT);
  const rawPrice = wantedPrice / scale;
  const stockPrice = rawPrice * scale;
  const ceiling = priceCeiling({ bandBps: BAND_BPS }, stockPrice);

  if (crossing.migration < ceiling * 3n) {
    throw new Error("the crossing curve does not climb far enough past the ceiling to reach it for sure");
  }
  if (graduating.migration >= ceiling) {
    throw new Error("the graduating curve ends above the ceiling, so it could never graduate");
  }

  // A confidence interval a tenth of the sale's limit, so no buy is refused for
  // doubt instead of for the reason the step is about.
  const conf = (rawPrice * BigInt(MAX_CONF_BPS)) / 100_000n;
  const publishTime = Math.floor(Date.now() / 1000);
  const priceAccount = priceFeedAddress(APPLE_FEED_ID, APPLE_SHARD);
  const data = priceUpdate(rawPrice, conf, publishTime);
  const decoded = decodePriceUpdate(data);
  if (decoded.feedId !== APPLE_FEED_ID || decoded.price !== rawPrice || !decoded.fullyVerified) {
    throw new Error("the written price account does not read back as written");
  }
  writeAccount("apple-price", priceAccount, PYTH_RECEIVER_PROGRAM_ID, PRICE_ACCOUNT_LAMPORTS, data);

  const amount = USDC_PER_WALLET * 10n ** BigInt(USDC_DECIMALS);
  const usdcWallets: string[] = [];
  for (let index = 0; index < USDC_WALLETS; index += 1) {
    const name = `usdc-buyer-${index + 1}`;
    const wallet = loadOrCreateWallet(ACCOUNTS_DIR, name);
    usdcWallets.push(`${name}.json`);
    const account = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint: USDC_MINT,
        owner: wallet.publicKey,
        amount,
        delegateOption: 0,
        delegate: PublicKey.default,
        state: AccountState.Initialized,
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      account
    );
    writeAccount(
      `${name}-usdc`,
      getAssociatedTokenAddressSync(USDC_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID),
      TOKEN_PROGRAM_ID,
      TOKEN_ACCOUNT_LAMPORTS,
      account
    );
  }

  writeManifest({
    priceAccount: priceAccount.toBase58(),
    shard: APPLE_SHARD,
    rawPrice: rawPrice.toString(),
    stockPrice: stockPrice.toString(),
    publishTime,
    usdcWallets,
    curves: {
      crossing: { start: crossing.start.toString(), migration: crossing.migration.toString() },
      graduating: { start: graduating.start.toString(), migration: graduating.migration.toString() },
    },
  });

  const dollars = (value: bigint) => (Number(value) / 1e18).toFixed(6);
  console.error(
    `apple ${dollars(stockPrice)} dollars, ceiling ${dollars(ceiling)}; ` +
      `crossing curve ${dollars(crossing.start)} to ${dollars(crossing.migration)}, ` +
      `graduating curve ${dollars(graduating.start)} to ${dollars(graduating.migration)}; ` +
      `${USDC_WALLETS} wallets with ${USDC_PER_WALLET} USDC each`
  );
}

main();
