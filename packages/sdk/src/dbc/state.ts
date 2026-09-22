import type { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  BaseFeeMode,
  DynamicBondingCurveClient,
  createDbcProgram,
  deriveDbcPoolAuthority,
  getCurrentPoint,
  getTokenProgram,
  type PoolConfig,
  type VirtualPool,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { BN } from "@anchor-lang/core";
import { getSale, type Sale } from "../accounts.js";
import { PanguInputError, requirePublicKey } from "../inputs.js";

/** DBC's pool authority. Every pool vault is owned by it. */
export const DBC_POOL_AUTHORITY = deriveDbcPoolAuthority();

/** Everything a Pangu action needs to know about one live DBC pool. */
export interface PoolView {
  sale: Sale;
  pool: PublicKey;
  /** The account as DBC's own quote functions want it, with `.poolState` inside. */
  poolAccount: VirtualPool;
  config: PublicKey;
  configState: PoolConfig;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  /** The token program the paying token belongs to, SPL or Token-2022. */
  quoteProgram: PublicKey;
  /** The unit DBC counts the fee schedule in, a slot or a Unix second. */
  currentPoint: BN;
}

export function dbcProgram(connection: Connection) {
  return createDbcProgram(connection, "confirmed").program;
}

/** The sale's rules, refusing a mint that never had a Pangu sale. */
export async function requireSale(
  connection: Connection,
  mint: PublicKey
): Promise<Sale> {
  const sale = await getSale(connection, requirePublicKey(mint, "mint"));
  if (sale === null) {
    throw new PanguInputError(
      `${mint.toBase58()} has no Pangu sale, so there is nothing to trade here`
    );
  }
  return sale;
}

/**
 * A launch template, whichever of the two shapes DBC stored it in.
 *
 * A transfer hook template is a `configWithTransferHook` account with the
 * ordinary config inside it, not a `poolConfig`, so reading it as a `poolConfig`
 * fails on the discriminator. Meteora's own state service knows both, so it does
 * the reading.
 *
 * Throws PanguInputError when the address is not a launch template at all.
 */
export async function loadConfig(
  connection: Connection,
  config: PublicKey
): Promise<PoolConfig> {
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  const state = await client.state.getPoolConfig(config);
  if (state === null) {
    throw new PanguInputError(
      `${config.toBase58()} is not a Meteora launch template`
    );
  }
  return state;
}

/**
 * Reads the pool and its launch template in one go.
 *
 * Everything downstream comes from these two accounts rather than from the
 * caller, so a wrong vault or a wrong paying token cannot be passed in.
 *
 * Refuses a pool whose fee schedule needs the instructions sysvar as its first
 * remaining account: a rate limiter, or the first-swap minimum fee. Pangu's
 * hook accounts are the remaining accounts of every swap, and there is no room
 * for a second thing in that list.
 */
export async function loadPool(
  connection: Connection,
  mint: PublicKey
): Promise<PoolView> {
  const sale = await requireSale(connection, mint);
  const program = dbcProgram(connection);
  const poolAccount = (await program.account.transferHookPool.fetchNullable(
    sale.pool,
    "confirmed"
  )) as VirtualPool | null;
  if (poolAccount === null) {
    throw new PanguInputError(
      `${sale.pool.toBase58()} is not a Meteora transfer hook pool`
    );
  }

  const configState = await loadConfig(connection, poolAccount.poolState.config);

  if (
    configState.enableFirstSwapWithMinFee ||
    configState.poolFees.baseFee.baseFeeMode === BaseFeeMode.RateLimiter
  ) {
    throw new PanguInputError(
      "this launch template puts the instructions sysvar in the swap's remaining accounts, where Pangu's hook accounts have to be. Open the sale with launchTemplateTransaction."
    );
  }

  return {
    sale,
    pool: sale.pool,
    poolAccount,
    config: poolAccount.poolState.config,
    configState,
    baseMint: poolAccount.poolState.baseMint,
    quoteMint: configState.quoteMint,
    baseVault: poolAccount.poolState.baseVault,
    quoteVault: poolAccount.poolState.quoteVault,
    quoteProgram: getTokenProgram(configState.quoteTokenFlag),
    currentPoint: await getCurrentPoint(connection, configState.activationType),
  };
}

/** Sets the payer and a fresh blockhash, so the caller can measure and sign. */
export async function readyToSign(
  connection: Connection,
  transaction: Transaction,
  payer: PublicKey
): Promise<Transaction> {
  transaction.feePayer = payer;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash("confirmed")
  ).blockhash;
  return transaction;
}
