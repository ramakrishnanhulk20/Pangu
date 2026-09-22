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
import { buyTransaction, hookAccounts, loadPool, sellTransaction } from "pangu-sdk/dbc";

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
 * with NotApproved before any of these rules is reached. Among open sales one
 * priced in wrapped SOL comes first, because that is the only paying token a
 * visitor can get for themselves.
 *
 * Returns null when no sale is running.
 */
export async function readTarget(
  connection: Connection,
  candidates: readonly SaleCandidate[]
): Promise<Target | null> {
  const running: { candidate: SaleCandidate; sale: Sale }[] = [];
  for (const candidate of candidates) {
    const mint = new PublicKey(candidate.mint);
    const sale = await getSale(connection, mint);
    if (sale !== null && (await isSaleRunning(connection, mint))) {
      running.push({ candidate, sale });
    }
  }
  if (running.length === 0) {
    return null;
  }

  // Loading a pool costs several reads, so it is only done to break a tie
  // between sales a visitor could both attack.
  const open = running.filter((entry) => entry.sale.accessMode === ACCESS_MODE.open);
  const shortlist = open.length > 0 ? open : running;
  const first = shortlist[0];
  if (first === undefined) {
    return null;
  }
  if (shortlist.length === 1) {
    return readSale(connection, first.candidate, first.sale);
  }

  const ranked = await Promise.all(
    shortlist.map(async (entry) => ({ ...entry, rank: await rankOf(connection, entry.sale) }))
  );
  ranked.sort((left, right) => right.rank - left.rank);
  const chosen = ranked[0] ?? first;
  return readSale(connection, chosen.candidate, chosen.sale);
}

