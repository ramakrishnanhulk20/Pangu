import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type ConnectionConfig,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ExtensionType,
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createExecuteInstruction,
  createInitializeAccount3Instruction,
  createInitializeImmutableOwnerInstruction,
  createTransferCheckedInstruction,
  getAccountLen,
  getAccountTypeOfMintType,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMint,
} from "@solana/spl-token";
import {
  ACCESS_MODE,
  DBC_PROGRAM_ID,
  PANGU_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  curvePriceDollars,
  dollars,
  explainPanguError,
  extraAccountListAddress,
  getBuyerRecord,
  getSale,
  isSaleRunning,
  listBuyerRecords,
  panguErrorFromLogs,
  priceCeiling,
  readPrice,
  saleStanding,
  type PanguErrorName,
  type Sale,
} from "pangu-sdk";
import {
  buyTransaction,
  hookAccounts,
  loadPool,
  preflightBuy,
  sellTransaction,
  type BuyPreflight,
  type TradeTransaction,
} from "pangu-sdk/dbc";

/**
 * The endpoint every read and every attack goes through. Nothing here ever
 * talks to mainnet: the program is only deployed on devnet.
 *
 * Spelled out rather than imported from lib/solana so this file stands alone
 * and lab-evidence/break-simulations.mjs can run the very same builders under
 * plain Node, with no bundler and no path aliases.
 */
function devnetRpcUrl(): string {
  const configured = process.env.NEXT_PUBLIC_DEVNET_RPC_URL;
  return configured !== undefined && configured !== ""
    ? configured
    : "https://api.devnet.solana.com";
}

/**
 * The gap between two calls to the node, in milliseconds.
 *
 * Building one attack reads a dozen accounts, and the public devnet endpoint
 * answers the eleventh call in a second with a 429 that web3.js turns into a
 * thrown error. Every row would then fail for the node's reason instead of the
 * sale's. The starts are spaced out here rather than hoping retries cover it.
 */
const REQUEST_GAP_MS = 140;

/** How many times a call that was rate limited is tried again before giving up. */
const RATE_LIMIT_TRIES = 5;
const RATE_LIMIT_BACKOFF_MS = 700;
const TOO_MANY_REQUESTS = 429;

let inLine: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((wake) => setTimeout(wake, ms));
}

/** One call at a time, spaced out, and tried again when the node says no. */
async function pacedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const turn = inLine.then(() => sleep(REQUEST_GAP_MS));
  inLine = turn;
  await turn;

  let response = await fetch(input, init);
  for (
    let attempt = 1;
    attempt < RATE_LIMIT_TRIES && response.status === TOO_MANY_REQUESTS;
    attempt += 1
  ) {
    await sleep(RATE_LIMIT_BACKOFF_MS * attempt);
    response = await fetch(input, init);
  }
  return response;
}

/** A devnet connection that paces itself, for the attack ledger and its proof. */
export function breakConnection(): Connection {
  // web3.js types its fetch option against its own bundled fetch declaration,
  // which the platform's own fetch does not line up with by name. The call
  // shape is the same one, so it is handed over as the config wants it.
  const config = {
    commitment: "confirmed",
    fetch: pacedFetch,
  } as unknown as ConnectionConfig;
  return new Connection(devnetRpcUrl(), config);
}

export type AttackId =
  | "honest-buy"
  | "over-cap"
  | "second-buy"
  | "second-account"
  | "changeable-owner"
  | "wallet-to-wallet"
  | "direct-call"
  | "above-ceiling"
  | "sell-back";

/** One row of the ledger: what is tried, and what the rules promise. */
export interface Attack {
  id: AttackId;
  /** Poster numbering, in the order a visitor is walked through them. */
  index: string;
  title: string;
  /** The threat model line this exercises, and a few words of what it means. */
  invariant: string;
  gloss: string;
  /** The program's own error name, or the one row that has to go through. */
  promise: PanguErrorName | "it goes through";
  kind: "refuse" | "pass";
  /** What running it costs the wallet, in plain units. */
  cost: string;
  /** True when the row needs the wallet to already hold sale tokens. */
  needsTokens: boolean;
  /** True when the row spends the token the sale is priced in. */
  needsPayingToken: boolean;
}

const FEE = "0.000005 SOL in fees";
const FEE_AND_RENT = "0.000005 SOL in fees, and about 0.002 SOL of rent for the account it opens";

export const ATTACKS: readonly Attack[] = [
  {
    id: "honest-buy",
    index: "01",
    title: "Buy under the cap, the way a buyer would",
    invariant: "C3",
    gloss: "under the cap, buying works",
    promise: "it goes through",
    kind: "pass",
    cost: FEE,
    needsTokens: false,
    needsPayingToken: true,
  },
  {
    id: "over-cap",
    index: "02",
    title: "Take more than the cap in one go",
    invariant: "C3",
    gloss: "one wallet, one share, always",
    promise: "OverCap",
    kind: "refuse",
    cost: FEE,
    needsTokens: false,
    needsPayingToken: true,
  },
  {
    id: "second-buy",
    index: "03",
    title: "Buy again, and cross the cap on the second try",
    invariant: "C3",
    gloss: "the counter remembers every buy",
    promise: "OverCap",
    kind: "refuse",
    cost: FEE,
    needsTokens: false,
    needsPayingToken: true,
  },
  {
    id: "second-account",
    index: "04",
    title: "Buy into a second token account of the same wallet",
    invariant: "C3",
    gloss: "counted per wallet, not per account",
    promise: "OverCap",
    kind: "refuse",
    cost: FEE_AND_RENT,
    needsTokens: false,
    needsPayingToken: true,
  },
  {
    id: "changeable-owner",
    index: "05",
    title: "Buy into an account whose owner can still change",
    invariant: "C13",
    gloss: "no handing the whole account on",
    promise: "ReceivingAccountOwnerCanChange",
    kind: "refuse",
    cost: FEE_AND_RENT,
    needsTokens: false,
    needsPayingToken: true,
  },
  {
    id: "wallet-to-wallet",
    index: "06",
    title: "Send tokens straight to another wallet",
    invariant: "C4",
    gloss: "no side market during the sale",
    promise: "WalletToWalletDuringSale",
    kind: "refuse",
    cost: FEE_AND_RENT,
    needsTokens: true,
    needsPayingToken: false,
  },
  {
    id: "direct-call",
    index: "07",
    title: "Call the rules program on its own, with no transfer",
    invariant: "C1",
    gloss: "no transfer, no counter change",
    promise: "NotTransferring",
    kind: "refuse",
    cost: FEE,
    needsTokens: false,
    needsPayingToken: false,
  },
  {
    id: "above-ceiling",
    index: "08",
    title: "Buy above the price ceiling the band sets",
    invariant: "C9",
    gloss: "never far above the real stock",
    promise: "PriceOutsideBand",
    kind: "refuse",
    cost: FEE,
    needsTokens: false,
    needsPayingToken: true,
  },
  {
    id: "sell-back",
    index: "09",
    title: "Sell back to the pool",
    invariant: "C5",
    gloss: "the exit is always open",
    promise: "it goes through",
    kind: "pass",
    cost: FEE,
    needsTokens: true,
    needsPayingToken: false,
  },
];

