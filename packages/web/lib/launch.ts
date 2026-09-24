import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  VersionedTransaction,
  type AccountMeta,
  type Connection,
  type SendOptions,
  type Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  ACCESS_MODE,
  PANGU_SHARD_ID,
  explainPanguError,
  extraAccountListAddress,
  getSale,
  panguErrorFromLogs,
  saleRulesAddress,
  saleTokenInfo,
  type PanguErrorName,
} from "pangu-sdk";
import { capFromShare, launchTemplateTransaction, openSaleTransaction } from "pangu-sdk/dbc";

import { AAPLX_FEED, APPLE_EXCHANGE_FEED, feedWords } from "./feeds";
import {
  CHAIN,
  FAUCET_ON,
  PAYING_TOKENS,
  explorerAddress,
  explorerTx,
  isListedDollar,
  payingToken,
  type Money,
  type PayingToken,
} from "./network";
import {
  LogoRefused,
  MAX_DESCRIPTION,
  checkWebsite,
  checkX,
  MAX_STORAGE_LAMPORTS,
  StorageTooDear,
  unsentFundOf,
  uploadMetadata,
  type StoredMetadata,
  type UploadStage,
} from "./token-metadata";
import {
  MAX_MIGRATION_PERCENT,
  MIN_MIGRATION_PERCENT,
  builtCurve,
  curvePoints,
  demoCurve,
  fitsRaw,
  graduationPrice,
  openingPrice,
  shareSoldAtPrice,
  type CurveShape,
} from "./launch-curve";

/**
 * Everything the launch page does between a form and a live sale: the plan it
 * shows before anybody signs, and the run that sends it.
 *
 * Browser safe: no key, no server-only import. It follows
 * packages/scripts/src/launch.ts transaction for transaction: the launch
 * template first, then the pool and the sale's rules together in one. Before
 * either, any logo, description and links are stored on Irys, because the pool
 * transaction writes their address into the mint.
 */

export { explorerAddress, explorerTx };

/** The same limits packages/scripts/src/feeds.ts writes into every banded demo sale. */
const MAX_PRICE_AGE_SECS = 3_600;
const MAX_CONF_BPS = 100;

/**
 * What one launch cost the launching wallet on devnet: rent for the template,
 * the pool, its vaults, the mint and the sale's rules, plus the fees. The
 * larger of the two launches measured from this page by
 * lab-evidence/test-wallet.mjs, recorded in lab-evidence/launch-devnet.txt.
 */
export const LAUNCH_COST_LAMPORTS = 19_294_000;

const MAX_NAME = 32;
const MAX_SUPPLY = 1e12;
const MIN_RAISE = 0.01;
const MAX_RAISE = 1e15;
const MAX_CAP_PERCENT = 49;
const MAX_BAND_PERCENT = 20;
const MAX_DAYS = 60;
const SECONDS_PER_DAY = 86_400;

export type Access = "open" | "list" | "credential";
export type FeedChoice = "apple" | "aaplx";

/** The form as typed. Numbers stay text until the plan reads them, so a half typed value is never rounded away. */
export interface LaunchForm {
  name: string;
  symbol: string;
  description: string;
  website: string;
  x: string;
  supply: string;
  /** The id of one of this network's paying tokens, in lib/network. */
  paying: string;
  raise: string;
  keptBack: string;
  capPercent: string;
  access: Access;
  credential: string;
  schema: string;
  band: boolean;
  feed: FeedChoice;
  bandPercent: string;
  endless: boolean;
  days: string;
}

export const DEFAULT_FORM: LaunchForm = {
  name: "",
  symbol: "",
  description: "",
  website: "",
  x: "",
  supply: "1000",
  paying: PAYING_TOKENS[0]?.id ?? "",
  raise: "200000",
  keptBack: "45",
  capPercent: "10",
  access: "open",
  credential: "",
  schema: "",
  band: false,
  feed: "aaplx",
  bandPercent: "5",
  endless: false,
  days: "14",
};

export const FEED_IDS: Record<FeedChoice, string> = {
  apple: APPLE_EXCHANGE_FEED,
  aaplx: AAPLX_FEED,
};

export type FieldName =
  | "name"
  | "symbol"
  | "logo"
  | "description"
  | "website"
  | "x"
  | "supply"
  | "paying"
  | "raise"
  | "keptBack"
  | "capPercent"
  | "credential"
  | "schema"
  | "band"
  | "bandPercent"
  | "days"
  | "wallet";

/** A reason the launch cannot go ahead yet: what the program or the page would say, and what to change. */
export interface Refusal {
  field: FieldName;
  sentence: string;
  change: string;
  /** The program's own error name, shown small beside the sentence, when the refusal is one of its. */
  tag: PanguErrorName | null;
}

/** The stock price the ceiling would follow, read from the app's price route for that feed. */
export interface StockReading {
  price: number;
  /** Unix seconds Pyth published it. */
  publishTime: number | null;
  stale: boolean;
}

export interface PlanContext {
  stock: StockReading | null;
  /** The connected wallet's SOL balance, or null when no wallet is connected or it is still being read. */
  lamports: number | null;
  /** What Irys charges to store the logo and description, once it has been asked. Null when there is nothing to store. */
  storageLamports: number | null;
  /**
   * Unix seconds, to date the end of the offering in the preview, or null
   * before the browser has taken over from the prerendered page. The chain's
   * own clock sets the real end.
   */
  now: number | null;
}

/** Every number the preview shows, computed from the form. */
export interface Preview {
  shape: CurveShape;
  money: Money;
  opening: number;
  graduation: number;
  /** How far under the graduation price the curve opens, 0 to 1. */
  underGraduation: number;
  /** How far under the stock price the curve opens, when a ceiling is on and the price is known. Negative is above it. */
  underStock: number | null;
  points: { share: number; price: number }[];
  /** Whole shares the curve sells before it graduates. */
  curveShares: number;
  capRaw: bigint;
  capShares: number;
  capPercent: number;
  stockPrice: number | null;
  ceiling: number | null;
  /** Where the ceiling bites, as a share of the curve. Below 0: never opens to a buy; above 1: never reached. */
  ceilingShare: number | null;
  /** Unix seconds, from this machine's clock. Null for no end, or before the clock is known. */
  endsAt: number | null;
  offeringDays: number | null;
  /** One sentence per rule, as a buyer will meet it. */
  rules: string[];
}

