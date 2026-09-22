import type { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { TOKEN_2022_PROGRAM_ID } from "../constants.js";
import { PanguInputError } from "../inputs.js";
import { COMPUTE_LIMIT, computeLimit, requireOneTransaction } from "./budget.js";
import { hookAccounts, hookAccountsInfo, type PendingTokenAccount } from "./hook.js";
import { DBC_POOL_AUTHORITY, dbcProgram, loadPool, readyToSign } from "./state.js";

/** Everything a claim leaves the caller with. */
export interface ClaimFees {
  transaction: Transaction;
  /** Who the fees go to, read from the pool and its template, not passed in. */
  claimer: PublicKey;
  bytes: number;
  computeUnitLimit: number;
}

export interface ClaimFeesInput {
  connection: Connection;
  who: "partner" | "creator";
  mint: PublicKey;
}

/** u64 max: claim everything that has built up. */
const EVERYTHING = new BN("18446744073709551615");

/**
 * Claims the trading fees of a sale that is still running.
 *
 * Meteora's own `claimPartnerTradingFee` calls the older instruction, which
 * refuses a transfer hook pool with `PoolTypeMismatch`. This builds the hook
 * aware pair, `claim_trading_fee2` and `claim_creator_trading_fee2`, with the
 * hook's accounts attached. See finding 2 in docs/measurements/fork-test.md.
 *
 * The claimer is read off the chain: the partner is the template's fee claimer
 * and the creator is the pool's creator, so no address a caller typed in can
 * receive this money. The sale's fees are collected in the paying token only
 * (C11), so no sale token moves here.
 *
 * Throws PanguInputError for a mint with no Pangu sale.
 */
export async function claimFeesTransaction(
  input: ClaimFeesInput
): Promise<ClaimFees> {
  if (input.who !== "partner" && input.who !== "creator") {
    throw new PanguInputError('who must be "partner" or "creator"');
  }
  const view = await loadPool(input.connection, input.mint);
  const claimer =
    input.who === "partner"
      ? view.configState.feeClaimer
      : view.poolAccount.poolState.creator;

  const baseAta = getAssociatedTokenAddressSync(
    view.baseMint,
    claimer,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const quoteAta = getAssociatedTokenAddressSync(
    view.quoteMint,
    claimer,
    false,
    view.quoteProgram
  );

  const pending: PendingTokenAccount[] = [];
  const pre: TransactionInstruction[] = [computeLimit(COMPUTE_LIMIT.claim)];
  if ((await input.connection.getAccountInfo(baseAta)) === null) {
    pending.push({ address: baseAta, mint: view.baseMint, owner: claimer });
  }
  pre.push(
    createAssociatedTokenAccountIdempotentInstruction(
      claimer,
      baseAta,
      claimer,
      view.baseMint,
      TOKEN_2022_PROGRAM_ID
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      claimer,
      quoteAta,
      claimer,
      view.quoteMint,
      view.quoteProgram
    )
  );

  // The claim moves the paying token, but DBC still hands the hook's accounts
  // to the token program for the base side, so they are resolved for the pair
  // this claim would move: out of the pool's vault, into the claimer's account.
  const hook = await hookAccounts({
    connection: input.connection,
    mint: view.baseMint,
    source: view.baseVault,
    destination: baseAta,
    authority: DBC_POOL_AUTHORITY,
    amount: 0n,
    pending,
  });

  const shared = {
    poolAuthority: DBC_POOL_AUTHORITY,
    pool: view.pool,
    tokenAAccount: baseAta,
    tokenBAccount: quoteAta,
    baseVault: view.baseVault,
    quoteVault: view.quoteVault,
    baseMint: view.baseMint,
    quoteMint: view.quoteMint,
    tokenBaseProgram: TOKEN_2022_PROGRAM_ID,
    tokenQuoteProgram: view.quoteProgram,
  };

  const program = dbcProgram(input.connection);
  const builder =
    input.who === "partner"
      ? program.methods
          .claimTradingFee2(new BN(0), EVERYTHING, hookAccountsInfo(hook))
          .accountsPartial({ ...shared, config: view.config, feeClaimer: claimer })
      : program.methods
          .claimCreatorTradingFee2(new BN(0), EVERYTHING, hookAccountsInfo(hook))
          .accountsPartial({ ...shared, creator: claimer });

  const transaction = await builder
    .remainingAccounts(hook)
    .preInstructions(pre)
    .transaction();

  await readyToSign(input.connection, transaction, claimer);
  return {
    transaction,
    claimer,
    bytes: requireOneTransaction(transaction, `the ${input.who} fee claim`),
    computeUnitLimit: COMPUTE_LIMIT.claim,
  };
}