/** A sale the scripts opened, as the page knows it before reading the chain. */
export interface SaleCandidate {
  mint: string;
  name: string;
  symbol: string;
  mode: string;
}

/** The sale the ledger runs against, read live. */
export interface Target {
  mint: PublicKey;
  name: string;
  symbol: string;
  sale: Sale;
  cap: bigint;
  baseDecimals: number;
  quoteMint: PublicKey;
  quoteDecimals: number;
  quoteProgram: PublicKey;
  /** True when the paying token is wrapped SOL, which any wallet can get. */
  payingInSol: boolean;
  /** Raw units of the paying token the cap is worth at the curve's price now. */
  capWorth: bigint;
  openAccess: boolean;
  curveDollars: number;
  stockDollars: number | null;
  ceilingDollars: number | null;
  /**
   * The refusal every buy on this sale meets right now whatever else it tries,
   * because the hook reads the approval and the band before the cap. Null when
   * a buy can reach the cap rule.
   */
  standingRefusal: PanguErrorName | null;
  standingReason: string | null;
  largestShare: number;
  capShare: number;
  totalNetBought: bigint;
  buyers: number;
}

/** Every attack lands on devnet, so every link goes to devnet's explorer. */
export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddress(address: PublicKey | string): string {
  const text = typeof address === "string" ? address : address.toBase58();
  return `https://explorer.solana.com/address/${text}?cluster=devnet`;
}

/**
 * Picks the sale a visitor can attack, and reads its live state.
 *
 * A graduated sale has no rules left to break, so only running ones are
 * considered, and an open one comes first: a list sale refuses a stranger's buy
 * with NotApproved before any of these rules is reached. Among open sales the
 * newest wins, because the demo sale is opened last on purpose, priced under
 * the real stock so its buys can pass and the demo dollars button funds them.
 *
 * Returns null when no sale is running.
 */
export async function readTarget(
  connection: Connection,
  candidates: readonly SaleCandidate[]
): Promise<Target | null> {
  const running: { candidate: SaleCandidate; sale: Sale }[] = [];
  for (const candidate of [...candidates].reverse()) {
    const mint = new PublicKey(candidate.mint);
    const sale = await getSale(connection, mint);
    if (sale !== null && (await isSaleRunning(connection, mint))) {
      running.push({ candidate, sale });
    }
  }
  if (running.length === 0) {
    return null;
  }

  const open = running.filter((entry) => entry.sale.accessMode === ACCESS_MODE.open);
  const chosen = (open.length > 0 ? open : running)[0];
  if (chosen === undefined) {
    return null;
  }
  return readSale(connection, chosen.candidate, chosen.sale);
}

async function readSale(
  connection: Connection,
  candidate: SaleCandidate,
  sale: Sale
): Promise<Target> {
  const mint = new PublicKey(candidate.mint);
  const view = await loadPool(connection, mint);
  const quote = await getMint(connection, view.quoteMint, "confirmed", view.quoteProgram);
  const baseDecimals =
    sale.baseDecimals !== 0
      ? sale.baseDecimals
      : (await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID)).decimals;
  const quoteDecimals = sale.quoteDecimals !== 0 ? sale.quoteDecimals : quote.decimals;

  const sqrtPrice = BigInt(view.poolAccount.poolState.sqrtPrice.toString());
  const curve = curvePriceDollars(sqrtPrice, baseDecimals, quoteDecimals);

  let stockDollars: number | null = null;
  let ceiling: bigint | null = null;
  let standingRefusal: PanguErrorName | null = null;
  let standingReason: string | null = null;

  if (sale.hasBand) {
    const price = await readPrice(connection, sale);
    stockDollars = price.priceDollars;
    if (!price.usable) {
      standingRefusal = price.error ?? "PriceStale";
      standingReason =
        "There is no usable stock price right now, and a banded sale refuses every buy until there is. Selling back is never touched by it.";
    } else {
      ceiling = priceCeiling(sale, price.price);
      if (curve > ceiling) {
        standingRefusal = "PriceOutsideBand";
        standingReason =
          "This sale's curve already stands above the ceiling the band sets, so the chain refuses every buy with PriceOutsideBand before the cap is ever reached.";
      }
    }
  }
  if (standingRefusal === null && sale.accessMode === ACCESS_MODE.issuerList) {
    standingRefusal = "NotApproved";
    standingReason =
      "This sale runs on the issuer's approved list and your wallet is not on it, so a buy is refused before the cap is reached.";
  }

  const standing = saleStanding(sale, await listBuyerRecords(connection, mint));

  return {
    mint,
    name: candidate.name,
    symbol: candidate.symbol,
    sale,
    cap: sale.cap,
    baseDecimals,
    quoteMint: view.quoteMint,
    quoteDecimals,
    quoteProgram: view.quoteProgram,
    payingInSol: view.quoteMint.equals(NATIVE_MINT),
    capWorth: (sale.cap * sqrtPrice * sqrtPrice) >> 128n,
    openAccess: sale.accessMode === ACCESS_MODE.open,
    curveDollars: dollars(curve),
    stockDollars,
    ceilingDollars: ceiling === null ? null : dollars(ceiling),
    standingRefusal,
    standingReason,
    largestShare: standing.largestShare,
    capShare: standing.capShare,
    totalNetBought: standing.totalNetBought,
    buyers: standing.buyers,
  };
}