/** The terms the run sends, all plain values so they can sit in sessionStorage. */
export interface LaunchTerms {
  name: string;
  symbol: string;
  description: string;
  website: string | null;
  x: string | null;
  quoteMint: string;
  /** DBC's badge for the paying token, when it is a stock token that needs one. */
  badge: string | null;
  shape: CurveShape;
  capShareBps: number;
  accessMode: number;
  credential: string | null;
  schema: string | null;
  band: { bps: number; feedId: string } | null;
  offeringDays: number | null;
  /** Identifies the curve alone: a template made for the same key can be reused whatever the rules say. */
  curveKey: string;
}

export interface LaunchPlan {
  refusals: Refusal[];
  preview: Preview | null;
  terms: LaunchTerms | null;
}

function number(text: string): number | null {
  const cleaned = text.replace(/[,_\s]/g, "");
  if (cleaned === "") {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function wholeIn(text: string, min: number, max: number): number | null {
  const value = number(text);
  return value !== null && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function address(text: string): PublicKey | null {
  try {
    return new PublicKey(text.trim());
  } catch {
    return null;
  }
}

/**
 * Reads the form into a preview, the terms the run would send, and every reason
 * it cannot be sent yet.
 *
 * Nothing here reads the chain. The curve is Meteora's own builder run on this
 * machine, so the tokens on the curve and the cap are the numbers the template
 * will hold; the opening price is the terminal launch's formula, which
 * lab-evidence/launch-curve-check.txt holds to the templates on devnet.
 */
export function planLaunch(form: LaunchForm, context: PlanContext): LaunchPlan {
  const refusals: Refusal[] = [];
  const refuse = (
    field: FieldName,
    sentence: string,
    change: string,
    tag: PanguErrorName | null = null
  ) => refusals.push({ field, sentence, change, tag });

  const name = form.name.trim();
  if (name === "") {
    refuse("name", "The token has no name yet.", "Give it the name buyers will see, up to 32 characters.");
  } else if (name.length > MAX_NAME) {
    refuse("name", `The name is ${name.length} characters and Meteora keeps 32.`, "Shorten the name.");
  }

  const symbol = form.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) {
    refuse(
      "symbol",
      symbol === ""
        ? "The token has no symbol yet."
        : `"${symbol.slice(0, 16)}" is not 2 to 10 letters or digits.`,
      "Use 2 to 10 letters or digits, like AAPLS."
    );
  }

  const description = form.description.trim();
  if (description.length > MAX_DESCRIPTION) {
    refuse(
      "description",
      `The description is ${description.length} characters and wallets are handed ${MAX_DESCRIPTION} at most.`,
      "Shorten it."
    );
  }
  const website = checkWebsite(form.website);
  if (website.refusal !== null) {
    refuse("website", website.refusal, "Fix the address or leave the box empty.");
  }
  const x = checkX(form.x);
  if (x.refusal !== null) {
    refuse("x", x.refusal, "Fix the link or leave the box empty.");
  }

  const known = payingToken(form.paying);
  if (known === null) {
    refuse("paying", "The paying token this form names is not offered on this network.", "Pick what buyers pay in.");
  }
  const paying: PayingToken = known ?? (PAYING_TOKENS[0] as PayingToken);
  const quoteDecimals = paying.decimals;
  const baseDecimals = paying.saleDecimals;
  const money = paying.unit;
  // A ceiling is a dollar price, so it only means something on a sale paid in
  // a dollar the program lists for this network.
  const priced = isListedDollar(paying.mint);
  const dollar = PAYING_TOKENS.find((token) => isListedDollar(token.mint)) ?? null;

  const supply = wholeIn(form.supply, 1, MAX_SUPPLY);
  if (supply === null) {
    refuse("supply", "The number of shares has to be a whole number from 1 to a trillion.", "Type a whole number of shares.");
  } else if (!fitsRaw(supply, baseDecimals)) {
    refuse(
      "supply",
      `${supply.toLocaleString("en-US")} shares at ${baseDecimals} decimals is more than a token account can count.`,
      "Use fewer shares."
    );
  }

  const raise = number(form.raise);
  if (raise === null || raise < MIN_RAISE || raise > MAX_RAISE) {
    refuse(
      "raise",
      `The raise target has to be between 0.01 and a quadrillion ${money}.`,
      "Type the amount the curve should take in before it graduates."
    );
  } else if (!fitsRaw(raise, quoteDecimals)) {
    refuse(
      "raise",
      `A raise of ${raise.toLocaleString("en-US")} ${money} is more than a token account can count.`,
      "Lower the raise target."
    );
  }

  const keptBack = wholeIn(form.keptBack, MIN_MIGRATION_PERCENT, MAX_MIGRATION_PERCENT);
  if (keptBack === null) {
    refuse(
      "keptBack",
      `Meteora builds this curve keeping back ${MIN_MIGRATION_PERCENT} to ${MAX_MIGRATION_PERCENT} percent of the shares for trading after the sale. At 50 its builder fails with a subtraction overflow.`,
      `Pick a whole number from ${MIN_MIGRATION_PERCENT} to ${MAX_MIGRATION_PERCENT}.`
    );
  }

  const capValue = number(form.capPercent);
  let capPercent: number | null = null;
  if (capValue !== null && capValue >= 100) {
    refuse(
      "capPercent",
      explainPanguError("CapCoversWholeSale"),
      `Set the cap from 1 to ${MAX_CAP_PERCENT} percent.`,
      "CapCoversWholeSale"
    );
  } else if (capValue === null || !Number.isInteger(capValue) || capValue < 1) {
    refuse("capPercent", explainPanguError("ZeroCap"), `Set the cap from 1 to ${MAX_CAP_PERCENT} percent.`, "ZeroCap");
  } else if (capValue > MAX_CAP_PERCENT) {
    refuse(
      "capPercent",
      `A cap of ${capValue} percent lets two wallets take the whole curve between them.`,
      `Keep it at ${MAX_CAP_PERCENT} percent or under.`
    );
  } else {
    capPercent = capValue;
  }

  const accessMode =
    form.access === "open"
      ? ACCESS_MODE.open
      : form.access === "list"
        ? ACCESS_MODE.issuerList
        : ACCESS_MODE.verifierCredential;
  let credential: PublicKey | null = null;
  let schema: PublicKey | null = null;
  if (form.access === "credential") {
    credential = address(form.credential);
    schema = address(form.schema);
    if (credential === null) {
      refuse(
        "credential",
        explainPanguError("InvalidAccessMode"),
        "Paste the credential's address from the verifier.",
        "InvalidAccessMode"
      );
    }
    if (schema === null) {
      refuse(
        "schema",
        explainPanguError("InvalidAccessMode"),
        "Paste the address of the credential's schema.",
        "InvalidAccessMode"
      );
    }
  }

  let bandBps: number | null = null;
  if (form.band) {
    if (!priced) {
      refuse(
        "band",
        explainPanguError("BandNeedsDollarQuote"),
        dollar === null
          ? "Switch the price ceiling off."
          : `Have buyers pay in ${dollar.called}, or switch the price ceiling off.`,
        "BandNeedsDollarQuote"
      );
    }
    const bandPercent = wholeIn(form.bandPercent, 1, MAX_BAND_PERCENT);
    if (bandPercent === null) {
      refuse(
        "bandPercent",
        explainPanguError("InvalidBand"),
        `Pick a whole number from 1 to ${MAX_BAND_PERCENT} percent over the stock price.`,
        "InvalidBand"
      );
    } else {
      bandBps = bandPercent * 100;
    }
  }

  let offeringDays: number | null = null;
  if (!form.endless) {
    const days = number(form.days);
    if (days === null || !Number.isInteger(days) || days < 1) {
      refuse("days", explainPanguError("EndInThePast"), `Pick 1 to ${MAX_DAYS} days, or no end.`, "EndInThePast");
    } else if (days > MAX_DAYS) {
      refuse("days", `${days} days is longer than a launch from this page offers.`, `Pick 1 to ${MAX_DAYS} days, or no end.`);
    } else {
      offeringDays = days;
    }
  }

  if (context.storageLamports !== null && context.storageLamports > MAX_STORAGE_LAMPORTS) {
    refuse(
      "logo",
      `Irys prices storing these files at ${(context.storageLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL, more than the ${
        MAX_STORAGE_LAMPORTS / LAMPORTS_PER_SOL
      } SOL this page will pay.`,
      "Use a smaller logo, or wait a while and launch again."
    );
  }

  const needed = LAUNCH_COST_LAMPORTS + (context.storageLamports ?? 0);
  if (context.lamports !== null && context.lamports < needed) {
    refuse(
      "wallet",
      `This wallet holds ${(context.lamports / LAMPORTS_PER_SOL).toFixed(4)} ${CHAIN.sol} and a launch costs about ${(
        needed / LAMPORTS_PER_SOL
      ).toFixed(4)}${context.storageLamports === null ? "" : ", storing the logo included"}.`,
      FAUCET_ON ? "Top it up from faucet.solana.com, then launch." : "Add SOL to it, then launch."
    );
  }

  if (
    supply === null ||
    raise === null ||
    keptBack === null ||
    !fitsRaw(supply, baseDecimals) ||
    !fitsRaw(raise, quoteDecimals)
  ) {
    return { refusals, preview: null, terms: null };
  }

  const shape: CurveShape = { quoteDecimals, baseDecimals, supply, migrationPercent: keptBack, threshold: raise };
  let built;
  try {
    built = builtCurve(shape);
  } catch (error) {
    refuse(
      "raise",
      `Meteora's curve builder refuses this shape: ${error instanceof Error ? error.message : String(error)}.`,
      "Change the shares, the raise or the share kept back."
    );
    return { refusals, preview: null, terms: null };
  }

  let capRaw = 0n;
  if (capPercent !== null) {
    try {
      capRaw = capFromShare(built.swapBaseAmount, capPercent * 100);
    } catch {
      capPercent = null;
      refuse("capPercent", explainPanguError("ZeroCap"), "Raise the cap or the number of shares.", "ZeroCap");
    }
  }

  const scale = 10 ** baseDecimals;
  const opening = openingPrice(shape);
  const graduation = graduationPrice(shape);
  const stockPrice = bandBps !== null && context.stock !== null ? context.stock.price : null;
  const ceiling = stockPrice !== null && bandBps !== null ? stockPrice * (1 + bandBps / 10_000) : null;
  const ceilingShare = ceiling !== null && priced ? shareSoldAtPrice(shape, ceiling) : null;
  const endsAt = offeringDays === null || context.now === null ? null : context.now + offeringDays * SECONDS_PER_DAY;

  const preview: Preview = {
    shape,
    money,
    opening,
    graduation,
    underGraduation: 1 - opening / graduation,
    underStock: stockPrice !== null && priced ? 1 - opening / stockPrice : null,
    points: curvePoints(shape, 72),
    curveShares: Number(built.swapBaseAmount) / scale,
    capRaw,
    capShares: Number(capRaw) / scale,
    capPercent: capPercent ?? 0,
    stockPrice,
    ceiling,
    ceilingShare,
    endsAt,
    offeringDays,
    rules: [],
  };
  preview.rules = ruleSentences(form, preview, bandBps);

  const quoteMint = paying.mint;
  const terms: LaunchTerms | null =
    refusals.length === 0 && capPercent !== null
      ? {
          name,
          symbol,
          description,
          website: website.url,
          x: x.url,
          quoteMint,
          badge: paying.badge,
          shape,
          capShareBps: capPercent * 100,
          accessMode,
          credential: credential?.toBase58() ?? null,
          schema: schema?.toBase58() ?? null,
          band: bandBps === null ? null : { bps: bandBps, feedId: FEED_IDS[form.feed] },
          offeringDays,
          curveKey: JSON.stringify({ quoteMint, ...shape }),
        }
      : null;

  return { refusals, preview, terms };
}

/** Shares as the readout writes them: cut, never rounded up, so the cap never reads larger than it is. */
function wholeShares(value: number): string {
  if (value > 1000) {
    return Math.floor(value).toLocaleString("en-US");
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 4 : 2, roundingMode: "trunc" });
}

/** One sentence per rule, in the words a buyer meets it in. */
function ruleSentences(form: LaunchForm, preview: Preview, bandBps: number | null): string[] {
  const rules: string[] = [
    `No wallet can end up holding more than ${wholeShares(preview.capShares)} shares, ${preview.capPercent} percent of what the curve sells, however many buys or accounts it spreads them over.`,
    form.access === "open"
      ? "Anyone with a wallet can buy."
      : form.access === "list"
        ? "Only wallets you approve can buy. You add and remove them after launch, one transaction each."
        : "Only wallets carrying the verifier's credential under the schema you named can buy.",
  ];
  if (bandBps !== null) {
    const feed = feedWords(FEED_IDS[form.feed]);
    const over = `No buy may leave the price more than ${bandBps / 100} percent over ${feed.price}.`;
    const { ceiling, ceilingShare } = preview;
    if (ceiling === null || ceilingShare === null) {
      rules.push(over);
    } else if (ceilingShare <= 0) {
      rules.push(
        `${over} At $${ceiling.toFixed(2)} today that is under the opening price, so every buy waits until the stock rises.`
      );
    } else if (ceilingShare >= 1) {
      rules.push(`${over} At $${ceiling.toFixed(2)} today this curve ends below it, so the ceiling never bites.`);
    } else {
      rules.push(
        `${over} At $${ceiling.toFixed(2)} today, buying stops once ${(ceilingShare * 100).toFixed(0)} percent of the curve has sold, until the stock moves up.`
      );
    }
    rules.push("With no fresh stock price, buys wait for one.");
  }
  rules.push(
    preview.offeringDays === null
      ? "The rules hold until the curve fills and the token graduates."
      : `Every rule lifts ${preview.offeringDays} ${preview.offeringDays === 1 ? "day" : "days"} after launch, cap and access included, and the token then moves freely.`
  );
  rules.push("Selling back to the pool is always open.");
  return rules;
}

/** True when the launch has anything to store on Irys: a logo, a description or a link. Without any, the storage step is left out. */
export function storesMetadata(form: LaunchForm, hasLogo: boolean): boolean {
  return hasLogo || form.description.trim() !== "" || form.website.trim() !== "" || form.x.trim() !== "";
}

export type StepId = "metadata" | "template" | "sale";

export const STEPS: readonly { id: StepId; title: string; detail: string }[] = [
  {
    id: "metadata",
    title: "Store the logo and description",
    detail: "On Irys, paid from your wallet, which signs each file",
  },
  {
    id: "template",
    title: "The launch template",
    detail: "Meteora's curve, with Pangu's settings fixed in it",
  },
  {
    id: "sale",
    title: "The pool and the sale's rules",
    detail: "One transaction, so nobody else can set this sale's rules",
  },
];

export type StepStatus =
  | "waiting"
  | "checking"
  | "pricing"
  | "funding"
  | "crediting"
  | "uploading-logo"
  | "uploading-json"
  | "building"
  | "simulating"
  | "signing"
  | "sending"
  | "done"
  | "reused"
  | "failed";

export interface StepFailure {
  sentence: string;
  tag: PanguErrorName | null;
  /** What exists on chain after this failure, in plain words. */
  onChain: string;
  /** A link to what exists, when something does. */
  onChainLink: string | null;
  /** What pressing Launch again will do. */
  next: string;
}

export interface StepState {
  status: StepStatus;
  signature: string | null;
  failure: StepFailure | null;
  /** The storage step only: what Irys priced the files at for this press, in lamports, before the wallet pays. */
  lamports?: number;
}

/** The sale as the chain holds it once both transactions landed. */
export interface ReadBack {
  cap: string;
  accessMode: number;
  bandBps: number | null;
  priceFeedId: string | null;
  endsAt: number | null;
  credential: string | null;
  schema: string | null;
  issuer: string;
  baseDecimals: number;
}

export interface LaunchResult {
  mint: string;
  pool: string;
  config: string;
  rules: string;
  extraAccountList: string;
  templateSignature: string | null;
  saleSignature: string | null;
  sale: ReadBack;
  /** The token's name, symbol and metadata link as the mint itself carries them, read back after launch. */
  token: { name: string; symbol: string; uri: string } | null;
  /** The metadata link this launch stored, to hold against the one the mint carries. */
  storedUri: string | null;
  /** What Irys priced the two files at, and the transfer that funded them when one was needed. */
  storage: { priceLamports: number; fundSignature: string | null; fundLamports: number } | null;
  /** Lamports this press of Launch took from the wallet, read off the chain before and after. */
  spentLamports: number | null;
  /** True when an earlier press had already landed part of this launch. */
  resumed: boolean;
}

/** The wallet as the launch needs it. The wallet adapter's own hook hands over exactly this. */
export interface LaunchWallet {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(transactions: T[]) => Promise<T[]>;
  /** Irys has each stored file signed as a message. */
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  /** Irys sends its own funding transfer through the wallet. */
  sendTransaction?: (
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: SendOptions
  ) => Promise<string>;
}

/**
 * What survives a reload between two presses of Launch: the form, public keys
 * and signatures. The keys that sign for new accounts are never in here; each
 * lives in one local variable for the length of its own step.
 */
export interface Progress {
  form: LaunchForm;
  curveKey: string;
  config: string | null;
  templateSignature: string | null;
  mint: string | null;
  pool: string | null;
  saleSignature: string | null;
}

const STORE_PREFIX = "pangu-launch:";

function storeKey(wallet: PublicKey | string): string {
  return `${STORE_PREFIX}${typeof wallet === "string" ? wallet : wallet.toBase58()}`;
}

export function loadProgress(wallet: PublicKey | string): Progress | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(storeKey(wallet));
    return raw === null ? null : (JSON.parse(raw) as Progress);
  } catch {
    return null;
  }
}

