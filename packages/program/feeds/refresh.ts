// Refreshes a Pyth price on Pangu's own shard and reads it back.
//
// One transaction carries a fresh, guardian-signed update into the one account a
// banded sale names. Anybody can send it and the payer is not a seed, so the
// address never moves. Run it twice: the address must not change and the publish
// time must.
//
//   npx ts-node feeds/refresh.ts                      refresh AAPL and read
//   npx ts-node feeds/refresh.ts Equity.US.TSLA/USD   another feed
//   npx ts-node feeds/refresh.ts --read-only          read what is there
//   npx ts-node feeds/refresh.ts --dump               also save the raw bytes
//
// Needs two things from the environment, neither of which is ever printed:
// PYTH_API_KEY, because every Hermes read has needed a key since 26 Aug 2026,
// and DEVNET_PAYER_KEYPAIR, the path to the wallet that pays. Nothing here
// touches mainnet.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import {
  PANGU_SHARD_ID,
  RECEIVER_PROGRAM_ID,
  feedFor,
  priceFeedAddress,
} from "./pyth-feeds";

const DEVNET_RPC =
  process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const HERMES = "https://hermes.pyth.network";
/** The feed used when none is named, and the one the Rust test reads back. */
const DEFAULT_SYMBOL = "Equity.US.AAPL/USD";
/** Where the raw bytes go, for the Rust test that runs them through Pangu. */
const DUMP_FILE = path.join(__dirname, "live-price.bin");
/** A flat compute limit, so a failed simulation can never poison a later run. */
const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 20_000;

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const symbol = argv.find((arg) => !arg.startsWith("--")) ?? DEFAULT_SYMBOL;

/**
 * The wallet that pays, from the path in the environment.
 *
 * The path may be a Windows one, because the same `.env` is read from both sides
 * of WSL. Nothing about the key itself is ever printed or logged.
 */
function payerKeypair(): Keypair {
  const configured = process.env.DEVNET_PAYER_KEYPAIR;
  const file =
    configured === undefined || configured === ""
      ? path.join(os.homedir(), ".config", "solana", "pangu-devnet.json")
      : toPosixPath(configured);
  if (!fs.existsSync(file)) {
    throw new Error(
      `no wallet at ${file}. Set DEVNET_PAYER_KEYPAIR in .env to the keypair file's path.`
    );
  }
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")))
  );
}

function toPosixPath(value: string): string {
  const windows = value.match(/^([A-Za-z]):[\\/](.*)$/);
  if (windows === null) {
    return value;
  }
  return `/mnt/${windows[1].toLowerCase()}/${windows[2].replace(/\\/g, "/")}`;
}

function apiKey(): string {
  const key = process.env.PYTH_API_KEY;
  if (key === undefined || key === "") {
    throw new Error(
      "PYTH_API_KEY is not set. Every Hermes read has needed a key since 26 Aug 2026."
    );
  }
  return key;
}

/** The latest guardian-signed update for one feed, base64, straight from Pyth. */
async function latestUpdate(feedIdHex: string): Promise<string[]> {
  const url = `${HERMES}/v2/updates/price/latest?ids[]=${feedIdHex}&encoding=base64`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!response.ok) {
    // The body, not the key: a 401 here means the key has run out, and Ram's
    // access runs to 5 Oct 2026.
    throw new Error(
      `Hermes answered ${response.status}: ${(await response.text()).slice(0, 200)}`
    );
  }
  const body = (await response.json()) as { binary: { data: string[] } };
  return body.binary.data;
}

/**
 * The price feed account layout, read by hand.
 *
 * This is the same map `programs/pangu/src/price.rs` reads on chain, except that
 * there it comes out of Pyth's own Rust SDK. Written out here so the script can
 * report what it wrote without pulling the whole Anchor IDL in.
 * See docs/measurements/price-band-pyth.md for the bytes it was checked against.
 */
function decodePriceUpdate(data: Buffer) {
  const verificationLevel = data.readUInt8(40);
  if (verificationLevel !== 1) {
    throw new Error(
      `this account is only partly verified (${verificationLevel}), which Pangu refuses`
    );
  }
  return {
    writeAuthority: new PublicKey(data.subarray(8, 40)),
    feedId: data.subarray(41, 73).toString("hex"),
    price: data.readBigInt64LE(73),
    conf: data.readBigUInt64LE(81),
    exponent: data.readInt32LE(89),
    publishTime: Number(data.readBigInt64LE(93)),
    postedSlot: data.readBigUInt64LE(125),
  };
}