/** What the program will answer one row with, and why when that is not the rule the row is about. */
export interface Expected {
  name: PanguErrorName | "it goes through";
  why: string | null;
}

/** The refusals the band side of the hook gives. All of them are read before the cap. */
const PRICE_REFUSALS: readonly string[] = [
  "WrongPriceAccount",
  "PriceStale",
  "PriceNotFullyVerified",
  "PriceTooUncertain",
  "PriceOutsideBand",
];

/**
 * What the chain answers this row with, asked of the program's rules for this
 * exact buy from this exact wallet.
 *
 * The buy rows go through pangu-sdk's preflightBuy, which runs the hook's checks
 * in the hook's order against live state: the record, the approval, the band on
 * the price this buy would leave the curve at, then the cap. Rows 05, 06 and 07
 * turn on the shape of an account or a call, which preflightBuy does not model,
 * so they keep their fixed promise. The exit always goes through.
 *
 * `shares` is the raw amount of the sale token the built buy receives.
 */
export async function expectedOf(
  attack: Attack,
  context: BuildContext,
  shares: bigint | null
): Promise<Expected> {
  if (attack.id === "sell-back") {
    return { name: "it goes through", why: null };
  }
  if (!askedOfTheProgram(attack.id) || shares === null) {
    return { name: attack.promise, why: null };
  }
  const answer = await programAnswer(context, shares);
  return answer.name === attack.promise ? { name: answer.name, why: null } : answer;
}

function askedOfTheProgram(id: AttackId): boolean {
  return (
    id === "honest-buy" ||
    id === "over-cap" ||
    id === "second-buy" ||
    id === "second-account" ||
    id === "above-ceiling"
  );
}

async function programAnswer(context: BuildContext, shares: bigint): Promise<Expected> {
  const { connection, target, wallet } = context;
  const own = await preflightBuy({
    connection,
    buyer: wallet,
    mint: target.mint,
    amountOut: shares,
  });
  if (own.error !== "BuyerRecordMissing") {
    return answerOf(own, shares, target);
  }

  // Every buy row opens the wallet's record in the same transaction when it has
  // none, so a missing record is never what the chain answers. preflightBuy
  // stops at the missing record and cannot be told the record will be there, so
  // the rest of the hook's order is worked out here instead.
  if (target.sale.accessMode === ACCESS_MODE.issuerList) {
    // A record a wallet opens for itself starts off the list; only the issuer
    // puts it on. So the approval refuses before the band is read.
    return {
      name: "NotApproved",
      why: target.standingReason ?? explainPanguError("NotApproved"),
    };
  }
  if (target.sale.accessMode !== ACCESS_MODE.open) {
    throw new Error(
      "this sale takes a verifier's credential and your wallet has no record on it yet, so the ledger cannot say ahead of time which rule your buy meets"
    );
  }

  // The band's answer is the same for every wallet: it turns only on the curve,
  // the size of the buy and the stock price. So it is read from preflightBuy for
  // a wallet that does hold a record here, and the cap is then judged from this
  // wallet's own capRoom, which is the whole cap for a record opened in this
  // transaction. Band first, then cap, as execute.rs reads them.
  const band = await bandAt(context, shares);
  if (band.refusal !== null) {
    return answerOf(band.reading, shares, target);
  }
  if (shares > own.capRoom) {
    return { name: "OverCap", why: explainPanguError("OverCap") };
  }
  return { name: "it goes through", why: null };
}

function answerOf(reading: BuyPreflight, shares: bigint, target: Target): Expected {
  if (reading.error === null) {
    return { name: "it goes through", why: null };
  }
  if (
    reading.error === "PriceOutsideBand" &&
    reading.curvePrice !== null &&
    reading.ceiling !== null
  ) {
    return {
      name: "PriceOutsideBand",
      why:
        `A buy of ${sharesText(shares, target.baseDecimals)} shares would leave the curve at ` +
        `$${dollars(reading.curvePrice).toFixed(2)}, past the band's ceiling of ` +
        `$${dollars(reading.ceiling).toFixed(2)}. The program judges the band before the cap, ` +
        "so this buy is refused for its price.",
    };
  }
  return { name: reading.error, why: reading.reason ?? explainPanguError(reading.error) };
}