function saveProgress(wallet: PublicKey, progress: Progress): void {
  try {
    window.sessionStorage.setItem(storeKey(wallet), JSON.stringify(progress));
  } catch {
    // A browser with storage switched off still launches; it only loses the
    // ability to resume after a reload.
  }
}

export function clearProgress(wallet: PublicKey | string): void {
  try {
    window.sessionStorage.removeItem(storeKey(wallet));
    window.sessionStorage.removeItem(uploadKey(wallet));
  } catch {
    // Nothing to clear.
  }
}

/**
 * What this launch already stored on Irys, kept apart from the progress
 * because it is written before the first transaction and outlives a changed
 * curve. `stored.uri` is empty while only the logo has landed. `unsentFund` is
 * a funding transfer that went out but never reached the Irys node's books.
 */
export interface UploadRecord {
  stored: StoredMetadata | null;
  unsentFund: string | null;
}

const UPLOAD_PREFIX = "pangu-launch-upload:";

function uploadKey(wallet: PublicKey | string): string {
  return `${UPLOAD_PREFIX}${typeof wallet === "string" ? wallet : wallet.toBase58()}`;
}

export function loadUpload(wallet: PublicKey | string): UploadRecord | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(uploadKey(wallet));
    return raw === null ? null : (JSON.parse(raw) as UploadRecord);
  } catch {
    return null;
  }
}