async function main() {
  const feed = feedFor(symbol);
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const payer = payerKeypair();
  const priceAccount = priceFeedAddress(PANGU_SHARD_ID, feed.id);
  const startLamports = await connection.getBalance(payer.publicKey);

  console.log(`network      : devnet, ${DEVNET_RPC}`);
  console.log(`payer        : ${payer.publicKey.toBase58()}`);
  console.log(`payer balance: ${startLamports / LAMPORTS_PER_SOL} SOL`);
  console.log(`feed         : ${feed.symbol} (${feed.name})`);
  console.log(`feed id      : 0x${feed.id}`);
  console.log(`shard        : ${PANGU_SHARD_ID}`);
  console.log(`price account: ${priceAccount.toBase58()}`);

  if (!flag("read-only")) {
    const updateData = await latestUpdate(feed.id);
    console.log(`hermes update: ${updateData[0].length} base64 characters`);

    const receiver = new PythSolanaReceiver({
      connection,
      wallet: new Wallet(payer),
    });
    // This closes the encoded VAA accounts the update is verified through, and
    // only those: the price feed account is a program address, it is not one of
    // them, and it stays at its fixed address so a sale opened months ago still
    // knows where to look. Leaving them open instead costs about 0.0013 SOL of
    // rent per refresh, thrown away, which was measured before this was set.
    const builder = receiver.newTransactionBuilder({
      closeUpdateAccounts: true,
    });
    await builder.addUpdatePriceFeed(updateData, PANGU_SHARD_ID);

    const transactions = await builder.buildVersionedTransactions({
      computeUnitPriceMicroLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    });
    let bytes = 0;
    for (const entry of transactions) {
      bytes += entry.tx.serialize().length;
    }
    console.log(
      `refresh bytes: ${bytes} across ${transactions.length} transaction(s), limit 1232 each`
    );

    const signatures = await receiver.provider.sendAll(transactions, {
      skipPreflight: true,
      preflightCommitment: "confirmed",
    });
    for (const signature of signatures) {
      const meta = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      console.log(
        `signature    : ${signature}  fee ${meta?.meta?.fee} lamports, ` +
          `${meta?.meta?.computeUnitsConsumed} compute units`
      );
    }
    console.log(
      `spent        : ${startLamports - (await connection.getBalance(payer.publicKey))} lamports, ` +
        `net of the rent reclaimed from the accounts this closed`
    );
  }

  const account = await connection.getAccountInfo(priceAccount, "confirmed");
  if (account === null) {
    throw new Error("the price account does not exist yet");
  }
  if (!account.owner.equals(RECEIVER_PROGRAM_ID)) {
    throw new Error(`the price account is owned by ${account.owner.toBase58()}`);
  }

  const update = decodePriceUpdate(account.data);
  if (update.feedId !== feed.id) {
    throw new Error(`this account carries feed 0x${update.feedId}, not ours`);
  }
  const dollars = Number(update.price) * 10 ** update.exponent;
  const confBps =
    update.price > 0n
      ? (update.conf * 10_000n + update.price - 1n) / update.price
      : 0n;
  const age = Math.floor(Date.now() / 1000) - update.publishTime;

  console.log(`account owner: ${account.owner.toBase58()}`);
  console.log(`account size : ${account.data.length} bytes`);
  console.log(`verification : Full, two thirds of the Wormhole guardians`);
  console.log(`write auth   : ${update.writeAuthority.toBase58()}`);
  console.log(
    `price        : ${dollars} dollars, exponent ${update.exponent}, confidence ${confBps} basis points`
  );
  console.log(
    `publish time : ${update.publishTime} (${new Date(update.publishTime * 1000).toISOString()}), ${age} seconds ago`
  );
  console.log(`posted slot  : ${update.postedSlot}`);

  if (flag("dump")) {
    fs.writeFileSync(DUMP_FILE, account.data);
    console.log(`raw bytes    : ${DUMP_FILE}, ${account.data.length} bytes`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