/** Raw units of the sale token as whole shares, two places at most. */
function sharesText(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = (raw / scale).toLocaleString("en-US");
  const fraction = (raw % scale).toString().padStart(decimals, "0").slice(0, 2).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

/** A transaction ready to simulate or to send, and anything else that signs it. */
export interface BuiltAttack {
  transaction: Transaction;
  /** A token account the attack opens for itself signs for its own creation. */
  signers: Keypair[];
  /** What the program will answer this exact transaction with. */
  expected: Expected;
  /** Raw units of the sale token the transaction moves, when it moves any. */
  shares: bigint | null;
}

export interface BuildContext {
  connection: Connection;
  target: Target;
  wallet: PublicKey;
}

/** Raw units a wallet holds of one token, in its ordinary account for it. */
export async function heldIn(
  connection: Connection,
  mint: PublicKey,
  wallet: PublicKey,
  program: PublicKey
): Promise<bigint> {
  const account = getAssociatedTokenAddressSync(mint, wallet, false, program);
  const info = await connection.getAccountInfo(account, "confirmed");
  // The amount sits at byte 64 of every token account, in both token programs.
  return info === null ? 0n : info.data.readBigUInt64LE(64);
}

/** Raw units of the sale token this wallet holds. */
export async function tokensHeld(
  connection: Connection,
  mint: PublicKey,
  wallet: PublicKey
): Promise<bigint> {
  return heldIn(connection, mint, wallet, TOKEN_2022_PROGRAM_ID);
}

/** Raw units of the token this sale is priced in that the wallet holds. */
export async function payingHeld(
  connection: Connection,
  target: Target,
  wallet: PublicKey
): Promise<bigint> {
  return heldIn(connection, target.quoteMint, wallet, target.quoteProgram);
}

/** Raw units of the sale token this wallet may still buy before the cap stops it. */
export async function capRoom(
  connection: Connection,
  target: Target,
  wallet: PublicKey
): Promise<bigint> {
  const record = await getBuyerRecord(connection, target.mint, wallet);
  if (record === null) {
    return target.cap;
  }
  const left = target.cap - record.netBought;
  return left > 0n ? left : 0n;
}

/*
 * Every size below is in raw units of the sale token, the unit the cap and the
 * hook count in, never in multiples of the cap's worth in the paying token. On a
 * banded sale those are two different attacks: a buy three times the cap's
 * worth walks the curve far past the ceiling, and the hook reads the band before
 * the cap, so a row meant for the cap came back about the price instead.
 */

/** An honest buy takes a fifth of the cap at most. */
const HONEST_PART = 5n;

/** Room under the ceiling below a hundredth of the cap counts as none. */
const TIGHT_PART = 100n;

/** One step past the ceiling: half a percent of the cap, clear of rounding and of a curve that moves. */
const CROSSING_STEP_PART = 200n;

/** How close the search for the ceiling gets: a thousandth of the cap. */
const ROOM_TOLERANCE_PART = 1000n;
const ROOM_SEARCH_TRIES = 14;
const ROOM_DOUBLINGS = 8;

/** How long one measurement of the room is trusted before it is taken again. */
const ROOM_FRESH_MS = 20_000;

/** How far a built buy may land from the shares it was sized for: a two hundredth of them. */
const SIZE_SLACK_PART = 200n;
const SIZE_TRIES = 6;

/**
 * Raw units of the paying token this row's transaction would spend.
 *
 * Close enough to tell a visitor whether their wallet can run the row at all:
 * an honest buy takes a fifth of the cap, and a buy past the cap or the ceiling
 * pays a little over the cap's worth, because the price climbs through the buy.
 */
export function payingNeeded(attack: Attack, target: Target): bigint {
  if (!attack.needsPayingToken) {
    return 0n;
  }
  if (attack.id === "honest-buy" || attack.id === "changeable-owner") {
    return target.capWorth / HONEST_PART;
  }
  return target.capWorth + target.capWorth / 20n;
}

/** The band's answer to a buy of this size, the same for every wallet. */
interface BandReading {
  refusal: PanguErrorName | null;
  reading: BuyPreflight;
}

const probes = new WeakMap<Target, Promise<PublicKey>>();

/**
 * A wallet that holds a record on this sale, to read the band's answer through.
 *
 * preflightBuy stops at a missing record before it reaches the band, so a fresh
 * wallet cannot be asked about the band directly. The visitor's own wallet is
 * used when it has a record, and any other buyer's otherwise.
 */
function bandProbe(context: BuildContext): Promise<PublicKey> {
  let found = probes.get(context.target);
  if (found === undefined) {
    found = findProbe(context);
    probes.set(context.target, found);
    found.catch(() => probes.delete(context.target));
  }
  return found;
}

async function findProbe({ connection, target, wallet }: BuildContext): Promise<PublicKey> {
  const records = await listBuyerRecords(connection, target.mint);
  const listed = target.sale.accessMode === ACCESS_MODE.issuerList;
  const usable =
    records.find((record) => record.wallet.equals(wallet)) ??
    records.find((record) => !listed || record.approved);
  if (usable === undefined) {
    throw new Error(
      "no wallet holds a record on this sale yet, so the band's answer cannot be read ahead of the first buy"
    );
  }
  return usable.wallet;
}

async function bandAt(context: BuildContext, shares: bigint): Promise<BandReading> {
  const reading = await preflightBuy({
    connection: context.connection,
    buyer: await bandProbe(context),
    mint: context.target.mint,
    amountOut: shares,
  });
  if (reading.error === null || reading.error === "OverCap") {
    // OverCap here is the probe wallet's own cap, judged after the band passed.
    return { refusal: null, reading };
  }
  if (PRICE_REFUSALS.includes(reading.error)) {
    return { refusal: reading.error, reading };
  }
  throw new Error(`the band could not be read on this sale: ${reading.reason ?? reading.error}`);
}

/** Where the ceiling sits, measured in shares a buy can take from here. */
interface CeilingRoom {
  /** The most shares measured to leave the curve at or under the ceiling. */
  room: bigint;
  /** The fewest measured to leave it above, null when the curve cannot be pushed that far. */
  crossing: bigint | null;
}

/** One point of the search: how a buy of this size stands against the ceiling. */
interface Point {
  shares: bigint;
  side: "under" | "over" | "unfillable";
  /**
   * One over the square root of the post-buy price. On one stretch of a
   * bonding curve it falls in a straight line with the shares bought.
   */
  depth: number | null;
  /** The ceiling in the same measure, when the reading carried one. */
  ceilingDepth: number | null;
}

const rooms = new WeakMap<Target, { at: number; room: Promise<CeilingRoom | null> }>();

/**
 * The room left under the band's ceiling, shared between rows for a moment.
 *
 * Null when the sale has no band, or its price is not usable right now, in which
 * case every buy meets the price refusal first and no size changes that.
 */
function roomUnderCeiling(context: BuildContext): Promise<CeilingRoom | null> {
  const cached = rooms.get(context.target);
  if (cached !== undefined && Date.now() - cached.at < ROOM_FRESH_MS) {
    return cached.room;
  }
  const room = measureRoom(context);
  rooms.set(context.target, { at: Date.now(), room });
  room.catch(() => rooms.delete(context.target));
  return room;
}

function depthOf(price: bigint | null): number | null {
  return price === null || price <= 0n ? null : 1 / Math.sqrt(Number(price));
}

async function pointAt(context: BuildContext, shares: bigint): Promise<Point | PanguErrorName> {
  let band: BandReading;
  try {
    band = await bandAt(context, shares);
  } catch (error) {
    if (/liquidity/i.test(error instanceof Error ? error.message : String(error))) {
      return { shares, side: "unfillable", depth: null, ceilingDepth: null };
    }
    throw error;
  }
  if (band.refusal !== null && band.refusal !== "PriceOutsideBand") {
    return band.refusal;
  }
  return {
    shares,
    side: band.refusal === null ? "under" : "over",
    depth: depthOf(band.reading.curvePrice),
    ceilingDepth: depthOf(band.reading.ceiling),
  };
}

/**
 * Finds the largest buy that leaves the curve at or under the ceiling.
 *
 * It starts from the sale as readTarget saw it, a buy of nothing, then asks the
 * chain about a whole cap, doubling until a buy lands over the ceiling. A
 * straight line between the last buy under and the first over, in the measure
 * where the curve is straight, says where the ceiling sits, and the chain is
 * asked just either side of that point to pin it. When the line stops closing
 * in, the gap is halved instead. Every question is a real preflightBuy against
 * live state, usually three on a sale whose curve is one stretch.
 */
async function measureRoom(context: BuildContext): Promise<CeilingRoom | null> {
  const { target } = context;
  if (!target.sale.hasBand) {
    return null;
  }
  // Already over the ceiling, or no usable price: known from the read, with no
  // question to ask the chain.
  if (target.standingRefusal === "PriceOutsideBand") {
    return { room: 0n, crossing: 1n };
  }
  if (target.standingRefusal !== null && PRICE_REFUSALS.includes(target.standingRefusal)) {
    return null;
  }

  let under: Point = {
    shares: 0n,
    side: "under",
    depth: depthOf(scaledDollars(target.curveDollars)),
    ceilingDepth: depthOf(scaledDollars(target.ceilingDollars)),
  };
  let over: Point | null = null;
  let reach = target.cap;
  for (let doubling = 0; doubling < ROOM_DOUBLINGS && over === null; doubling += 1) {
    const point = await pointAt(context, reach);
    if (typeof point === "string") {
      return null;
    }
    if (point.side === "under") {
      under = point;
      reach *= 2n;
    } else {
      over = point;
    }
  }
  if (over === null) {
    return { room: under.shares, crossing: null };
  }

  const tolerance = target.cap / ROOM_TOLERANCE_PART + 1n;
  let lastSide: Point["side"] = over.side;
  let sameSide = 1;
  for (
    let tries = 0;
    tries < ROOM_SEARCH_TRIES && over.shares - under.shares > tolerance;
    tries += 1
  ) {
    const gap = over.shares - under.shares;
    let next = under.shares + gap / 2n;
    const ceilingDepth = over.ceilingDepth ?? under.ceilingDepth;
    if (sameSide < 3 && ceilingDepth !== null && under.depth !== null && over.depth !== null) {
      const along = (under.depth - ceilingDepth) / (under.depth - over.depth);
      if (Number.isFinite(along) && along > 0 && along < 1) {
        const line = under.shares + (gap * BigInt(Math.floor(along * 1_000_000))) / 1_000_000n;
        // Aimed just past the line on the far side from the last answer, so
        // the next answer lands on the other side and the gap closes from both.
        next = lastSide === "under" ? line + tolerance / 2n : line - tolerance / 2n;
      }
    }
    if (next <= under.shares || next >= over.shares) {
      next = under.shares + gap / 2n;
    }
    const point = await pointAt(context, next);
    if (typeof point === "string") {
      return null;
    }
    sameSide = point.side === lastSide ? sameSide + 1 : 1;
    lastSide = point.side;
    if (point.side === "under") {
      under = point;
    } else {
      over = point;
    }
  }
  return { room: under.shares, crossing: over.side === "over" ? over.shares : null };
}

/** Dollars as a number, back to the 1e18 scale pangu-sdk prices are in. */
function scaledDollars(value: number | null): bigint | null {
  return value === null || !Number.isFinite(value) || value <= 0
    ? null
    : BigInt(Math.round(value * 1e6)) * 10n ** 12n;
}

/** A buy built to land on a number of shares, and what it pays for them. */
interface SizedBuy {
  built: TradeTransaction;
  amountIn: bigint;
}

/**
 * Builds a buy that receives close to this many shares.
 *
 * pangu-sdk builds a buy from what it spends, so the spend is worked back from
 * the shares: first at the curve's price now, then scaled by how far the quote
 * missed. The price climbs through a buy, so shares come back a little under
 * proportion, and two or three builds land inside the slack. "atLeast" never
 * lands under the shares asked for, "atMost" never over.
 */
async function buyShares(
  context: BuildContext,
  shares: bigint,
  side: "atLeast" | "atMost"
): Promise<SizedBuy> {
  const { connection, target, wallet } = context;
  const slack = shares / SIZE_SLACK_PART + 1n;
  const landed = (out: bigint) => (side === "atLeast" ? out >= shares : out <= shares);
  let amountIn = target.cap > 0n ? (target.capWorth * shares) / target.cap + 1n : 1n;
  let last: SizedBuy | null = null;

  for (let tries = 0; tries < SIZE_TRIES; tries += 1) {
    let built: TradeTransaction;
    try {
      built = await buyTransaction({ connection, buyer: wallet, mint: target.mint, amountIn });
    } catch (error) {
      if (/liquidity/i.test(error instanceof Error ? error.message : String(error))) {
        throw new Error(
          "this curve cannot fill a buy of that size right now, so there is nothing here to run"
        );
      }
      throw error;
    }
    const out = built.expectedAmountOut;
    last = { built, amountIn };
    const miss = out > shares ? out - shares : shares - out;
    if (landed(out) && miss <= slack) {
      return last;
    }
    if (out === 0n) {
      amountIn *= 2n;
      continue;
    }
    const scaled = (amountIn * shares) / out;
    const nudge = scaled / 4_000n + 1n;
    amountIn = side === "atLeast" ? scaled + nudge : scaled > nudge ? scaled - nudge : 1n;
  }
  if (last !== null && landed(last.built.expectedAmountOut)) {
    return last;
  }
  throw new Error("the curve moved while this buy was being sized. Run it again.");
}

/** Shares for the honest buy, and whether the ceiling has left almost no room. */
async function honestShares(
  context: BuildContext,
  capLeft: bigint
): Promise<{ shares: bigint; tight: boolean }> {
  const { target } = context;
  const measured = await roomUnderCeiling(context);
  const floor = target.cap / TIGHT_PART;
  if (measured !== null && measured.room < floor) {
    return { shares: min(floor, capLeft), tight: true };
  }
  let shares = target.cap / HONEST_PART;
  if (measured !== null) {
    shares = min(shares, measured.room / 2n);
  }
  // A wallet that has bought before has less than the whole cap left, and an
  // honest buy stays inside what is left.
  return { shares: min(shares, capLeft), tight: false };
}

/**
 * Shares for the buy above the ceiling: the room plus one step, so the smallest
 * buy that crosses. Null when the sale has no band or its price is not usable.
 *
 * No upper limit is put on it. When crossing takes more than the cap, the buy is
 * over the cap as well, and the program still answers PriceOutsideBand, because
 * execute.rs judges the band before the cap.
 */
async function aboveCeilingShares(context: BuildContext): Promise<bigint | null> {
  const measured = await roomUnderCeiling(context);
  if (measured === null) {
    return null;
  }
  if (measured.crossing === null) {
    throw new CannotCross();
  }
  return max(measured.room + context.target.cap / CROSSING_STEP_PART + 1n, measured.crossing);
}

class CannotCross extends Error {
  constructor() {
    super(
      "no buy this curve can fill pushes it past the band's ceiling right now, so there is no ceiling to cross"
    );
    this.name = "CannotCross";
  }
}

/**
 * What the buy above the ceiling pays, in raw units of the paying token.
 *
 * Measured with the very functions that size and build the row, so the demo
 * dollar grant covers the row it is meant to cover. Zero when the sale has no
 * band to cross, or no buy it can fill crosses it.
 */
export async function crossingCost(
  connection: Connection,
  target: Target,
  wallet: PublicKey
): Promise<bigint> {
  const context: BuildContext = { connection, target, wallet };
  let shares: bigint | null;
  try {
    shares = await aboveCeilingShares(context);
  } catch (error) {
    if (error instanceof CannotCross) {
      return 0n;
    }
    throw error;
  }
  if (shares === null) {
    return 0n;
  }
  return (await buyShares(context, shares, "atLeast")).amountIn;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/**
 * A second Token-2022 account for the sale token, owned by the same wallet.
 *
 * `ownerIsFixed` is the one difference C13 turns on: an account whose owner can
 * still be handed to somebody else is not somewhere a sale may send tokens.
 */
async function secondTokenAccount(
  context: BuildContext,
  ownerIsFixed: boolean
): Promise<{ account: Keypair; instructions: TransactionInstruction[] }> {
  const account = Keypair.generate();
  const state = await getMint(
    context.connection,
    context.target.mint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );
  // A token account carries the account side of every extension its mint has,
  // read off the mint rather than listed here.
  const required = getExtensionTypes(state.tlvData).map(getAccountTypeOfMintType);
  const space = getAccountLen(
    ownerIsFixed ? [...required, ExtensionType.ImmutableOwner] : required
  );
  const instructions: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: context.wallet,
      newAccountPubkey: account.publicKey,
      lamports: await context.connection.getMinimumBalanceForRentExemption(space),
      space,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ];
  if (ownerIsFixed) {
    instructions.push(
      createInitializeImmutableOwnerInstruction(account.publicKey, TOKEN_2022_PROGRAM_ID)
    );
  }
  instructions.push(
    createInitializeAccount3Instruction(
      account.publicKey,
      context.target.mint,
      context.wallet,
      TOKEN_2022_PROGRAM_ID
    )
  );
  return { account, instructions };
}

/**
 * Points a built buy at another token account of the same wallet.
 *
 * Only the Meteora swap is touched, and only where it names the account the
 * tokens land in. The hook's own accounts are rebuilt on chain from whatever
 * account really receives, so this is a genuine second account and not a
 * doctored account list.
 */
function redirectBuy(transaction: Transaction, from: PublicKey, to: PublicKey): Transaction {
  const swaps = transaction.instructions.filter((instruction) =>
    instruction.programId.equals(DBC_PROGRAM_ID)
  );
  const swap = swaps[0];
  if (swaps.length !== 1 || swap === undefined) {
    throw new Error(`expected one Meteora swap in this buy, found ${swaps.length}`);
  }
  let moved = 0;
  for (const key of swap.keys) {
    if (key.pubkey.equals(from)) {
      key.pubkey = to;
      moved += 1;
    }
  }
  if (moved === 0) {
    throw new Error("this buy does not pay out to the account it was built for");
  }
  return transaction;
}

/**
 * Builds one attack: what pangu-sdk builds for an honest user, with exactly one
 * thing changed, so a refusal can never come from some other mistake.
 *
 * Every buy is sized in shares first and built second, and the built buy's own
 * share count is what the program is asked about, so the promise a row carries
 * is the answer to the transaction it will actually send.
 *
 * Throws a sentence a visitor can read when the sale's state leaves nothing to
 * try, such as a wallet holding no tokens asking to sell.
 */
export async function buildAttack(
  id: AttackId,
  context: BuildContext
): Promise<BuiltAttack> {
  const { connection, target, wallet } = context;
  const attack = ATTACKS.find((entry) => entry.id === id);
  if (attack === undefined) {
    throw new Error(`there is no attack called ${id}`);
  }
  const ownAccount = getAssociatedTokenAddressSync(
    target.mint,
    wallet,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const promised = async (
    transaction: Transaction,
    shares: bigint | null,
    signers: Keypair[] = []
  ): Promise<BuiltAttack> => ({
    transaction,
    signers,
    shares,
    expected: await expectedOf(attack, context, shares),
  });

  if (id === "honest-buy") {
    const left = await capRoom(connection, target, wallet);
    if (left === 0n) {
      throw new Error("your wallet is already at this sale's cap, so there is no honest buy left");
    }
    const sized = await honestShares(context, left);
    const buy = await buyShares(context, sized.shares, "atMost");
    const built = await promised(buy.built.transaction, buy.built.expectedAmountOut);
    if (sized.tight && built.expected.name === "PriceOutsideBand") {
      built.expected = {
        name: "PriceOutsideBand",
        why: "The curve sits at the ceiling right now, so even this small buy would cross it; the program refuses it, which is the band doing its job.",
      };
    }
    return built;
  }

  if (id === "over-cap") {
    const buy = await buyShares(context, target.cap + 1n, "atLeast");
    return promised(buy.built.transaction, buy.built.expectedAmountOut);
  }

  if (id === "second-buy") {
    const left = await capRoom(connection, target, wallet);
    if (left === target.cap) {
      throw new Error(
        "this one needs a first buy behind it. Run the buy under the cap above, then come back."
      );
    }
    const buy = await buyShares(context, left + 1n, "atLeast");
    return promised(buy.built.transaction, buy.built.expectedAmountOut);
  }

  if (id === "second-account" || id === "changeable-owner") {
    const ownerIsFixed = id === "second-account";
    const opened = await secondTokenAccount(context, ownerIsFixed);
    // The fixed-owner account is the one that has to run into the cap, so that
    // buy is one share unit past the whole cap. The changeable one is refused
    // for what it is before any amount is looked at, so a fifth of the cap is
    // the honest test of C13.
    const buy = ownerIsFixed
      ? await buyShares(context, target.cap + 1n, "atLeast")
      : await buyShares(context, target.cap / HONEST_PART, "atMost");
    const redirected = redirectBuy(buy.built.transaction, ownAccount, opened.account.publicKey);
    redirected.instructions.unshift(...opened.instructions);
    return promised(redirected, buy.built.expectedAmountOut, [opened.account]);
  }

  if (id === "wallet-to-wallet") {
    const held = await tokensHeld(connection, target.mint, wallet);
    if (held === 0n) {
      throw new Error("this one needs tokens to send. Run the buy under the cap above first.");
    }
    const stranger = Keypair.generate().publicKey;
    const strangerAccount = getAssociatedTokenAddressSync(
      target.mint,
      stranger,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const amount = held / 2n > 0n ? held / 2n : held;
    const transfer = createTransferCheckedInstruction(
      ownAccount,
      target.mint,
      strangerAccount,
      wallet,
      amount,
      target.baseDecimals,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    transfer.keys.push(
      ...(await hookAccounts({
        connection,
        mint: target.mint,
        source: ownAccount,
        destination: strangerAccount,
        authority: wallet,
        amount,
        pending: [{ address: strangerAccount, mint: target.mint, owner: stranger }],
      }))
    );
    const transaction = new Transaction()
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          wallet,
          strangerAccount,
          stranger,
          target.mint,
          TOKEN_2022_PROGRAM_ID
        )
      )
      .add(transfer);
    return promised(await ready(connection, transaction, wallet), amount);
  }

  if (id === "direct-call") {
    const list = extraAccountListAddress(target.mint);
    const amount = 1n;
    const execute = createExecuteInstruction(
      PANGU_PROGRAM_ID,
      ownAccount,
      target.mint,
      ownAccount,
      wallet,
      list,
      amount
    );
    const resolved = await hookAccounts({
      connection,
      mint: target.mint,
      source: ownAccount,
      destination: ownAccount,
      authority: wallet,
      amount,
      pending: [{ address: ownAccount, mint: target.mint, owner: wallet }],
    });
    // hookAccounts hands back the list Meteora wants: the validation account,
    // the resolved extras, then the hook program. An execute instruction
    // already names the validation account and never names the program it is
    // sent to, so only the middle of that list belongs here.
    execute.keys.push(...resolved.slice(1, -1));
    const transaction = new Transaction()
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          wallet,
          ownAccount,
          wallet,
          target.mint,
          TOKEN_2022_PROGRAM_ID
        )
      )
      .add(execute);
    return promised(await ready(connection, transaction, wallet), amount);
  }

  if (id === "above-ceiling") {
    if (!target.sale.hasBand) {
      throw new Error("this sale has no price band, so there is no ceiling to buy above");
    }
    const shares = await aboveCeilingShares(context);
    // With no usable price every buy meets the price refusal first, whatever
    // its size, so a fifth of the cap asks the question as well as any.
    const buy = await buyShares(context, shares ?? target.cap / HONEST_PART, "atLeast");
    return promised(buy.built.transaction, buy.built.expectedAmountOut);
  }

  const held = await tokensHeld(connection, target.mint, wallet);
  if (held === 0n) {
    throw new Error("this one needs tokens to sell back. Run the buy under the cap above first.");
  }
  const exit = await sellTransaction({
    connection,
    seller: wallet,
    mint: target.mint,
    amountIn: held,
  });
  return promised(exit.transaction, held);
}