function saveUpload(wallet: PublicKey, record: UploadRecord): void {
  try {
    window.sessionStorage.setItem(uploadKey(wallet), JSON.stringify(record));
  } catch {
    // Without storage a failed launch stores its logo again on the next press.
  }
}

/** What pressing Launch will do for this wallet and these terms, said before it is pressed. */
export type ResumeState =
  | { kind: "fresh" }
  | { kind: "finish"; config: string; templateSignature: string }
  | { kind: "new-curve"; config: string }
  | { kind: "check-sale"; mint: string };

export function resumeState(progress: Progress | null, terms: LaunchTerms | null): ResumeState {
  if (progress === null) {
    return { kind: "fresh" };
  }
  if (progress.mint !== null && progress.saleSignature !== null) {
    return { kind: "check-sale", mint: progress.mint };
  }
  if (progress.config !== null && progress.templateSignature !== null) {
    return terms === null || terms.curveKey === progress.curveKey
      ? { kind: "finish", config: progress.config, templateSignature: progress.templateSignature }
      : { kind: "new-curve", config: progress.config };
  }
  return { kind: "fresh" };
}

/** A failure the run already put into words, with what is on chain and what comes next. */
export class StepError extends Error {
  readonly step: StepId;
  readonly failure: StepFailure;

  constructor(step: StepId, failure: StepFailure) {
    super(failure.sentence);
    this.name = "StepError";
    this.step = step;
    this.failure = failure;
  }
}

