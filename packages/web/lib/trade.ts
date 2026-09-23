import "./buffer-shim";

import { BN } from "@anchor-lang/core";
import { swapQuoteExactIn, swapQuoteExactOut } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  VersionedTransaction,
  type Connection,
  type PublicKey,
  type Transaction,
} from "@solana/web3.js";
import {
  ACCESS_MODE,
  SAS_PROGRAM_ID,
  explainPanguError,
  getBuyerRecord,
  panguErrorFromLogs,
  readPrice,
  type BuyerRecord,
  type PanguErrorName,
  type PriceReading,
} from "pangu-sdk";
import {
  buyTransaction,
  loadPool,
  preflightBuy,
  sellTransaction,
  type BuyPreflight,
  type PoolView,
  type TradeTransaction,
} from "pangu-sdk/dbc";

import { breakConnection, heldIn, tokensHeld } from "./break";
import { CHAIN, FAUCET_ON, browserRpcUrl } from "./network";

/*
 * Buying and selling on one sale's page. Browser-safe: no key, no server-only
 * import. Everything a wallet signs is built by pangu-sdk, simulated against
 * the chain first, and only then handed to the wallet.
 */

/** The paced connection the sale page reads through, the ledger's own. */
export function tradeConnection(): Connection {
  return breakConnection(browserRpcUrl());
}

/** Where the curve stands: the pool, its template and the sale's rules, read together. */
export async function readMarket(connection: Connection, mint: PublicKey): Promise<PoolView> {
  return loadPool(connection, mint);
}

/** The numbers read off Meteora's quote. Their published type does not resolve here. */
interface QuoteNumbers {
  outputAmount: { toString(): string };
  includedFeeInputAmount?: { toString(): string };
}

export interface BuyQuote {
  /** Raw units of the sale token the buy receives. */
  shares: bigint;
  /** Raw units of the paying token it spends, fee included. */
  pays: bigint;
}

/** A quote the curve cannot give, in words. */
export class QuoteRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteRefused";
  }
}

function quoteError(error: unknown): QuoteRefused {
  const text = error instanceof Error ? error.message : String(error);
  if (/completed/i.test(text)) {
    return new QuoteRefused("The curve is full, so it sells nothing more.");
  }
  if (/liquidity/i.test(text)) {
    return new QuoteRefused("The curve does not have that many shares left to sell.");
  }
  return new QuoteRefused(`Meteora's quote refused this amount: ${text}`);
}

/**
 * What a buy of this size gets and pays, from Meteora's own quote on the pool as
 * it stands. `unit` says what the amount is counted in: shares out, or the
 * paying token in.
 */
export function quoteBuy(view: PoolView, amount: bigint, unit: "shares" | "paying"): BuyQuote {
  try {
    if (unit === "shares") {
      const quote = swapQuoteExactOut(
        view.poolAccount,
        view.configState,
        false,
        new BN(amount.toString()),
        0,
        false,
        view.currentPoint,
        // Pangu's template leaves the first swap minimum fee off, as pangu-sdk's quote does.
        false
      ) as unknown as QuoteNumbers;
      return { shares: amount, pays: BigInt(quote.includedFeeInputAmount?.toString() ?? "0") };
    }
    const quote = swapQuoteExactIn(
      view.poolAccount,
      view.configState,
      false,
      new BN(amount.toString()),
      0,
      false,
      view.currentPoint,
      false
    ) as unknown as QuoteNumbers;
    return { shares: BigInt(quote.outputAmount.toString()), pays: amount };
  } catch (error) {
    throw quoteError(error);
  }
}

/** What selling this many shares back returns, in raw units of the paying token. */
export function quoteSell(view: PoolView, shares: bigint): bigint {
  try {
    const quote = swapQuoteExactIn(
      view.poolAccount,
      view.configState,
      true,
      new BN(shares.toString()),
      0,
      false,
      view.currentPoint,
      false
    ) as unknown as QuoteNumbers;
    return BigInt(quote.outputAmount.toString());
  } catch (error) {
    throw quoteError(error);
  }
}

/** One wallet's standing in one sale, read off the chain. */
export interface WalletStanding {
  lamports: number;
  /** Raw units of the sale token in the wallet's ordinary account for it. */
  shares: bigint;
  /**
   * Raw units of the paying token the wallet can spend. On a sale paid in SOL
   * the buy wraps SOL from the wallet itself, so that is the wallet's SOL.
   */
  paying: bigint;
  payingInSol: boolean;
  record: BuyerRecord | null;
  /** Raw units the cap still lets this wallet buy. */
  capRoom: bigint;
}