async function ready(
  connection: Connection,
  transaction: Transaction,
  payer: PublicKey
): Promise<Transaction> {
  transaction.feePayer = payer;
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return transaction;
}

/** What one attempt did, read back from the chain's own logs. */
export interface AttackResult {
  /**
   * "unseen" is a sent transaction the chain has no record of: dropped, or its
   * blockhash ran out while the wallet was open. It is neither refused nor
   * allowed, and nothing may be claimed about it.
   */
  outcome: "refused" | "allowed" | "unclear" | "unseen";
  /** The program's own error name, when the refusal was the program's. */
  errorName: string | null;
  /** The sentence that goes with it, from the SDK. */
  sentence: string | null;
  /** The last log line, when the refusal came from somewhere else. */
  logLine: string | null;
  signature: string | null;
  link: string | null;
}

const UNSEEN =
  "The chain never saw this transaction (dropped or expired while the wallet was open); press Run again.";

function unseen(signature: string | null): AttackResult {
  return {
    outcome: "unseen",
    errorName: null,
    sentence: UNSEEN,
    logLine: null,
    signature,
    link: null,
  };
}

function readLogs(logs: string[] | null, failed: boolean): AttackResult {
  if (!failed && logs === null) {
    // No error and no logs is no answer at all. Calling it allowed would claim
    // a transaction went through with nothing on chain to show for it.
    return unseen(null);
  }
  if (!failed) {
    return {
      outcome: "allowed",
      errorName: null,
      sentence: null,
      logLine: null,
      signature: null,
      link: null,
    };
  }
  const lines = logs ?? [];
  const found = panguErrorFromLogs(lines);
  return {
    outcome: found === null ? "unclear" : "refused",
    errorName: found?.name ?? null,
    sentence: found === null ? null : explainPanguError(found.name),
    logLine: found === null ? lastSpokenLine(lines) : null,
    signature: null,
    link: null,
  };
}