const NOTHING_YET = "Nothing from this launch is on chain yet.";

type Say = (sentence: string, tag?: PanguErrorName | null) => StepFailure;

/**
 * Sends the launch, one step at a time, telling `onStep` where each one is.
 *
 * Before anything is built it reads this wallet's earlier try out of
 * sessionStorage and checks it against the chain. A sale that already opened
 * is read back and returned. A template this wallet already made for exactly
 * this curve is checked against the chain and reused, so pressing Launch after
 * a failed second step finishes the launch instead of paying for a second
 * template.
 *
 * Every transaction is simulated before the wallet is asked to sign it, so a
 * refusal the program would give is shown with nothing spent. The second
 * transaction cannot be built until the first has landed, because
 * openSaleTransaction reads the new template off the chain, so the wallet is
 * asked once per step.
 *
 * Throws a StepError, whose failure says what exists on chain and what to do,
 * for anything a person can act on.
 */
export async function runLaunch(
  terms: LaunchTerms,
  form: LaunchForm,
  logo: File | null,
  wallet: LaunchWallet,
  connection: Connection,
  onStep: (id: StepId, state: StepState) => void
): Promise<LaunchResult> {
  const owner = wallet.publicKey;
  const quoteMint = new PublicKey(terms.quoteMint);
  let progress = loadProgress(owner);
  const storing = logo !== null || terms.description !== "" || terms.website !== null || terms.x !== null;

  onStep(storing ? "metadata" : "template", { status: "checking", signature: null, failure: null });

  if (progress !== null && progress.mint !== null) {
    const opened = await getSale(connection, new PublicKey(progress.mint));
    if (opened !== null) {
      const upload = loadUpload(owner)?.stored ?? null;
      if (storing) {
        onStep("metadata", { status: "done", signature: upload?.fundSignature ?? null, failure: null });
      }
      onStep("template", { status: "done", signature: progress.templateSignature, failure: null });
      onStep("sale", { status: "done", signature: progress.saleSignature, failure: null });
      const result = await readBack(
        connection,
        progress.mint,
        progress.config ?? "",
        progress.templateSignature,
        progress.saleSignature,
        null,
        true,
        upload !== null && upload.uri !== "" ? upload : null
      );
      clearProgress(owner);
      return result;
    }
    // The sale step was sent and never landed. Its mint key went with the
    // press that made it and nothing was written under that mint, so the step
    // starts again with a new one.
    progress = { ...progress, mint: null, pool: null, saleSignature: null };
  }

  try {
    await preSendChecks(connection, terms, owner, quoteMint);
  } catch (error) {
    if (storing) {
      onStep("metadata", { status: "waiting", signature: null, failure: null });
    }
    throw error;
  }
  const startedWith = await connection.getBalance(owner, "confirmed");

  // With no logo, description or link there is nothing to store, and the mint
  // carries an empty metadata link rather than one to an empty file.
  const stored = storing ? await storeMetadata(terms, logo, wallet, onStep) : null;

  let config: PublicKey | null = null;
  let templateSignature: string | null = null;
  let resumed = false;
  if (
    progress !== null &&
    progress.config !== null &&
    progress.templateSignature !== null &&
    progress.curveKey === terms.curveKey &&
    (await templateMatches(connection, new PublicKey(progress.config), terms, owner))
  ) {
    config = new PublicKey(progress.config);
    templateSignature = progress.templateSignature;
    resumed = true;
    onStep("template", { status: "reused", signature: templateSignature, failure: null });
  }

  if (config === null || templateSignature === null) {
    onStep("template", { status: "building", signature: null, failure: null });
    const sayTemplate: Say = (sentence, tag = null) => ({
      sentence,
      tag,
      onChain: NOTHING_YET,
      onChainLink: null,
      next: "Press Launch again to start this step over; nothing has been spent.",
    });
    let template;
    try {
      template = await launchTemplateTransaction({
        connection,
        partner: owner,
        quoteMint,
        curve: demoCurve(terms.shape),
        ...(terms.badge !== null ? { tokenBadge: new PublicKey(terms.badge) } : {}),
      });
    } catch (error) {
      return fail(onStep, "template", sayTemplate(messageOf(error)), null);
    }
    progress = {
      form,
      curveKey: terms.curveKey,
      config: template.config.publicKey.toBase58(),
      templateSignature: null,
      mint: null,
      pool: null,
      saleSignature: null,
    };
    saveProgress(owner, progress);
    templateSignature = await simulateSignSend(
      connection,
      "template",
      template.transaction,
      wallet,
      template.config,
      onStep,
      sayTemplate
    );
    config = template.config.publicKey;
    progress = { ...progress, templateSignature };
    saveProgress(owner, progress);
    onStep("template", { status: "done", signature: templateSignature, failure: null });
  }

  const templateLink = explorerTx(templateSignature);
  const saySale: Say = (sentence, tag = null) => ({
    sentence,
    tag,
    onChain: "The launch template is on chain. No pool and no sale yet.",
    onChainLink: templateLink,
    next:
      tag !== null
        ? "Change what the sentence names and press Launch again to finish; the curve template already exists and will be reused while the shares, the raise and the share kept back stay the same."
        : "Press Launch again to finish; the curve template already exists and will be reused.",
  });

  onStep("sale", { status: "building", signature: null, failure: null });
  let opened;
  try {
    const endsAt =
      terms.offeringDays === null ? 0 : (await chainTime(connection)) + terms.offeringDays * SECONDS_PER_DAY;
    opened = await openSaleTransaction({
      connection,
      creator: owner,
      config,
      name: terms.name,
      symbol: terms.symbol,
      uri: stored?.uri ?? "",
      sale: {
        capShareBps: terms.capShareBps,
        accessMode: terms.accessMode,
        ...(terms.credential !== null && terms.schema !== null
          ? { credential: new PublicKey(terms.credential), schema: new PublicKey(terms.schema) }
          : {}),
        ...(terms.band !== null
          ? {
              band: {
                bps: terms.band.bps,
                priceFeedId: terms.band.feedId,
                shard: PANGU_SHARD_ID,
                maxPriceAgeSecs: MAX_PRICE_AGE_SECS,
                maxConfBps: MAX_CONF_BPS,
              },
            }
          : {}),
        ...(endsAt > 0 ? { endsAt } : {}),
      },
      // DBC refuses a pool paid in a stock token unless its badge is named on
      // the pool instruction as well as on the template.
      ...(terms.badge !== null ? { tokenBadge: new PublicKey(terms.badge) } : {}),
    });
  } catch (error) {
    return fail(onStep, "sale", saySale(messageOf(error)), null);
  }

  const base: Progress = progress ?? {
    form,
    curveKey: terms.curveKey,
    config: config.toBase58(),
    templateSignature,
    mint: null,
    pool: null,
    saleSignature: null,
  };
  const mint = opened.baseMint.publicKey.toBase58();
  saveProgress(owner, { ...base, mint, pool: opened.pool.toBase58(), saleSignature: null });

  let saleSignature: string;
  try {
    saleSignature = await simulateSignSend(connection, "sale", opened.transaction, wallet, opened.baseMint, onStep, saySale);
  } catch (error) {
    // Nothing landed under this mint, so the next press makes a new one.
    saveProgress(owner, { ...base, mint: null, pool: null, saleSignature: null });
    throw error;
  }
  saveProgress(owner, { ...base, mint, pool: opened.pool.toBase58(), saleSignature });
  onStep("sale", { status: "done", signature: saleSignature, failure: null });

  const spent = startedWith - (await connection.getBalance(owner, "confirmed"));
  const result = await readBack(connection, mint, config.toBase58(), templateSignature, saleSignature, spent, resumed, stored);
  clearProgress(owner);
  return result;
}

