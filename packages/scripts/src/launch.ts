/**
 * Opens a Pangu sale on devnet: the launch template, then the pool and the
 * sale's rules in one transaction.
 *
 *   npm run launch -- --mode list --cap-share-bps 1000
 *   npm run launch -- --mode open --band 500 --feed Crypto.AAPLX/USD
 *   npm run launch -- --mode open --band 500 --quote <dollar mint> --threshold 360000000000 --base-decimals 9 --migration-percent 40
 *
 * Everything it prints comes back off the chain after the transactions land,
 * and every sale it opens is appended to sales.json so the other commands can
 * find it without being told.
 */

import { PublicKey, type Connection, type Keypair } from "@solana/web3.js";
import { NATIVE_MINT, getMint } from "@solana/spl-token";
import { TokenDecimal } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ACCESS_MODE,
  PANGU_PROGRAM_ID,
  extraAccountListAddress,
  getSale,
  saleRulesAddress,
  type AccessMode,
} from "pangu-sdk";
import { launchTemplateTransaction, openSaleTransaction } from "pangu-sdk/dbc";
import {
  ArgumentError,
  amount,
  choice,
  readFlags,
  requiredText,
  text,
  wholeNumber,
} from "./arguments.js";
import { send } from "./chain.js";
import {
  DEFAULT_SUPPLY,
  demoCurve,
  graduationPrice,
  openingPrice,
  shareSoldAtPrice,
  type CurveShape,
} from "./curve.js";
import {
  addressLink,
  devnet,
  payerKeypair,
  requireDevnet,
  rpcUrl,
  sol,
  transactionLink,
} from "./environment.js";
import {
  bandFor,
  feedFor,
  feedPriceAccount,
  DEFAULT_FEED,
  MAX_CONF_BPS,
  MAX_PRICE_AGE_SECS,
} from "./feeds.js";
import { refreshFeedPrice } from "./price-refresh.js";
import { appendSale } from "./sales.js";

const FLAGS = [
  "mode",
  "cap-share-bps",
  "quote",
  "band",
  "feed",
  "name",
  "symbol",
  "uri",
  "threshold",
  "base-decimals",
  "migration-percent",
  "supply",
  "credential",
  "schema",
];

const MODES = ["open", "list", "credential"] as const;

/**
 * How much of the paying token the curve has to take in before the sale
 * graduates, in whole units of that token. Small on purpose: the point of the
 * devnet run is that somebody can afford to fill a curve and watch a sale
 * graduate, and the project's devnet wallet is not a faucet.
 */
const DEFAULT_THRESHOLD = 0.1;

/**
 * The share of the supply carried over to DAMM v2 at graduation, as a
 * percentage. It sets how steep the curve is: the more that is kept back, the
 * closer the opening price sits to the graduation price.
 */
const DEFAULT_MIGRATION_PERCENT = 20;

/**
 * The most of the supply a launch may keep back, as a percentage.
 *
 * Forty five is the flattest curve Meteora will build: at fifty its own
 * `buildCurve` refuses the shape with "SafeMath: subtraction overflow". A flat
 * curve is what lets a banded sale open near the stock price and still take
 * most of its shares before the ceiling bites.
 */
const MAX_MIGRATION_PERCENT = 45;

/**
 * The sale token's own decimals.
 *
 * Nine is worth asking for when a share is priced in dollars. Meteora builds the
 * curve out of raw units, so a token with more of them per share gives the curve
 * builder the room to carry a three figure opening price, and six decimals does
 * not. The band reads both mints' decimals off the chain, so the dollar price it
 * compares is the same either way.
 */
const DEFAULT_BASE_DECIMALS = 6;

const ACCESS_MODE_OF: Record<(typeof MODES)[number], AccessMode> = {
  open: ACCESS_MODE.open,
  list: ACCESS_MODE.issuerList,
  credential: ACCESS_MODE.verifierCredential,
};