/**
 * The most useful line of a failure that was not Pangu's.
 *
 * A program's own words come back as "Program log: ...", and the runtime's
 * "Program ... failed" line only carries a number. The last thing a program
 * said is what tells a reader what went wrong, so it is preferred, and the
 * instruction headings are dropped because they say nothing.
 */
function lastSpokenLine(lines: readonly string[]): string {
  const spoken = lines.filter(
    (line) =>
      line.startsWith("Program log: ") && !line.startsWith("Program log: Instruction:")
  );
  const said = spoken[spoken.length - 1];
  if (said !== undefined) {
    return said.slice("Program log: ".length);
  }
  const anything = lines.filter((line) => line.trim().length > 0);
  return anything[anything.length - 1] ?? "the node returned no logs";
}

/**
 * A sentence for a failure the sale's rules did not cause.
 *
 * The one a visitor meets most is an empty wallet, which the token program
 * reports as insufficient funds from inside Meteora's swap, so it is named for
 * what it is rather than left as a log line, and it points at the button that
 * fixes it.
 */
export function plainFailure(result: AttackResult, target: Target): string {
  const line = result.logLine ?? "";
  if (/insufficient funds/i.test(line)) {
    return target.payingInSol
      ? "This wallet does not hold enough devnet SOL for this buy. Take some from the faucet above and run it again."
      : "This wallet does not hold enough of the token this sale is priced in, so the buy stops at the token program before the sale's rules are reached. Get demo dollars above first, then run it again.";
  }
  return `The chain refused this, and the reason did not come from the sale's rules: ${line}`;
}