/** A wallet without a way Irys needs: message signing for the files, or sending for the funding transfer. */
class WalletCannot extends Error {
  constructor(what: "sign messages" | "send transactions") {
    super(`This wallet cannot ${what}`);
    this.name = "WalletCannot";
  }
}

/**
 * The first step: the logo and the metadata JSON on Irys, or the ones an
 * earlier press of this launch already stored when nothing about them has
 * changed. Each file that lands is written to sessionStorage at once, so a
 * press that stops halfway never pays to store the same logo twice.
 */
async function storeMetadata(
  terms: LaunchTerms,
  logo: File | null,
  wallet: LaunchWallet,
  onStep: (id: StepId, state: StepState) => void
): Promise<StoredMetadata> {
  const owner = wallet.publicKey;
  const record: UploadRecord = loadUpload(owner) ?? { stored: null, unsentFund: null };
  let fundSignature: string | null = null;
  let priced: number | undefined;
  const show = (status: StepStatus) =>
    onStep("metadata", { status, signature: fundSignature, failure: null, lamports: priced });

  const onStage = (stage: UploadStage) => {
    if (stage.stage === "pricing") {
      show("pricing");
    } else if (stage.stage === "priced") {
      priced = stage.lamports;
      show("pricing");
    } else if (stage.stage === "funding") {
      show("funding");
    } else if (stage.stage === "crediting") {
      fundSignature = stage.signature;
      record.unsentFund = null;
      saveUpload(owner, record);
      show("crediting");
    } else if (stage.stage === "uploading") {
      show(stage.file === "logo" ? "uploading-logo" : "uploading-json");
    } else if (stage.stage === "logo-stored" && record.stored?.imageSha !== stage.imageSha) {
      record.stored = {
        uri: "",
        imageUri: stage.imageUri,
        imageType: stage.imageType,
        imageSha: stage.imageSha,
        textKey: "",
        priceLamports: 0,
        fundSignature,
        fundLamports: 0,
      };
      saveUpload(owner, record);
    }
  };

  const previous = record.stored;
  try {
    const stored = await uploadMetadata(
      {
        publicKey: owner,
        signMessage: wallet.signMessage ?? (() => Promise.reject(new WalletCannot("sign messages"))),
        sendTransaction: wallet.sendTransaction ?? (() => Promise.reject(new WalletCannot("send transactions"))),
      },
      {
        name: terms.name,
        symbol: terms.symbol,
        description: terms.description,
        image: logo,
        links: { website: terms.website, x: terms.x },
      },
      { previous, unsentFund: record.unsentFund, onStage }
    );
    saveUpload(owner, { stored, unsentFund: null });
    onStep("metadata", {
      status: stored === previous ? "reused" : "done",
      signature: stored.fundSignature,
      failure: null,
    });
    return stored;
  } catch (error) {
    const unsent = unsentFundOf(error);
    if (unsent !== null) {
      record.unsentFund = unsent;
      saveUpload(owner, record);
    }
    const paid = fundSignature ?? unsent;
    const text = messageOf(error);
    return fail(
      onStep,
      "metadata",
      {
        sentence:
          error instanceof LogoRefused || error instanceof StorageTooDear
            ? error.message
            : error instanceof WalletCannot
              ? `${error.message}, and Irys needs it to store the logo. Connect Phantom, Solflare or Backpack.`
              : /reject|declin|denied|cancel/i.test(text)
                ? "You turned this down in your wallet, so nothing more was stored."
                : /\b402\b/.test(text)
                  ? "Irys says this wallet's balance there does not cover the files yet."
                  : `Irys did not store the files: ${text}`,
        tag: null,
        onChain:
          paid === null
            ? NOTHING_YET
            : "Your wallet paid Irys for the files. The payment stays in your Irys balance and covers the next try; nothing for the sale is on chain yet.",
        onChainLink: paid === null ? null : explorerTx(paid),
        next: "Press Launch again; anything already stored is used again rather than paid for twice.",
      },
      paid
    );
  }
}