export async function readWallet(
  connection: Connection,
  view: PoolView,
  wallet: PublicKey
): Promise<WalletStanding> {
  const payingInSol = view.quoteMint.equals(NATIVE_MINT);
  const [lamports, shares, record, paying] = await Promise.all([
    connection.getBalance(wallet, "confirmed"),
    tokensHeld(connection, view.baseMint, wallet),
    getBuyerRecord(connection, view.baseMint, wallet),
    payingInSol
      ? Promise.resolve(null)
      : heldIn(connection, view.quoteMint, wallet, view.quoteProgram),
  ]);
  const left = view.sale.cap - (record?.netBought ?? 0n);
  return {
    lamports,
    shares,
    paying: paying ?? BigInt(lamports),
    payingInSol,
    record,
    capRoom: left > 0n ? left : 0n,
  };
}

/**
 * Whether a buy of this many shares would pass, asked of the program's own
 * rules in the hook's order, before anything is signed. A wallet with no record
 * yet is judged as the fresh record the buy opens in the same transaction.
 */
export function preflight(
  connection: Connection,
  mint: PublicKey,
  wallet: PublicKey,
  shares: bigint,
  hasRecord: boolean
): Promise<BuyPreflight> {
  return preflightBuy({ connection, buyer: wallet, mint, amountOut: shares, openingRecord: !hasRecord });
}

/** The sale's live stock price, on a sale with a price band. */
export function readBandPrice(connection: Connection, view: PoolView): Promise<PriceReading | null> {
  return view.sale.hasBand ? readPrice(connection, view.sale) : Promise.resolve(null);
}

const CREDENTIAL_REFUSALS: readonly string[] = [
  "CredentialInvalid",
  "CredentialExpired",
  "CredentialSignerNotAuthorized",
];

/** Where a wallet stands against a credential sale's verifier. */
export interface CredentialStanding {
  credential: string;
  schema: string;
  /** The name the verifier gave its credential, when the account carries one. */
  verifierName: string | null;
  valid: boolean;
  refusal: PanguErrorName | null;
  sentence: string | null;
}

/**
 * The name a credential account carries: after the discriminator and the
 * authority, a length and the bytes. Null for anything that is not a credential
 * of the attestation service, so a stranger's account is never named.
 */
function credentialName(owner: PublicKey, data: Uint8Array): string | null {
  if (!owner.equals(SAS_PROGRAM_ID) || data.length < 37 || data[0] !== 0) {
    return null;
  }
  const length = new DataView(data.buffer, data.byteOffset + 33, 4).getUint32(0, true);
  if (length === 0 || length > 64 || 37 + length > data.length) {
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(37, 37 + length));
  } catch {
    return null;
  }
}

/**
 * Whether this wallet holds an attestation the sale's verifier stands behind,
 * answered by pangu-sdk's own credential check inside preflightBuy, which reads
 * the credential, the attestation and the chain's clock the way the hook does.
 * The smallest buy is asked about, so a price or a cap refusal later in the
 * hook's order never hides the answer about the credential.
 */
export async function credentialStanding(
  connection: Connection,
  view: PoolView,
  wallet: PublicKey,
  hasRecord: boolean
): Promise<CredentialStanding> {
  const [answer, account] = await Promise.all([
    preflight(connection, view.baseMint, wallet, 1n, hasRecord),
    connection.getAccountInfo(view.sale.credential, "confirmed"),
  ]);
  const refusal =
    answer.error !== null && CREDENTIAL_REFUSALS.includes(answer.error) ? answer.error : null;
  return {
    credential: view.sale.credential.toBase58(),
    schema: view.sale.schema.toBase58(),
    verifierName: account === null ? null : credentialName(account.owner, account.data),
    valid: refusal === null,
    refusal,
    sentence: refusal === null ? null : explainPanguError(refusal),
  };
}

export function buildBuy(
  connection: Connection,
  wallet: PublicKey,
  mint: PublicKey,
  pays: bigint
): Promise<TradeTransaction> {
  return buyTransaction({ connection, buyer: wallet, mint, amountIn: pays });
}

export function buildSell(
  connection: Connection,
  wallet: PublicKey,
  mint: PublicKey,
  shares: bigint
): Promise<TradeTransaction> {
  return sellTransaction({ connection, seller: wallet, mint, amountIn: shares });
}

/** What the chain says a transaction would do, before anybody signs it. */
export interface Verdict {
  ok: boolean;
  /** The program's own refusal, when the refusal was Pangu's. */
  error: PanguErrorName | null;
  /** A sentence a buyer can read, whoever refused. Null when it would pass. */
  sentence: string | null;
}

const NO_SOL = FAUCET_ON
  ? `This wallet does not have enough ${CHAIN.sol} for the fees and the accounts this opens. Take some from the faucet, then try again.`
  : "This wallet does not have enough SOL for the fees and the accounts this opens. Add some SOL, then try again.";
