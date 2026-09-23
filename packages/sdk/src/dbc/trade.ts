import {
  SystemProgram,
  type Connection,
  type PublicKey,
  type Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import {
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { buyerRecordAddress } from "../addresses.js";
import { TOKEN_2022_PROGRAM_ID } from "../constants.js";
import { openBuyerRecordInstruction } from "../instructions.js";
import { PanguInputError, requireBigint, requireRealPublicKey, requireWholeNumber } from "../inputs.js";
import { COMPUTE_LIMIT, computeLimit, requireOneTransaction } from "./budget.js";
import { quoteExactIn, quotePartialFill } from "./quote.js";
import { hookAccounts, hookAccountsInfo, type PendingTokenAccount } from "./hook.js";
import {
  DBC_POOL_AUTHORITY,
  dbcProgram,
  loadPool,
  loadSellPool,
  readyToSign,
  type PoolMarket,
} from "./state.js";

/** A trade, built but not signed. */
export interface TradeTransaction {
  transaction: Transaction;
  /** What Meteora's own quote says this trade returns, in raw units. */
  expectedAmountOut: bigint;
  /** The least the trade may return before it is refused, after slippage. */
  minimumAmountOut: bigint;
  bytes: number;
  computeUnitLimit: number;
}

export interface BuyInput {
  connection: Connection;
  buyer: PublicKey;
  mint: PublicKey;
  /** Raw units of the paying token to spend. */
  amountIn: bigint;
  slippageBps?: number;
  /**
   * How to handle a curve with less left than this buy asks for.
   *
   * "exactIn", the default, spends the whole amount or the trade is refused.
   * "partial" lets DBC take what the curve can still absorb and leave the rest
   * in the buyer's account. The last buy of a sale needs "partial": the tokens
   * run out before the paying side does, and an exact-in swap is refused.
   */
  fill?: "exactIn" | "partial";
}

export interface SellInput {
  connection: Connection;
  seller: PublicKey;
  mint: PublicKey;
  /** Raw units of the sale token to sell back to the pool. */
  amountIn: bigint;
  slippageBps?: number;
}

const DEFAULT_SLIPPAGE_BPS = 100;

/**
 * One swap through the hook, built by hand.
 *
 * The Meteora SDK's own `swap2WithTransferHook` resolves a hook's extra
 * accounts against placeholder token accounts, which cannot work for a hook
 * that derives a buyer's record from the real receiver. So the same on-chain
 * instruction is built here and the accounts come from Pangu's published list.
 * See finding 1 in docs/measurements/fork-test.md.
 */
async function buildSwap(options: {
  connection: Connection;
  view: PoolMarket;
  owner: PublicKey;
  swapBaseForQuote: boolean;
  amountIn: bigint;
  slippageBps: number;
  action: string;
  fill?: "exactIn" | "partial";
}): Promise<TradeTransaction> {
  const { connection, view, owner, swapBaseForQuote, amountIn } = options;
  const partial = options.fill === "partial";
  const quote = partial
    ? quotePartialFill(view, swapBaseForQuote, amountIn, options.slippageBps)
    : quoteExactIn(view, swapBaseForQuote, amountIn, options.slippageBps);
  // A partial fill takes an unknown share of the input, so a floor worked out
  // from the whole of it would refuse the trade. The curve itself is the floor.
  const minimumAmountOut = partial
    ? 0n
    : BigInt((quote.minimumAmountOut ?? 0n).toString());

  const quoteAta = getAssociatedTokenAddressSync(
    view.quoteMint,
    owner,
    false,
    view.quoteProgram
  );
  const baseAta = getAssociatedTokenAddressSync(
    view.baseMint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const pre: TransactionInstruction[] = [computeLimit(COMPUTE_LIMIT.swap)];
  const pending: PendingTokenAccount[] = [];

  // The paying token account is opened either way: it receives on a sell and
  // pays on a buy, and idempotent means a second buy costs nothing extra.
  pre.push(
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      quoteAta,
      owner,
      view.quoteMint,
      view.quoteProgram
    )
  );

  if (!swapBaseForQuote) {
    const baseAccount = await connection.getAccountInfo(baseAta);
    if (baseAccount === null) {
      pre.push(
        createAssociatedTokenAccountIdempotentInstruction(
          owner,
          baseAta,
          owner,
          view.baseMint,
          TOKEN_2022_PROGRAM_ID
        )
      );
      pending.push({ address: baseAta, mint: view.baseMint, owner });
    }
    if (view.quoteMint.equals(NATIVE_MINT)) {
      pre.push(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: quoteAta,
          lamports: amountIn,
        }),
        createSyncNativeInstruction(quoteAta, view.quoteProgram)
      );
    }
    // A transfer hook cannot create accounts, so the record has to exist before
    // the buy. Sending it again would fail, so it only goes in when missing.
    const record = await connection.getAccountInfo(
      buyerRecordAddress(view.baseMint, owner)
    );
    if (record === null) {
      pre.push(openBuyerRecordInstruction({ wallet: owner, mint: view.baseMint }));
    }
  }

  const hook = await hookAccounts({
    connection,
    mint: view.baseMint,
    source: swapBaseForQuote ? baseAta : view.baseVault,
    destination: swapBaseForQuote ? view.baseVault : baseAta,
    authority: swapBaseForQuote ? owner : DBC_POOL_AUTHORITY,
    amount: swapBaseForQuote ? amountIn : BigInt(quote.outputAmount.toString()),
    pending,
  });

  const transaction = await dbcProgram(connection)
    .methods.swap2WithTransferHook(
      {
        amount0: new BN(amountIn.toString()),
        amount1: new BN(minimumAmountOut.toString()),
        swapMode: partial ? SwapMode.PartialFill : SwapMode.ExactIn,
      },
      hookAccountsInfo(hook)
    )
    .accountsPartial({
      poolAuthority: DBC_POOL_AUTHORITY,
      config: view.config,
      pool: view.pool,
      inputTokenAccount: swapBaseForQuote ? baseAta : quoteAta,
      outputTokenAccount: swapBaseForQuote ? quoteAta : baseAta,
      baseVault: view.baseVault,
      quoteVault: view.quoteVault,
      baseMint: view.baseMint,
      quoteMint: view.quoteMint,
      payer: owner,
      tokenBaseProgram: TOKEN_2022_PROGRAM_ID,
      tokenQuoteProgram: view.quoteProgram,
      referralTokenAccount: null,
    })
    .remainingAccounts(hook)
    .preInstructions(pre)
    .transaction();

  await readyToSign(connection, transaction, owner);
  return {
    transaction,
    expectedAmountOut: BigInt(quote.outputAmount.toString()),
    minimumAmountOut,
    bytes: requireOneTransaction(transaction, options.action),
    computeUnitLimit: COMPUTE_LIMIT.swap,
  };
}