/**
 * Runs an attack against the chain without anybody signing it.
 *
 * The transaction is compiled and simulated with signature checking off, so a
 * wallet is never asked to sign something that is meant to fail. What comes
 * back is the real program's refusal, read out of the real logs.
 */
export async function simulateAttack(
  connection: Connection,
  built: BuiltAttack
): Promise<AttackResult> {
  const transaction = built.transaction;
  if (transaction.recentBlockhash === undefined) {
    transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  }
  const simulated = await connection.simulateTransaction(
    new VersionedTransaction(transaction.compileMessage()),
    { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }
  );
  return readLogs(simulated.value.logs, simulated.value.err !== null);
}

/**
 * How long a sent attack is looked for before the row says the chain never saw it.
 *
 * A blockhash lives for about 150 blocks, a minute or a little more, and a
 * transaction the wallet sent is on chain by then or never will be. So the
 * chain is asked for well over a minute before anything is called unseen.
 */
const DETAIL_TRIES = 30;
const DETAIL_WAIT_MS = 2_500;

/**
 * Reads back an attack that was really sent, so the row can link to it.
 *
 * A refused attack lands on chain on purpose, which is what turns a claim into
 * a signature anybody can open. One the chain never saw comes back "unseen",
 * never "allowed", and carries no link, because there is nothing to open.
 */
