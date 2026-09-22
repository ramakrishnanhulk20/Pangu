import type { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DynamicBondingCurveClient,
  deriveDammV2PoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PanguInputError, requireRealPublicKey } from "../inputs.js";
import { requireOneTransaction } from "./budget.js";
import { loadPool, readyToSign, type PoolView } from "./state.js";

/** How far a sale has got, in the numbers a judge or a buyer reads. */
export interface SaleProgress {
  /** Raw units of the paying token the curve has taken in. */
  quoteRaised: bigint;
  /** What it has to reach before the sale graduates. */
  threshold: bigint;
  /** Between 0 and 1. */
  percent: number;
  /** True once the curve is full, whether or not anybody has migrated it yet. */
  graduated: boolean;
  /** The DAMM v2 pool, once migration has created it. */
  dammPool: PublicKey | null;
}

export interface GraduateInput {
  connection: Connection;
  /** Anyone may pay for this. It is permissionless. */
  payer: PublicKey;
  mint: PublicKey;
}

export interface Graduate {
  transaction: Transaction;
  /** The two position accounts migration creates. Both sign this transaction. */
  signers: Keypair[];
  /** Where the liquidity lands. */
  dammPool: PublicKey;
  bytes: number;
}

function dammConfigOf(view: PoolView): PublicKey {
  const option = view.configState.migrationFeeOption;
  const config = DAMM_V2_MIGRATION_FEE_ADDRESS[option];
  if (config === undefined) {
    throw new PanguInputError(
      `this template names migration fee option ${option}, which DAMM v2 has no config for`
    );
  }
  return config;
}

/**
 * Migrates a full curve into DAMM v2.
 *
 * Permissionless: anyone can send it, and the sale's own creator gets the
 * locked liquidity whoever pays. No compute budget instruction is added, on
 * purpose: migration measured 153,633 units against the 200,000 a single
 * instruction gets by default, and the transaction is already 1,139 bytes.
 *
 * Throws PanguInputError when the curve is not full yet or has already been
 * migrated.
 */
export async function graduateTransaction(
  input: GraduateInput
): Promise<Graduate> {
  const payer = requireRealPublicKey(input.payer, "payer");
  const view = await loadPool(input.connection, input.mint);
  const state = view.poolAccount.poolState;

  if (state.isMigrated !== 0) {
    throw new PanguInputError("this sale has already been migrated to DAMM v2");
  }
  if (state.quoteReserve.lt(view.configState.migrationQuoteThreshold)) {
    throw new PanguInputError(
      "the curve is not full yet, so there is nothing to migrate"
    );
  }

  const dammConfig = dammConfigOf(view);
  const client = new DynamicBondingCurveClient(input.connection, "confirmed");
  const { transaction, firstPositionNftKeypair, secondPositionNftKeypair } =
    await client.migration.migrateToDammV2({
      pool: view.pool,
      dammConfig,
      payer,
    });

  await readyToSign(input.connection, transaction, payer);
  return {
    transaction,
    signers: [firstPositionNftKeypair, secondPositionNftKeypair],
    dammPool: deriveDammV2PoolAddress(dammConfig, view.baseMint, view.quoteMint),
    bytes: requireOneTransaction(transaction, "the migration to DAMM v2"),
  };
}

/**
 * How far this sale has got, read from the pool and its template.
 *
 * `graduated` is the curve being full, which is the moment DBC takes the hook
 * off the mint. `dammPool` stays null until somebody sends the migration, so
 * the two questions the app asks, "is the sale over" and "where does it trade
 * now", are answered separately.
 *
 * Throws PanguInputError for a mint with no Pangu sale.
 */
export async function saleProgress(
  connection: Connection,
  mint: PublicKey
): Promise<SaleProgress> {
  const view = await loadPool(connection, mint);
  const quoteRaised = BigInt(view.poolAccount.poolState.quoteReserve.toString());
  const threshold = BigInt(view.configState.migrationQuoteThreshold.toString());
  const dammPool = deriveDammV2PoolAddress(
    dammConfigOf(view),
    view.baseMint,
    view.quoteMint
  );
  const exists = await connection.getAccountInfo(dammPool);

  return {
    quoteRaised,
    threshold,
    percent:
      threshold === 0n
        ? 0
        : Math.min(1, Number((quoteRaised * 1_000_000n) / threshold) / 1_000_000),
    graduated: quoteRaised >= threshold,
    dammPool: exists === null ? null : dammPool,
  };
}
