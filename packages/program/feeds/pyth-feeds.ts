// The Pyth feeds a Pangu sale can be banded against, and the one address each
// one's price lives at.
//
// Everything here is public input: a feed id and a shard id. No wallet, no payer,
// no transaction. That is what lets an issuer write the address into a sale's
// rules before anybody has ever refreshed it.
//
// The feed ids were read from Pyth's own keyless feed search endpoint,
// https://hermes.pyth.network/v2/price_feeds?query=<ticker>, and are recorded in
// docs/RD-PYTH.md Q7.

import { PublicKey } from "@solana/web3.js";

/** Derives every price feed account address. Same on mainnet and devnet. */
export const PRICE_FEED_PROGRAM_ID = new PublicKey(
  "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT"
);

/** Owns every price feed account, and the only program that can write one. */
export const RECEIVER_PROGRAM_ID = new PublicKey(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
);

/**
 * The shard Pangu refreshes, matching PANGU_SHARD_ID in the program's price.rs.
 *
 * Shard 0 is the one Pyth sponsors. Its AAPL account on mainnet had not been
 * published to for about 37 days when this was written, so a Pangu sale reads a
 * shard it feeds itself instead.
 */
export const PANGU_SHARD_ID = 7_700;

export interface PythFeed {
  /** What Pyth calls it. */
  symbol: string;
  /** What a person calls it. */
  name: string;
  /** 32 bytes as hex, no leading 0x. */
  id: string;
}

/**
 * The feeds a sale can use today.
 *
 * The `Equity.US.*` ones are the real share prices and only publish during the
 * US market's sessions, which is what makes a Pangu sale close overnight. The
 * `Crypto.*X` ones track the tokenised versions of the same shares and publish
 * around the clock, so a sale banded against one of those stays open at
 * weekends. They are a different instrument and carry their own basis risk.
 */
export const FEEDS: PythFeed[] = [
  {
    symbol: "Equity.US.AAPL/USD",
    name: "Apple",
    id: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  },
  {
    symbol: "Equity.US.TSLA/USD",
    name: "Tesla",
    id: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  },
  {
    symbol: "Equity.US.NVDA/USD",
    name: "Nvidia",
    id: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
  },
  {
    symbol: "Equity.US.SPY/USD",
    name: "S and P 500 tracker",
    id: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
  },
  {
    symbol: "Crypto.AAPLX/USD",
    name: "Apple, tokenised",
    id: "978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675",
  },
  {
    symbol: "Crypto.TSLAX/USD",
    name: "Tesla, tokenised",
    id: "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362",
  },
];

/** The feed for a symbol, or a readable failure naming what is on offer. */
export function feedFor(symbol: string): PythFeed {
  const found = FEEDS.find(
    (feed) => feed.symbol.toLowerCase() === symbol.toLowerCase()
  );
  if (found === undefined) {
    throw new Error(
      `no feed called ${symbol}. Try one of: ${FEEDS.map((f) => f.symbol).join(", ")}`
    );
  }
  return found;
}

/**
 * The one address a price for this shard and this feed can live at.
 *
 * Seeds are the shard id as two little endian bytes and then the 32 byte feed
 * id, under Pyth's price feed program. This is `getPriceFeedAccountAddress` in
 * `@pythnetwork/pyth-solana-receiver`, written out so the address can be worked
 * out without a connection.
 */
export function priceFeedAddress(shardId: number, feedIdHex: string): PublicKey {
  const hex = feedIdHex.startsWith("0x") ? feedIdHex.slice(2) : feedIdHex;
  const id = Buffer.from(hex, "hex");
  if (id.length !== 32) {
    throw new Error(`a feed id is 32 bytes, this one is ${id.length}`);
  }
  const shard = Buffer.alloc(2);
  shard.writeUInt16LE(shardId, 0);
  return PublicKey.findProgramAddressSync([shard, id], PRICE_FEED_PROGRAM_ID)[0];
}

function main() {
  console.log(`price feed program: ${PRICE_FEED_PROGRAM_ID.toBase58()}`);
  console.log(`receiver program  : ${RECEIVER_PROGRAM_ID.toBase58()}`);
  console.log(`Pangu shard       : ${PANGU_SHARD_ID}`);
  console.log("");
  for (const feed of FEEDS) {
    console.log(`${feed.symbol}  (${feed.name})`);
    console.log(`  feed id      : 0x${feed.id}`);
    console.log(
      `  price account: ${priceFeedAddress(PANGU_SHARD_ID, feed.id).toBase58()}`
    );
  }
}

if (require.main === module) {
  main();
}