function fail(
  onStep: (id: StepId, state: StepState) => void,
  step: StepId,
  failure: StepFailure,
  signature: string | null
): never {
  onStep(step, { status: "failed", signature, failure });
  throw new StepError(step, failure);
}

/**
 * What the program would refuse that only the chain can answer: a paying token
 * whose decimals are not the ones the curve was worked out for, one the issuer
 * can freeze, and a verifier's accounts that do not exist.
 */
async function preSendChecks(
  connection: Connection,
  terms: LaunchTerms,
  owner: PublicKey,
  quoteMint: PublicKey
): Promise<void> {
  const say = (sentence: string, tag: PanguErrorName | null = null): StepFailure => ({
    sentence,
    tag,
    onChain: NOTHING_YET,
    onChainLink: null,
    next: "Change what the sentence names and press Launch again.",
  });
  const info = await connection.getAccountInfo(quoteMint, "confirmed");
  if (info === null) {
    throw new StepError("template", say(`The paying token has no mint on ${CHAIN.inSentence}.`));
  }
  const state = await getMint(connection, quoteMint, "confirmed", info.owner);
  if (state.decimals !== terms.shape.quoteDecimals) {
    throw new StepError(
      "template",
      say(
        `The paying token has ${state.decimals} decimals on ${CHAIN.inSentence}, not the ${terms.shape.quoteDecimals} this curve was worked out for.`
      )
    );
  }
  if (state.freezeAuthority !== null && state.freezeAuthority.equals(owner)) {
    throw new StepError(
      "template",
      say(explainPanguError("IssuerControlsPayingToken"), "IssuerControlsPayingToken")
    );
  }
  if (terms.credential !== null && terms.schema !== null) {
    const [credential, schema] = await connection.getMultipleAccountsInfo(
      [new PublicKey(terms.credential), new PublicKey(terms.schema)],
      "confirmed"
    );
    if (credential === null || schema === null) {
      throw new StepError(
        "template",
        say(
          `${credential === null ? "The credential" : "The schema"} address has no account on ${CHAIN.inSentence}, so no buyer could ever carry it.`
        )
      );
    }
  }
}

/**
 * True when the template at this address was made by this wallet for exactly
 * this curve: the paying token, the fee claimer, and the tokens on the curve
 * as Meteora's builder makes them for these numbers.
 */
async function templateMatches(
  connection: Connection,
  config: PublicKey,
  terms: LaunchTerms,
  owner: PublicKey
): Promise<boolean> {
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  let state;
  try {
    state = await client.state.getPoolConfig(config);
  } catch {
    return false;
  }
  if (state === null) {
    return false;
  }
  return (
    state.quoteMint.toBase58() === terms.quoteMint &&
    state.feeClaimer.equals(owner) &&
    BigInt(state.swapBaseAmount.toString()) === builtCurve(terms.shape).swapBaseAmount
  );
}

/**
 * Lighthouse, the guard program Phantom adds instructions for on some mainnet
 * transactions. The address is LIGHTHOUSE_PROGRAM_ADDRESS in lighthouse-sdk
 * 2.1.0 on npm, and an executable program on devnet and mainnet.
 */
export const LIGHTHOUSE_PROGRAM_ID = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");

const CHANGED_OURS =
  "The wallet changed, reordered or dropped one of the instructions this page built, so the launch did not sign it. Nothing was sent.";

/** The only programs a wallet may add its own instructions for. */
const WALLET_MAY_ADD: readonly PublicKey[] = [ComputeBudgetProgram.programId, LIGHTHOUSE_PROGRAM_ID];

function sameMeta(returned: AccountMeta, built: AccountMeta): boolean {
  // The message merges every instruction's account flags, so an account the
  // wallet's own instruction writes to can come back writable here. Gaining a
  // flag changes nothing this instruction asked for; losing one would.
  return (
    returned.pubkey.equals(built.pubkey) &&
    (returned.isSigner || !built.isSigner) &&
    (returned.isWritable || !built.isWritable)
  );
}

function sameInstruction(returned: TransactionInstruction, built: TransactionInstruction): boolean {
  return (
    returned.programId.equals(built.programId) &&
    returned.data.equals(built.data) &&
    returned.keys.length === built.keys.length &&
    returned.keys.every((meta, place) => sameMeta(meta, built.keys[place]!))
  );
}

/**
 * Why the transaction a wallet handed back must not be signed for the launch,
 * or null when it may.
 *
 * It must still carry every instruction the page built, byte for byte and in
 * the order built, with the same fee payer. Anything the wallet added may only
 * be for the compute budget or for Lighthouse, whose instructions check an
 * account's state and fail the transaction when it is not what was expected.
 * Any other change is refused with a sentence the launch shows.
 */
export function walletChangeRefusal(
  built: readonly TransactionInstruction[],
  returned: Transaction,
  payer: PublicKey
): string | null {
  if (returned.feePayer === undefined || !returned.feePayer.equals(payer)) {
    return "The wallet changed who pays for this transaction, so the launch did not sign it. Nothing was sent.";
  }
  let next = 0;
  for (const instruction of returned.instructions) {
    const ours = built[next];
    if (ours !== undefined && sameInstruction(instruction, ours)) {
      next += 1;
    } else if (!WALLET_MAY_ADD.some((program) => program.equals(instruction.programId))) {
      return next < built.length && built.some((own) => own.programId.equals(instruction.programId))
        ? CHANGED_OURS
        : `The wallet added an instruction for a program this page does not accept, ${instruction.programId.toBase58()}, so the launch did not sign it. Nothing was sent.`;
    }
  }
  if (next < built.length) {
    return CHANGED_OURS;
  }
  return null;
}

/**
 * Simulates, signs and sends one step's transaction, and waits for it.
 *
 * The wallet signs first and the step's own new account second, over the
 * message the wallet handed back. A wallet such as Phantom may add its own
 * guard instructions while signing, which would leave a signature made before
 * it over a message that is no longer the one sent. The returned message is
 * checked by walletChangeRefusal before the account signs it.
 */
