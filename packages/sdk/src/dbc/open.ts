import { Keypair, type Connection, type PublicKey, type Transaction } from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  deriveDbcPoolAddress,
  type PoolConfig,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { ACCESS_MODE } from "../constants.js";
import { createSaleInstruction, type PriceBandInput } from "../instructions.js";
import {
  PanguInputError,
  requireBigint,
  requireRealPublicKey,
  requireWholeNumber,
} from "../inputs.js";
import { requireOneTransaction } from "./budget.js";
import { loadConfig, readyToSign } from "./state.js";
import { FORCED } from "./template.js";

/** The sale's rules, as the issuer chooses them. */
export interface SaleTerms {
  /** Most raw token units one wallet may end up holding. */
  cap?: bigint;
  /** The same cap written as a share of what the curve sells. Use one or the other. */
  capShareBps?: number;
  accessMode: number;
  /** Access mode 2 only. */
  credential?: PublicKey;
  schema?: PublicKey;
  band?: PriceBandInput;
}

export interface OpenSaleInput {
  connection: Connection;
  /** The pool's creator, who becomes the sale's issuer. Pays unless a payer is given. */
  creator: PublicKey;
  payer?: PublicKey;
  config: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  sale: SaleTerms;
  /** The new token's mint. Generated when not given. It signs this transaction. */
  baseMint?: Keypair;
}

export interface OpenSale {
  transaction: Transaction;
  baseMint: Keypair;
  pool: PublicKey;
  bytes: number;
}

/**
 * A cap written as a share of the tokens the curve will sell before graduation.
 *
 * Taken from the template rather than from a number typed in, so the cap means
 * the same thing whatever supply the issuer chose.
 */
export function capFromShare(swapBaseAmount: bigint, capShareBps: number): bigint {
  const amount = requireBigint(swapBaseAmount, "swapBaseAmount");
  const bps = requireWholeNumber(capShareBps, "sale.capShareBps", 1, 10_000);
  const cap = (amount * BigInt(bps)) / 10_000n;
  if (cap <= 0n) {
    throw new PanguInputError(
      "that share of this curve rounds down to no tokens at all, raise capShareBps"
    );
  }
  return cap;
}

function capOf(terms: SaleTerms, config: PoolConfig): bigint {
  const hasCap = terms.cap !== undefined && terms.cap !== null;
  const hasShare = terms.capShareBps !== undefined && terms.capShareBps !== null;
  if (hasCap === hasShare) {
    throw new PanguInputError(
      "a sale needs either cap or capShareBps, and never both, because they would disagree"
    );
  }
  return hasCap
    ? requireBigint(terms.cap, "sale.cap")
    : capFromShare(BigInt(config.swapBaseAmount.toString()), terms.capShareBps as number);
}

/**
 * Opens the pool and the sale's rules in one transaction.
 *
 * C7: the rules and the hook's account list are derived from the mint, which is
 * public the moment the pool transaction is seen. Creating them in the same
 * transaction as the pool is what stops anyone else setting the rules for this
 * sale. Nothing is signed or sent here, and the transaction is measured, so a
 * sale that would not fit is refused before the creator signs.
 *
 * Throws PanguInputError when the template is not one Pangu opened, when the
 * cap is given twice or not at all, or when the transaction would not fit.
 */
export async function openSaleTransaction(
  input: OpenSaleInput
): Promise<OpenSale> {
  const creator = requireRealPublicKey(input.creator, "creator");
  const payer = input.payer === undefined ? creator : requireRealPublicKey(input.payer, "payer");
  const config = requireRealPublicKey(input.config, "config");
  const accessMode = requireWholeNumber(input.sale?.accessMode, "sale.accessMode", 0, 2);

  const configState = await loadConfig(input.connection, config);
  if (configState.collectFeeMode !== FORCED.collectFeeMode) {
    throw new PanguInputError(
      "this template collects fees in the sale token, which would move it past every cap. Open the template with launchTemplateTransaction."
    );
  }

  const cap = capOf(input.sale, configState);
  const baseMint = input.baseMint ?? Keypair.generate();
  const quoteMint = configState.quoteMint;
  const pool = deriveDbcPoolAddress(quoteMint, baseMint.publicKey, config);

  const client = new DynamicBondingCurveClient(input.connection, "confirmed");
  const transaction = await client.creator.createPoolWithTransferHook({
    baseMint: baseMint.publicKey,
    config,
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
    payer,
    poolCreator: creator,
    transferHookProgram: FORCED.transferHookProgram,
  });

  const band = input.sale.band;
  transaction.add(
    createSaleInstruction({
      issuer: creator,
      pool,
      mint: baseMint.publicKey,
      cap,
      accessMode,
      credential: accessMode === ACCESS_MODE.verifierCredential ? input.sale.credential : undefined,
      schema: accessMode === ACCESS_MODE.verifierCredential ? input.sale.schema : undefined,
      band,
      dbcConfig: config,
      quoteMint: band === undefined ? undefined : quoteMint,
    })
  );

  await readyToSign(input.connection, transaction, payer);
  return {
    transaction,
    baseMint,
    pool,
    bytes: requireOneTransaction(transaction, "the pool and the sale's rules"),
  };
}