/** A sale priced in wrapped SOL comes first: it is the one token anyone can get. */
async function rankOf(connection: Connection, sale: Sale): Promise<number> {
  try {
    const view = await loadPool(connection, sale.mint);
    return view.quoteMint.equals(NATIVE_MINT) ? 1 : 0;
  } catch {
    return 0;
  }
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

/**
 * The order the hook decides a buy in, taken line by line from `handle_execute`
 * in packages/program/programs/pangu/src/instructions/execute.rs.
 *
 * It is here because it decides what a row can honestly claim: whichever rule
 * comes first is the one a visitor will see, so a row promising OverCap on a
 * sale whose band already refuses every buy has to say PriceOutsideBand instead
 * of claiming a refusal it will not get.
 */
const BUY_ORDER: readonly string[] = [
  "WrongLayoutVersion",
  "ReceivingAccountOwnerCanChange",
  "WrongBuyerRecord",
  "BuyerRecordMissing",
  "NotApproved",
  "CredentialInvalid",
  "CredentialExpired",
  "CredentialSignerNotAuthorized",
  "WrongPriceAccount",
  "PriceStale",
  "PriceNotFullyVerified",
  "PriceTooUncertain",
  "PriceOutsideBand",
  "OverCap",
];

function decidedAt(name: string): number {
  const place = BUY_ORDER.indexOf(name);
  // A row that has to go through is decided after every refusal there is.
  return place === -1 ? BUY_ORDER.length : place;
}

/** What the chain answers this row with, given the sale's state right now. */
export function expectedOf(
  attack: Attack,
  target: Target
): { name: PanguErrorName | "it goes through"; why: string | null } {
  // The exit depends on nothing that can be missing, which is the whole of C5,
  // so a sale whose buys are shut changes nothing for the rows that do not buy.
  if (target.standingRefusal === null || !needsToBuy(attack.id)) {
    return { name: attack.promise, why: null };
  }
  if (decidedAt(target.standingRefusal) >= decidedAt(attack.promise)) {
    return { name: attack.promise, why: null };
  }
  return { name: target.standingRefusal, why: target.standingReason };
}

function needsToBuy(id: AttackId): boolean {
  return (
    id === "honest-buy" ||
    id === "over-cap" ||
    id === "second-buy" ||
    id === "second-account" ||
    id === "changeable-owner" ||
    id === "above-ceiling"
  );
}

/** A transaction ready to simulate or to send, and anything else that signs it. */
export interface BuiltAttack {
  transaction: Transaction;
  /** A token account the attack opens for itself signs for its own creation. */
  signers: Keypair[];
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

/**
 * Multiples of the cap's worth a buy meant to pass the cap reaches for.
 *
 * Smallest first: the point is to cross the cap, and the cheapest buy that
 * crosses it is the one a visitor's wallet can actually afford.
 */
const OVER_CAP_TRIES = [1n, 2n, 3n];

/** Shares of the cap's worth an honest buy tries, largest first. */
const HONEST_SHARES = [5n, 12n, 40n, 160n];

/** Aim this far inside the room left: Meteora's quote and the chain land apart. */
const CAP_MARGIN = 50n;

/** Rows whose buy is sized to cross the cap, and so reach for a whole cap's worth. */
function buysPastTheCap(id: AttackId): boolean {
  return id === "over-cap" || id === "second-buy" || id === "second-account";
}

/**
 * Raw units of the paying token this row's transaction would spend.
 *
 * Close enough to tell a visitor whether their wallet can run the row at all: a
 * buy meant to cross the cap reaches for the cap's whole worth, and an honest
 * buy for the largest share of it that fits under what is left.
 */
export function payingNeeded(attack: Attack, target: Target): bigint {
  if (!attack.needsPayingToken) {
    return 0n;
  }
  const largest = HONEST_SHARES[0] ?? 5n;
  return buysPastTheCap(attack.id) ? target.capWorth : target.capWorth / largest;
}

async function buyPast(context: BuildContext, room: bigint): Promise<Transaction> {
  for (const multiple of OVER_CAP_TRIES) {
    try {
      const built = await buyTransaction({
        connection: context.connection,
        buyer: context.wallet,
        mint: context.target.mint,
        amountIn: context.target.capWorth * multiple,
      });
      if (built.expectedAmountOut > room) {
        return built.transaction;
      }
    } catch {
      continue;
    }
  }
  throw new Error(
    "this curve cannot fill a buy big enough to pass the cap right now, so there is nothing here to refuse"
  );
}

async function buyWithin(context: BuildContext, room: bigint): Promise<Transaction> {
  for (const share of HONEST_SHARES) {
    try {
      const built = await buyTransaction({
        connection: context.connection,
        buyer: context.wallet,
        mint: context.target.mint,
        amountIn: context.target.capWorth / share,
      });
      if (built.expectedAmountOut <= room - room / CAP_MARGIN) {
        return built.transaction;
      }
    } catch {
      continue;
    }
  }
  throw new Error(
    "no buy fits under what is left of your cap on this sale, so there is nothing honest left to run here"
  );
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
 * Throws a sentence a visitor can read when the sale's state leaves nothing to
 * try, such as a wallet holding no tokens asking to sell.
 */
export async function buildAttack(
  id: AttackId,
  context: BuildContext
): Promise<BuiltAttack> {
  const { connection, target, wallet } = context;
  const ownAccount = getAssociatedTokenAddressSync(
    target.mint,
    wallet,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  if (id === "honest-buy") {
    const room = await capRoom(connection, target, wallet);
    if (room === 0n) {
      throw new Error("your wallet is already at this sale's cap, so there is no honest buy left");
    }
    return { transaction: await buyWithin(context, room), signers: [] };
  }

  if (id === "over-cap") {
    return { transaction: await buyPast(context, target.cap), signers: [] };
  }

  if (id === "second-buy") {
    const room = await capRoom(connection, target, wallet);
    if (room === target.cap) {
      throw new Error(
        "this one needs a first buy behind it. Run the buy under the cap above, then come back."
      );
    }
    return { transaction: await buyPast(context, room), signers: [] };
  }

  if (id === "second-account" || id === "changeable-owner") {
    const ownerIsFixed = id === "second-account";
    const opened = await secondTokenAccount(context, ownerIsFixed);
    // The fixed-owner account is the one that has to run into the cap, so that
    // buy is sized past it. The changeable one is refused for what it is, so a
    // modest buy into it is the honest test of C13.
    const buy = ownerIsFixed
      ? await buyPast(context, await capRoom(connection, target, wallet))
      : await buyWithin(context, target.cap);
    const redirected = redirectBuy(buy, ownAccount, opened.account.publicKey);
    redirected.instructions.unshift(...opened.instructions);
    return { transaction: redirected, signers: [opened.account] };
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
    return { transaction: await ready(connection, transaction, wallet), signers: [] };
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
    return { transaction: await ready(connection, transaction, wallet), signers: [] };
  }

  if (id === "above-ceiling") {
    const room = await capRoom(connection, target, wallet);
    return {
      transaction: await buyWithin(context, room === 0n ? target.cap : room),
      signers: [],
    };
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
  return { transaction: exit.transaction, signers: [] };
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
  outcome: "refused" | "allowed" | "unclear";
  /** The program's own error name, when the refusal was the program's. */
  errorName: string | null;
  /** The sentence that goes with it, from the SDK. */
  sentence: string | null;
  /** The last log line, when the refusal came from somewhere else. */
  logLine: string | null;
  signature: string | null;
  link: string | null;
}

function readLogs(logs: string[] | null, failed: boolean): AttackResult {
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

/** A confirmed transaction can take a moment longer to be readable. */
const DETAIL_TRIES = 6;
const DETAIL_WAIT_MS = 1_200;

/**
 * Reads back an attack that was really sent, so the row can link to it.
 *
 * A refused attack lands on chain on purpose, which is what turns a claim into
 * a signature anybody can open.
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
  const result = readLogs(
    detail?.meta?.logMessages ?? null,
    (detail?.meta?.err ?? null) !== null
  );
  return { ...result, signature, link: explorerTx(signature) };
}

/** The tally at the foot of the ledger, in the prove command's own shape. */
export function tallyLine(counts: {
  run: number;
  refusedAsExpected: number;
  allowedAsExpected: number;
  off: number;
}): string {
  const head =
    `${counts.run} ${counts.run === 1 ? "attack" : "attacks"} run, ` +
    `${counts.refusedAsExpected} refused as expected, ` +
    `${counts.allowedAsExpected} allowed as expected`;
  return counts.off === 0 ? head : `${head}, ${counts.off} off the standard`;
}
