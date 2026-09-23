// Writes the Pyth price feed accounts the price-band fork test reads, and the
// demo dollar it pays in, before the validator starts, because a validator can
// only be handed accounts on its command line.
//
// Pyth's receiver program is not on the local chain. The accounts are written
// byte for byte in the layout its real updates use, at the one address each
// shard and feed can produce, and owned by the receiver program id. That is what
// the hook checks: the address is a program address of Pyth's price feed program
// and the owner is the receiver, so on a real network nobody could put these
// bytes there.
//
// Usage: ts-node fork-tests/band-accounts.ts <output directory>
// Prints one "<address> <file>" line per account for the validator's --account flag,
// and leaves a manifest the test reads so the two can never drift apart.

import * as fs from "fs";
import * as path from "path";
import { Keypair } from "@solana/web3.js";
import { MINT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { encodePriceUpdate, dollarsAtExponent } from "../tests/quote";
import {
  BASE_DECIMALS,
  DEMO_DOLLAR_MINT,
  DOLLAR_AUTHORITY_WALLET,
  HIGH_PRICE_MULTIPLE,
  LOW_CEILING_MULTIPLE,
  MANIFEST_FILE,
  MAX_CONF_BPS,
  PRICE_EXPONENT,
  PRICE_FEED_ID,
  PriceManifest,
  QUOTE_DECIMALS,
  RECEIVER_PROGRAM_ID,
  SALE_NAMES,
  SaleName,
  bandCurve,
  bandPriceAccount,
  bandShard,
  curvePriceCeil1e18,
  maxPriceAgeSecs,
  stockPriceForMultiple,
} from "./band-setup";

function main() {
  const directory = process.argv[2];
  if (!directory) {
    throw new Error("give the output directory as the first argument");
  }
  fs.mkdirSync(directory, { recursive: true });

  const curve = bandCurve();
  const startPrice = curvePriceCeil1e18(
    BigInt(curve.sqrtStartPrice.toString()),
    BASE_DECIMALS,
    QUOTE_DECIMALS
  );
  // buildCurve lays down two points: the end of the segment the sale trades on,
  // and a constant product tail that only matters after migration. The first one
  // is as high as this sale's price can go.
  const migrationPrice = curvePriceCeil1e18(
    BigInt(curve.curve[0].sqrtPrice.toString()),
    BASE_DECIMALS,
    QUOTE_DECIMALS
  );
  // The low sale's ceiling has to be somewhere the curve can actually reach
  // before it graduates, otherwise the crossing test could never fire.
  if (migrationPrice < startPrice * LOW_CEILING_MULTIPLE * 3n) {
    throw new Error(
      `the curve only rises ${migrationPrice / startPrice}x before migration, ` +
        `which is not enough room for a ${LOW_CEILING_MULTIPLE}x ceiling`
    );
  }

  const lowStockPrice = stockPriceForMultiple(
    curve.sqrtStartPrice,
    LOW_CEILING_MULTIPLE
  );
  const stockPrices: Record<SaleName, bigint> = {
    low: lowStockPrice,
    high: lowStockPrice * HIGH_PRICE_MULTIPLE,
    aging: lowStockPrice * HIGH_PRICE_MULTIPLE,
  };

  // The moment Pyth's publishers agreed the price, as of just before the chain
  // exists. The ageing sale's own limit is short, so it shuts on its own partway
  // through the run while the other two stay open.
  const publishTime = Math.floor(Date.now() / 1000);
  // A confidence interval well inside every sale's limit, so nothing here is
  // refused for uncertainty instead of for the reason the test is about.
  const confBps = BigInt(MAX_CONF_BPS) / 10n;

  const manifest = {} as PriceManifest;
  for (const name of SALE_NAMES) {
    const address = bandPriceAccount(name);
    const rawPrice = dollarsAtExponent(stockPrices[name], PRICE_EXPONENT);
    const data = encodePriceUpdate({
      feedId: PRICE_FEED_ID,
      price: rawPrice,
      conf: (rawPrice * confBps) / 10_000n,
      exponent: PRICE_EXPONENT,
      publishTime: BigInt(publishTime),
    });

    const file = path.join(directory, `band-price-${name}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({
        pubkey: address.toBase58(),
        account: {
          lamports: 1_823_520,
          data: [data.toString("base64"), "base64"],
          owner: RECEIVER_PROGRAM_ID.toBase58(),
          executable: false,
          rentEpoch: 0,
          space: data.length,
        },
      })
    );
    console.log(`${address.toBase58()} ${file}`);

    manifest[name] = {
      shard: bandShard(name),
      priceAccount: address.toBase58(),
      // The account carries a whole number and an exponent, so the dollars the
      // band actually compares against are what survives that rounding, not the
      // number the multiple asked for.
      stockPrice: (rawPrice * 10n ** BigInt(18 + PRICE_EXPONENT)).toString(),
      rawPrice: rawPrice.toString(),
      publishTime,
      maxPriceAgeSecs: maxPriceAgeSecs(name),
    };
  }

  fs.writeFileSync(
    path.join(directory, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2)
  );

  writeDemoDollar(directory);
  console.error(
    `band prices written. curve opens at ${Number(startPrice) / 1e18} ` +
      `and migrates at ${Number(migrationPrice) / 1e18} dollars a token`
  );
}

/**
 * The devnet build only lets a ceiling be set on its listed dollars, and the
 * demo dollar's real mint authority is not on the fork. So the mint is written
 * at its real address in the classic token layout: a throwaway wallet as mint
 * authority, nothing minted, six decimals, no freeze authority.
 */
function writeDemoDollar(directory: string) {
  const authority = loadOrCreateWallet(directory, DOLLAR_AUTHORITY_WALLET);
  const data = Buffer.alloc(MINT_SIZE);
  data.writeUInt32LE(1, 0);
  authority.publicKey.toBuffer().copy(data, 4);
  data.writeUInt8(QUOTE_DECIMALS, 44);
  data.writeUInt8(1, 45);

  const file = path.join(directory, "band-demo-dollar.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      pubkey: DEMO_DOLLAR_MINT.toBase58(),
      account: {
        lamports: 1_461_600,
        data: [data.toString("base64"), "base64"],
        owner: TOKEN_PROGRAM_ID.toBase58(),
        executable: false,
        rentEpoch: 0,
        space: data.length,
      },
    })
  );
  console.log(`${DEMO_DOLLAR_MINT.toBase58()} ${file}`);
}

function loadOrCreateWallet(directory: string, name: string): Keypair {
  const file = path.join(directory, `${name}.json`);
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")))
    );
  }
  const keypair = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

main();
