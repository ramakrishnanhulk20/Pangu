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

/**
 * Where DBC keeps a pool's base mint. The same offset Meteora's own
 * `getPoolByBaseMint` filters on. Source: ARCHITECTURE.md, "Offsets inside the
 * pool account", and programs/pangu/src/dbc.rs, BASE_MINT_OFFSET.
 */
const POOL_BASE_MINT_OFFSET = 136;

/** The pool and its launch template: what a trade needs, whatever the rules say. */
export interface PoolMarket {
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

/** Everything a Pangu action needs to know about one live DBC pool. */
export interface PoolView extends PoolMarket {
  sale: Sale;
}

/**
 * What a sell needs. The rules are there when this package can read them and
 * null when it cannot, because a sell never depends on them.
 */
export interface SellView extends PoolMarket {
  sale: Sale | null;
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
 * Reads the pool and its launch template in one go, for a buy or anything else
 * that acts on the sale's rules.
 *
 * Everything downstream comes from these two accounts rather than from the
 * caller, so a wrong vault or a wrong paying token cannot be passed in.
 *
 * Refuses a mint whose rules this package cannot read, because a buy is judged
 * against them. Refuses a pool whose fee schedule needs the instructions sysvar
 * as its first remaining account: a rate limiter, or the first-swap minimum fee.
 * Pangu's hook accounts are the remaining accounts of every swap, and there is
 * no room for a second thing in that list.
 */
export async function loadPool(
  connection: Connection,
  mint: PublicKey
): Promise<PoolView> {
  const sale = await requireSale(connection, mint);
  return { sale, ...(await readMarket(connection, sale.pool)) };
}

/**
 * Reads the pool and its launch template for a sell, which never needs the
 * sale's rules.
 *
 * On chain a sell goes through whatever the rules account holds, including rules
 * written by an older build or rules that are missing (C5). This is the same
 * promise on the client side: the rules are read when they can be, and when
 * they cannot, the pool is found by the mint it sells, straight from DBC, and
 * the sell is built anyway. The hook's own accounts are still resolved from the
 * list the program published, so nothing about the hook is guessed.
 *
 * Throws PanguInputError when no transfer hook pool sells this mint, when more
 * than one does, or for the same template refusal as `loadPool`.
 */
export async function loadSellPool(
  connection: Connection,
  mint: PublicKey
): Promise<SellView> {
  const mintKey = requirePublicKey(mint, "mint");
  let sale: Sale | null = null;
  try {
    sale = await getSale(connection, mintKey);
  } catch (error) {
    // Only "these bytes are not rules this package reads" is swallowed. A
    // network failure is still a failure.
    if (!(error instanceof PanguInputError)) {
      throw error;
    }
  }
  const pool = sale?.pool ?? (await hookPoolSelling(connection, mintKey));
  const market = await readMarket(connection, pool);
  if (!market.baseMint.equals(mintKey)) {
    throw new PanguInputError(
      `${pool.toBase58()} sells ${market.baseMint.toBase58()}, not ${mintKey.toBase58()}`
    );
  }
  return { sale, ...market };
}

/**
 * The one DBC transfer hook pool whose base mint is this mint, asked of DBC
 * itself. Anchor adds the account discriminator to the filter, so only
 * transfer hook pools come back.
 */
async function hookPoolSelling(
  connection: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const found = await dbcProgram(connection).account.transferHookPool.all([
    { memcmp: { offset: POOL_BASE_MINT_OFFSET, bytes: mint.toBase58() } },
  ]);
  if (found.length === 0) {
    throw new PanguInputError(
      `no Meteora transfer hook pool sells ${mint.toBase58()}, so there is nothing to sell into`
    );
  }
  if (found.length > 1) {
    throw new PanguInputError(
      `${found.length} transfer hook pools sell ${mint.toBase58()}, and a sell will not pick one on a guess`
    );
  }
  return found[0]!.publicKey;
}

async function readMarket(
  connection: Connection,
  pool: PublicKey
): Promise<PoolMarket> {
  const program = dbcProgram(connection);
  const poolAccount = (await program.account.transferHookPool.fetchNullable(
    pool,
    "confirmed"
  )) as VirtualPool | null;
  if (poolAccount === null) {
    throw new PanguInputError(
      `${pool.toBase58()} is not a Meteora transfer hook pool`
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
    pool,
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