async function simulateSignSend(
  connection: Connection,
  step: StepId,
  transaction: Transaction,
  wallet: LaunchWallet,
  account: { publicKey: PublicKey; secretKey: Uint8Array },
  onStep: (id: StepId, state: StepState) => void,
  say: Say
): Promise<string> {
  onStep(step, { status: "simulating", signature: null, failure: null });
  const simulated = await connection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  if (simulated.value.err !== null) {
    const refused = refusalOf(simulated.value.logs ?? [], simulated.value.err);
    return fail(onStep, step, say(refused.sentence, refused.tag), null);
  }

  onStep(step, { status: "signing", signature: null, failure: null });
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = wallet.publicKey;
  const built = [...transaction.instructions];

  let signed: Transaction;
  try {
    signed =
      wallet.signAllTransactions !== undefined
        ? ((await wallet.signAllTransactions([transaction]))[0] as Transaction)
        : await wallet.signTransaction(transaction);
  } catch (error) {
    const text = messageOf(error);
    return fail(
      onStep,
      step,
      say(
        /reject|declin|denied|cancel/i.test(text)
          ? "You turned this down in your wallet, so it was not sent."
          : `The wallet did not sign: ${text}`
      ),
      null
    );
  }
  const changed = walletChangeRefusal(built, signed, wallet.publicKey);
  if (changed !== null) {
    return fail(onStep, step, say(changed), null);
  }
  signed.partialSign(account);
  if (!signed.verifySignatures()) {
    return fail(
      onStep,
      step,
      say("The wallet's signature does not match the transaction it handed back. Nothing was sent."),
      null
    );
  }

  onStep(step, { status: "sending", signature: null, failure: null });
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), {
      preflightCommitment: "confirmed",
      maxRetries: 5,
    });
  } catch (error) {
    const logs = (error as { logs?: string[] } | null)?.logs ?? [];
    const refused = refusalOf(logs, messageOf(error));
    return fail(onStep, step, say(refused.sentence, refused.tag), null);
  }
  onStep(step, { status: "sending", signature, failure: null });

  let landedError: unknown = null;
  try {
    const confirmation = await connection.confirmTransaction(
      // The wallet's blockhash, in case it set a newer one while signing.
      { signature, blockhash: signed.recentBlockhash ?? latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed"
    );
    landedError = confirmation.value.err;
  } catch (error) {
    // Polling rejects with the chain's raw error value for a transaction that
    // landed and failed; a real Error means it may never have landed at all.
    if (error instanceof Error) {
      const status = (await connection.getSignatureStatus(signature, { searchTransactionHistory: true })).value;
      if (status === null) {
        return fail(
          onStep,
          step,
          say(`${CHAIN.atStart} did not confirm this in time and has no record of it, so it did not land.`),
          signature
        );
      }
      landedError = status.err;
    } else {
      landedError = error;
    }
  }
  if (landedError !== null) {
    const detail = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const refused = refusalOf(detail?.meta?.logMessages ?? [], landedError);
    return fail(onStep, step, say(refused.sentence, refused.tag), signature);
  }
  return signature;
}

/** The program's own refusal when it gave one, else the plainest line the logs hold. */
function refusalOf(logs: string[], error: unknown): { sentence: string; tag: PanguErrorName | null } {
  const found = panguErrorFromLogs(logs);
  if (found !== null) {
    return { sentence: explainPanguError(found.name), tag: found.name };
  }
  const raw = typeof error === "string" ? error : JSON.stringify(error);
  if (/insufficient lamports|InsufficientFundsForRent|InsufficientFundsForFee|AccountNotFound/i.test(`${logs.join("\n")}\n${raw}`)) {
    return {
      sentence: `This wallet does not hold enough ${CHAIN.sol} for the launch, about ${(
        LAUNCH_COST_LAMPORTS / LAMPORTS_PER_SOL
      ).toFixed(4)}.`,
      tag: null,
    };
  }
  const spoken = logs.filter(
    (line) => line.startsWith("Program log: ") && !line.startsWith("Program log: Instruction:")
  );
  const said = spoken[spoken.length - 1];
  return {
    sentence: `${CHAIN.atStart} refused it: ${said !== undefined ? said.slice("Program log: ".length) : raw}`,
    tag: null,
  };
}

async function readBack(
  connection: Connection,
  mint: string,
  config: string,
  templateSignature: string | null,
  saleSignature: string | null,
  spentLamports: number | null,
  resumed: boolean,
  stored: StoredMetadata | null
): Promise<LaunchResult> {
  const key = new PublicKey(mint);
  const [sale, token] = await Promise.all([
    getSale(connection, key),
    // The mint's own copy of the name, symbol and link. A missed read shows
    // the logo as unconfirmed on the done state; it never stops the result.
    saleTokenInfo(connection, key).catch(() => null),
  ]);
  if (sale === null) {
    throw new StepError("sale", {
      sentence: "The sale's transaction landed but its rules do not read back yet.",
      tag: null,
      onChain: "The pool and the sale are on chain.",
      onChainLink: explorerAddress(mint),
      next: "Press Launch again in a moment; it reads the sale back rather than sending anything.",
    });
  }
  return {
    mint,
    pool: sale.pool.toBase58(),
    config,
    rules: saleRulesAddress(key).toBase58(),
    extraAccountList: extraAccountListAddress(key).toBase58(),
    templateSignature,
    saleSignature,
    sale: {
      cap: sale.cap.toString(),
      accessMode: sale.accessMode,
      bandBps: sale.hasBand ? sale.bandBps : null,
      priceFeedId: sale.hasBand ? sale.priceFeedId : null,
      endsAt: sale.endsAt,
      credential: sale.accessMode === ACCESS_MODE.verifierCredential ? sale.credential.toBase58() : null,
      schema: sale.accessMode === ACCESS_MODE.verifierCredential ? sale.schema.toBase58() : null,
      issuer: sale.issuer.toBase58(),
      baseDecimals: sale.baseDecimals,
    },
    token,
    storedUri: stored?.uri ?? null,
    storage:
      stored === null
        ? null
        : { priceLamports: stored.priceLamports, fundSignature: stored.fundSignature, fundLamports: stored.fundLamports },
    spentLamports,
    resumed,
  };
}

/** Where the clock sysvar keeps its unix time: after slot, epoch start, epoch and leader epoch. */
const CLOCK_UNIX_TIME_OFFSET = 32;

/**
 * The chain's own unix time. The offering's end is counted from it rather than
 * from this machine, because the chain is what compares against it.
 */
async function chainTime(connection: Connection): Promise<number> {
  const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  if (info === null || info.data.length < CLOCK_UNIX_TIME_OFFSET + 8) {
    throw new Error("the chain returned no clock, so the end of the offering cannot be dated");
  }
  const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
  return Number(view.getBigInt64(CLOCK_UNIX_TIME_OFFSET, true));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
}