const SHORT_TOKEN =
  "This wallet does not hold enough of the token this sale is priced in. Get some first, then try again.";

/** Names a failure the sale's rules did not cause, from the node's own error and logs. */
function plainFailure(error: unknown, logs: readonly string[]): string {
  const text = typeof error === "string" ? error : JSON.stringify(error);
  const joined = logs.join("\n");
  if (/AccountNotFound|InsufficientFundsForFee|InsufficientFundsForRent/.test(text) || /insufficient lamports/i.test(joined)) {
    return NO_SOL;
  }
  if (/insufficient funds/i.test(joined)) {
    return SHORT_TOKEN;
  }
  if (/slippage/i.test(joined)) {
    return "The price moved between the quote and the transaction. Try again with the new quote.";
  }
  const said = logs
    .filter((line) => line.startsWith("Program log: ") && !line.startsWith("Program log: Instruction:"))
    .pop();
  return `${CHAIN.atStart} refused it: ${said === undefined ? text : said.slice("Program log: ".length)}`;
}

/**
 * Runs a transaction against the chain without anybody signing it, so a wallet is
 * never asked to sign something the chain would refuse.
 */
export async function simulate(connection: Connection, transaction: Transaction): Promise<Verdict> {
  if (transaction.recentBlockhash === undefined) {
    transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  }
  const simulated = await connection.simulateTransaction(
    new VersionedTransaction(transaction.compileMessage()),
    { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }
  );
  const { err, logs } = simulated.value;
  if (err === null) {
    return { ok: true, error: null, sentence: null };
  }
  const found = panguErrorFromLogs(logs ?? []);
  if (found !== null) {
    return { ok: false, error: found.name, sentence: explainPanguError(found.name) };
  }
  return { ok: false, error: null, sentence: plainFailure(err, logs ?? []) };
}

/** What a buyer can do about one of the program's refusals. */
export function whatToDo(
  error: PanguErrorName | null,
  context: { issuer: string; capRoom: string; symbol: string; accessMode: number }
): string | null {
  switch (error) {
    case "NotApproved":
      return `Ask the issuer, ${context.issuer}, to add your wallet to the list.`;
    case "OverCap":
      return `Buy ${context.capRoom} ${context.symbol} or fewer: that is what the cap leaves this wallet.`;
    case "PriceOutsideBand":
      return "Buy fewer shares so the curve stays under the ceiling, or wait for the stock price to rise.";
    case "PriceStale":
      return "Press bring the price up to date. Outside market hours there is no newer price, so wait for the market to open.";
    case "PriceTooUncertain":
    case "PriceNotFullyVerified":
      return "Wait a few minutes for Pyth's publishers to agree, then try again.";
    case "CredentialInvalid":
    case "CredentialExpired":
    case "CredentialSignerNotAuthorized":
      return "Ask the sale's verifier for a fresh approval of this wallet, then come back.";
    case "BuyerRecordMissing":
      return "Try again: the buy opens your record in the same transaction.";
    case null:
      return null;
    default:
      return context.accessMode === ACCESS_MODE.open ? null : `Ask the issuer, ${context.issuer}.`;
  }
}

/**
 * A typed amount as raw units of a token with these decimals, or null when it is
 * not a positive number the token can hold. No floating point: "1.5" with six
 * decimals is exactly 1500000.
 */
export function parseAmount(text: string, decimals: number): bigint | null {
  const clean = text.trim().replace(/,/g, "");
  if (!/^\d*(\.\d*)?$/.test(clean) || clean === "" || clean === ".") {
    return null;
  }
  const [whole = "", fraction = ""] = clean.split(".");
  if (fraction.length > decimals) {
    return null;
  }
  const raw = BigInt((whole === "" ? "0" : whole) + fraction.padEnd(decimals, "0"));
  return raw > 0n ? raw : null;
}

/** Raw units written back as a plain decimal an input field accepts. */
export function amountText(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction === "" ? (raw / scale).toString() : `${raw / scale}.${fraction}`;
}

/** A thrown value as a sentence a visitor can act on. */
export function messageOf(error: unknown): string {
  const text =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  if (/user rejected|request rejected|declined|rejected the request/i.test(text)) {
    return "You turned this down in your wallet, so nothing was sent.";
  }
  if (/429|rate limit/i.test(text)) {
    return `The public ${CHAIN.inSentence} node is rate limiting this browser. Wait a moment and try again.`;
  }
  if (/failed to fetch|fetch failed|network/i.test(text)) {
    return `${CHAIN.atStart} did not answer. Check the connection and try again.`;
  }
  return text;
}