function slippageOf(value: number | undefined): number {
  return value === undefined
    ? DEFAULT_SLIPPAGE_BPS
    : requireWholeNumber(value, "slippageBps", 0, 10_000);
}

function amountOf(value: unknown, field: string): bigint {
  const amount = requireBigint(value, field);
  if (amount <= 0n) {
    throw new PanguInputError(`${field} must be above zero`);
  }
  return amount;
}

/**
 * Buys into a sale: the buyer's paying token in, the sale token out.
 *
 * Everything the hook needs travels with it. The paying token account is opened
 * if missing, wrapped SOL is funded, the buyer's record is opened when this is
 * their first buy, and the hook's accounts come from the sale's own published
 * list, so a credential sale and a banded sale carry their extra accounts
 * without the caller knowing they exist. Nothing is signed or sent.
 *
 * Throws PanguInputError for a mint with no Pangu sale, an amount of zero, or a
 * transaction that would not fit.
 */
export async function buyTransaction(input: BuyInput): Promise<TradeTransaction> {
  const buyer = requireRealPublicKey(input.buyer, "buyer");
  const amountIn = amountOf(input.amountIn, "amountIn");
  const view = await loadPool(input.connection, input.mint);
  return buildSwap({
    connection: input.connection,
    view,
    owner: buyer,
    swapBaseForQuote: false,
    amountIn,
    slippageBps: slippageOf(input.slippageBps),
    action: "the buy",
    fill: input.fill ?? "exactIn",
  });
}

/**
 * Sells back to the pool: the sale token in, the paying token out.
 *
 * The exit reads nothing that can be missing, which is C5 in the threat model,
 * so a seller who is no longer approved, or whose sale's price feed has gone
 * stale, still gets out. That includes a sale whose rules this package cannot
 * read, because an older build wrote them: the program lets that sell through,
 * so the pool is found from the mint instead and the sell is built all the
 * same. Nothing is signed or sent.
 *
 * Throws PanguInputError when no transfer hook pool sells the mint, for an
 * amount of zero, or for a transaction that would not fit.
 */
export async function sellTransaction(input: SellInput): Promise<TradeTransaction> {
  const seller = requireRealPublicKey(input.seller, "seller");
  const amountIn = amountOf(input.amountIn, "amountIn");
  const view = await loadSellPool(input.connection, input.mint);
  return buildSwap({
    connection: input.connection,
    view,
    owner: seller,
    swapBaseForQuote: true,
    amountIn,
    slippageBps: slippageOf(input.slippageBps),
    action: "the sell",
  });
}