/** The paying token's own decimals, read off the mint rather than assumed. */
async function quoteDecimalsOf(
  connection: Connection,
  mint: PublicKey
): Promise<TokenDecimal> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (info === null) {
    throw new ArgumentError(`${mint.toBase58()} is not a mint on devnet`);
  }
  const state = await getMint(connection, mint, "confirmed", info.owner);
  if (state.decimals < TokenDecimal.SIX || state.decimals > TokenDecimal.NINE) {
    throw new ArgumentError(
      `a paying token for a Pangu demo needs 6 to 9 decimals, ${mint.toBase58()} has ${state.decimals}`
    );
  }
  return state.decimals as TokenDecimal;
}

async function main(): Promise<void> {
  const flags = readFlags(process.argv.slice(2), FLAGS);
  const mode = choice(flags, "mode", MODES, "list");
  const capShareBps = wholeNumber(flags, "cap-share-bps", 1, 10_000, 1_000);
  const bandBps = wholeNumber(flags, "band", 1, 5_000, 0);
  const feed = feedFor(text(flags, "feed", DEFAULT_FEED));
  const threshold = amount(flags, "threshold", 0.01, 1e15, DEFAULT_THRESHOLD);
  const baseDecimals = wholeNumber(flags, "base-decimals", 6, 9, DEFAULT_BASE_DECIMALS);
  const migrationPercent = wholeNumber(
    flags,
    "migration-percent",
    10,
    MAX_MIGRATION_PERCENT,
    DEFAULT_MIGRATION_PERCENT
  );
  const supply = wholeNumber(flags, "supply", 1, 1e12, DEFAULT_SUPPLY);
  const quoteFlag = text(flags, "quote", "wsol");
  const name = text(
    flags,
    "name",
    mode === "open" ? "Pangu Open Share" : "Pangu Listed Share"
  );
  const symbol = text(flags, "symbol", mode === "open" ? "POPEN" : "PLIST");
  const uri = text(
    flags,
    "uri",
    `https://pangu.example/devnet/${symbol.toLowerCase()}.json`
  );

  const connection = devnet();
  await requireDevnet(connection);
  const issuer: Keypair = payerKeypair();

  const quoteMint = quoteFlag === "wsol" ? NATIVE_MINT : new PublicKey(quoteFlag);
  const quoteDecimals = await quoteDecimalsOf(connection, quoteMint);
  const shape: CurveShape = {
    quoteDecimals,
    baseDecimals: baseDecimals as TokenDecimal,
    supply,
    migrationPercent,
    threshold,
  };

  const started = await connection.getBalance(issuer.publicKey, "confirmed");
  console.log(`network  : devnet, ${rpcUrl()}`);
  console.log(`program  : ${PANGU_PROGRAM_ID.toBase58()}`);
  console.log(`issuer   : ${issuer.publicKey.toBase58()}, ${sol(started)} SOL`);
  console.log(
    `sale     : ${name} (${symbol}), ${mode} access, cap ${capShareBps / 100} percent of the curve`
  );
  console.log(
    `paying in: ${quoteMint.toBase58()}, ${quoteDecimals} decimals, ${threshold} of it to graduate`
  );
  console.log(
    `curve    : ${supply} shares of ${baseDecimals} decimals, ${migrationPercent} percent kept back for DAMM v2`
  );
  console.log(
    `price    : opens at ${openingPrice(shape)} of the paying token a share, ends at ${graduationPrice(shape)}`
  );

  if (bandBps > 0) {
    console.log(
      `band     : ${bandBps / 100} percent over ${feed.name}, price at most ${MAX_PRICE_AGE_SECS} seconds old and no wider than ${MAX_CONF_BPS / 100} percent`
    );
    try {
      const refresh = await refreshFeedPrice(connection, issuer, feed.symbol);
      console.log(
        `           ${feed.symbol} at ${refresh.price.toFixed(4)} dollars, published ${refresh.secondsOld} seconds ago, confidence ${refresh.confBps} basis points`
      );
      const ceiling = refresh.price * (1 + bandBps / 10_000);
      const bites = shareSoldAtPrice(shape, ceiling);
      if (bites <= 0) {
        console.log(
          `           ceiling ${ceiling.toFixed(4)} dollars, under this curve's opening price, so every buy is refused until the stock rises`
        );
      } else if (bites > 1) {
        console.log(
          `           ceiling ${ceiling.toFixed(4)} dollars, which this curve never reaches: it ends at ${graduationPrice(shape)}`
        );
      } else {
        console.log(
          `           ceiling ${ceiling.toFixed(4)} dollars, reached once ${(bites * 100).toFixed(1)} percent of the curve's shares have sold`
        );
      }
      console.log(`           price account ${refresh.priceAccount.toBase58()}`);
      for (const link of refresh.links) {
        console.log(`           ${link}`);
      }
    } catch (error) {
      // The sale can still be opened. The price account's address comes from
      // the shard and the feed id, so it is known before anybody has ever
      // written to it, and every buy is refused until somebody does. Saying so
      // here is better than opening a sale that quietly looks priced.
      console.log(
        `           the price refresh did not go through: ${error instanceof Error ? error.message : String(error)}`
      );
      console.log(
        `           the sale still opens, and buys stay refused until a refresh lands`
      );
      console.log(`           price account ${feedPriceAccount(feed).toBase58()}`);
    }
  }

  const template = await launchTemplateTransaction({
    connection,
    partner: issuer.publicKey,
    quoteMint,
    curve: demoCurve(shape),
  });
  const templateLanded = await send(
    connection,
    "the launch template",
    template.transaction,
    [issuer, template.config]
  );

  const credentialTerms =
    mode === "credential"
      ? {
          credential: new PublicKey(
            requiredText(
              flags,
              "credential",
              "a credential sale checks attestations against one verifier"
            )
          ),
          schema: new PublicKey(
            requiredText(
              flags,
              "schema",
              "a credential sale checks one schema of attestation"
            )
          ),
        }
      : {};

  const opened = await openSaleTransaction({
    connection,
    creator: issuer.publicKey,
    config: template.config.publicKey,
    name,
    symbol,
    uri,
    sale: {
      capShareBps,
      accessMode: ACCESS_MODE_OF[mode],
      ...credentialTerms,
      ...(bandBps > 0 ? { band: bandFor(feed, bandBps) } : {}),
    },
  });
  const saleLanded = await send(
    connection,
    "the pool and the sale's rules",
    opened.transaction,
    [issuer, opened.baseMint]
  );

  const mint = opened.baseMint.publicKey;
  const sale = await getSale(connection, mint);
  if (sale === null) {
    throw new Error("the sale's rules are not on chain after the transaction landed");
  }

  const rules = saleRulesAddress(mint);
  const list = extraAccountListAddress(mint);
  const spent = started - (await connection.getBalance(issuer.publicKey, "confirmed"));

  const line = (label: string, address: PublicKey): void => {
    console.log(`${label}: ${address.toBase58()}`);
    console.log(`           ${addressLink(address)}`);
  };

  console.log("");
  line("mint     ", mint);
  line("pool     ", sale.pool);
  line("config   ", template.config.publicKey);
  line("rules    ", rules);
  line("extra    ", list);
  if (sale.hasBand) {
    line("price    ", sale.priceAccount);
  }
  console.log(`template : ${transactionLink(templateLanded.signature)}`);
  console.log(`sale     : ${transactionLink(saleLanded.signature)}`);
  console.log("");
  console.log(`cap      : ${sale.cap} raw units, the most one wallet may hold`);
  console.log(
    `bytes    : ${template.bytes} for the template, ${opened.bytes} for the pool and rules, against the 1232 byte limit`
  );
  console.log(`spent    : ${sol(spent)} SOL`);

  appendSale({
    network: "devnet",
    program: PANGU_PROGRAM_ID.toBase58(),
    openedAt: new Date().toISOString(),
    name,
    symbol,
    mode,
    accessMode: sale.accessMode,
    capShareBps,
    cap: sale.cap.toString(),
    thresholdSol: threshold,
    bandBps: sale.hasBand ? sale.bandBps : null,
    feed: sale.hasBand ? feed.symbol : null,
    config: template.config.publicKey.toBase58(),
    mint: mint.toBase58(),
    pool: sale.pool.toBase58(),
    rules: rules.toBase58(),
    extraAccountList: list.toBase58(),
    quoteMint: quoteMint.toBase58(),
    issuer: issuer.publicKey.toBase58(),
    priceAccount: sale.hasBand ? sale.priceAccount.toBase58() : null,
    templateSignature: templateLanded.signature,
    saleSignature: saleLanded.signature,
  });
  console.log("recorded : packages/scripts/sales.json");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
