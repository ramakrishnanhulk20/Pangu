/**
 * Opens a Pangu sale on devnet: the launch template, then the pool and the
 * sale's rules in one transaction.
 *
 *   npm run launch -- --mode list --cap-share-bps 1000
 *   npm run launch -- --mode open --band 500 --quote wsol
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
import { demoCurve } from "./curve.js";
import {
  addressLink,
  devnet,
  payerKeypair,
  requireDevnet,
  rpcUrl,
  sol,
  transactionLink,
} from "./environment.js";
import { aaplBand, aaplQuoteAccount } from "./feeds.js";
import { refreshAaplQuote } from "./quote-refresh.js";
import { appendSale } from "./sales.js";

const FLAGS = [
  "mode",
  "cap-share-bps",
  "quote",
  "band",
  "name",
  "symbol",
  "uri",
  "threshold-sol",
  "credential",
  "schema",
];

const MODES = ["open", "list", "credential"] as const;

/**
 * How much of the paying token the curve has to take in before the sale
 * graduates. Small on purpose: the point of the devnet run is that somebody can
 * afford to fill a curve and watch a sale graduate, and the project's devnet
 * wallet is not a faucet.
 */
const DEFAULT_THRESHOLD_SOL = 0.1;

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
  const thresholdSol = amount(flags, "threshold-sol", 0.01, 100, DEFAULT_THRESHOLD_SOL);
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

  const started = await connection.getBalance(issuer.publicKey, "confirmed");
  console.log(`network  : devnet, ${rpcUrl()}`);
  console.log(`program  : ${PANGU_PROGRAM_ID.toBase58()}`);
  console.log(`issuer   : ${issuer.publicKey.toBase58()}, ${sol(started)} SOL`);
  console.log(
    `sale     : ${name} (${symbol}), ${mode} access, cap ${capShareBps / 100} percent of the curve`
  );
  console.log(
    `paying in: ${quoteMint.toBase58()}, ${quoteDecimals} decimals, ${thresholdSol} of it to graduate`
  );

  if (bandBps > 0) {
    try {
      const refresh = await refreshAaplQuote(connection, issuer);
      console.log(
        `band     : ${bandBps / 100} percent over AAPL at ${refresh.price.toFixed(2)} dollars, last trade ${refresh.secondsSinceTrade} seconds ago`
      );
      console.log(`           quote account ${refresh.quoteAccount.toBase58()}`);
      console.log(`           ${refresh.link}`);
    } catch (error) {
      // The sale can still be opened. The quote account's address comes from
      // the queue and the two feed ids, so it is known before anybody has ever
      // written to it, and a buy is refused until somebody does. Saying so here
      // is better than opening a sale that quietly looks priced.
      console.log(
        `band     : ${bandBps / 100} percent over AAPL, but the price refresh did not go through: ${error instanceof Error ? error.message : String(error)}`
      );
      console.log(
        `           the sale still opens, and buys stay refused until a refresh lands`
      );
      console.log(`           quote account ${aaplQuoteAccount().toBase58()}`);
    }
  }

  const template = await launchTemplateTransaction({
    connection,
    partner: issuer.publicKey,
    quoteMint,
    curve: demoCurve(quoteDecimals, thresholdSol),
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
      ...(bandBps > 0 ? { band: aaplBand(bandBps) } : {}),
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
    thresholdSol,
    bandBps: sale.hasBand ? sale.bandBps : null,
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