export async function readLanded(
  connection: Connection,
  signature: string
): Promise<AttackResult> {
  let detail = null;
  for (let attempt = 0; attempt < DETAIL_TRIES && detail === null; attempt += 1) {
    if (attempt > 0) {
      await new Promise((wake) => setTimeout(wake, DETAIL_WAIT_MS));
    }
    detail = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  }
  if (detail === null) {
    return unseen(signature);
  }
  const result = readLogs(
    detail.meta?.logMessages ?? null,
    (detail.meta?.err ?? null) !== null
  );
  return result.outcome === "unseen"
    ? unseen(signature)
    : { ...result, signature, link: explorerTx(signature) };
}

/** The tally at the foot of the ledger, in the prove command's own shape. */
export function tallyLine(counts: {
  run: number;
  refusedAsExpected: number;
  allowedAsExpected: number;
  off: number;
  /** Sent, but never seen by the chain: counted as neither refused nor allowed. */
  unseen?: number;
}): string {
  const head =
    `${counts.run} ${counts.run === 1 ? "attack" : "attacks"} run, ` +
    `${counts.refusedAsExpected} refused as expected, ` +
    `${counts.allowedAsExpected} allowed as expected`;
  const offPart = counts.off === 0 ? "" : `, ${counts.off} off the standard`;
  const unseenPart =
    counts.unseen === undefined || counts.unseen === 0 ? "" : `, ${counts.unseen} not seen`;
  return `${head}${offPart}${unseenPart}`;
}
