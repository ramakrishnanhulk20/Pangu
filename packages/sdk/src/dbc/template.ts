import { Keypair, type Connection, type PublicKey, type Transaction } from "@solana/web3.js";
import {
  CollectFeeMode,
  DynamicBondingCurveClient,
  MigrationOption,
  TokenAuthorityOption,
  TokenType,
  buildCurve,
  hasMintAuthority,
  type BuildCurveParams,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PANGU_PROGRAM_ID } from "../constants.js";
import { PanguInputError, requireRealPublicKey } from "../inputs.js";
import { requireOneTransaction } from "./budget.js";
import { readyToSign } from "./state.js";

/**
 * The settings a Pangu sale cannot work without.
 *
 * Token-2022 base: a transfer hook only exists on Token-2022.
 * The hook program: Pangu itself, or no rule is ever applied.
 * DAMM v2 migration: where a finished sale graduates to.
 * Fees in the paying token only: C11 in the threat model. With fees collected
 * in the sale token, a fee claim would move the sale token while the hook is
 * live, past every cap and approval.
 * The token authority option: C14. It decides whether DBC leaves the mint
 * authority alive at pool creation, and a token that can still be minted is one
 * the hook can never hold to a cap.
 */
export const FORCED = {
  tokenType: TokenType.Token2022,
  tokenUpdateAuthority: TokenAuthorityOption.CreatorUpdateAuthority,
  collectFeeMode: CollectFeeMode.QuoteToken,
  migrationOption: MigrationOption.MET_DAMM_V2,
  transferHookProgram: PANGU_PROGRAM_ID,
} as const;

function forced<T>(
  given: T | undefined,
  wanted: T,
  field: string,
  why: string
): T {
  if (given !== undefined && given !== wanted) {
    throw new PanguInputError(
      `${field} is fixed at ${String(wanted)} for a Pangu sale and cannot be set to ${String(given)}: ${why}`
    );
  }
  return wanted;
}

/**
 * The token authority option, refusing any that leaves the mint authority alive.
 *
 * Minting is not a transfer, so no hook ever sees it. A mint authority left
 * alive is a way to hand any wallet any amount, past the cap and past the
 * approved list, and `create_sale` refuses such a mint with
 * MintAuthorityStillSet. DBC decides it here, at the template, and drops the
 * authority at pool creation for every option that does not say "and mint
 * authority". The question asked is Meteora's own `hasMintAuthority`, not a list
 * of option names, so an option they add later is judged by what it does. What
 * this does not cover: who holds the update authority, which only changes the
 * token's metadata and is the issuer's to choose.
 */
function withoutMintAuthority(
  given: TokenAuthorityOption | undefined
): TokenAuthorityOption {
  if (given === undefined) {
    return FORCED.tokenUpdateAuthority;
  }
  if (hasMintAuthority(given)) {
    throw new PanguInputError(
      `curve.token.tokenAuthorityOption ${String(given)} leaves the mint authority alive, and Pangu will not open a sale on a token that can still be minted: use CreatorUpdateAuthority, Immutable or PartnerUpdateAuthority`
    );
  }
  return given;
}

/**
 * The caller's curve with Pangu's own settings put in.
 *
 * Anything else about the curve, the supply, the graduation threshold, the fee
 * schedule, the liquidity split, is the issuer's to choose. Exported so the app
 * can show what it will send before anybody signs.
 *
 * Throws PanguInputError when the caller set one of Pangu's settings to
 * something else, or asked for a token that can still be minted.
 */
export function panguCurve(curve: BuildCurveParams): BuildCurveParams {
  if (curve === null || typeof curve !== "object") {
    throw new PanguInputError("curve must be the parameters buildCurve takes");
  }
  return {
    ...curve,
    token: {
      ...curve.token,
      tokenType: forced(
        curve.token?.tokenType,
        FORCED.tokenType,
        "curve.token.tokenType",
        "a transfer hook only exists on Token-2022"
      ),
      tokenAuthorityOption: withoutMintAuthority(curve.token?.tokenAuthorityOption),
    },
    fee: {
      ...curve.fee,
      collectFeeMode: forced(
        curve.fee?.collectFeeMode,
        FORCED.collectFeeMode,
        "curve.fee.collectFeeMode",
        "fees taken in the sale token would move it past every cap and approval"
      ),
    },
    migration: {
      ...curve.migration,
      migrationOption: forced(
        curve.migration?.migrationOption,
        FORCED.migrationOption,
        "curve.migration.migrationOption",
        "a Pangu sale graduates to DAMM v2"
      ),
    },
  };
}

export interface LaunchTemplateInput {
  connection: Connection;
  /** The partner opening the template. Pays unless a payer is given. */
  partner: PublicKey;
  payer?: PublicKey;
  /** The token buyers pay in. */
  quoteMint: PublicKey;
  curve: BuildCurveParams;
  /** Who may claim the partner's share of the trading fees. Defaults to partner. */
  feeClaimer?: PublicKey;
  /** Who receives tokens left on the curve at graduation. Defaults to partner. */
  leftoverReceiver?: PublicKey;
  /** DBC's badge for a paying token that needs one, such as a stock token. */
  tokenBadge?: PublicKey;
  /** The hook program. Only Pangu's own id is allowed. */
  transferHookProgram?: PublicKey;
}

export interface LaunchTemplate {
  transaction: Transaction;
  /** The new template's account. It signs this transaction once. */
  config: Keypair;
  bytes: number;
}

/**
 * Builds the launch template every Pangu sale is opened from.
 *
 * Wraps Meteora's `createConfigWithTransferHook` and fixes the settings a Pangu
 * sale depends on, refusing any attempt to set them otherwise. Signs and
 * sends nothing: the partner signs the returned transaction together with the
 * returned config keypair.
 *
 * Throws PanguInputError for a forced setting the caller tried to override, or
 * for a transaction that would not fit.
 */
export async function launchTemplateTransaction(
  input: LaunchTemplateInput
): Promise<LaunchTemplate> {
  const partner = requireRealPublicKey(input.partner, "partner");
  const payer = input.payer === undefined ? partner : requireRealPublicKey(input.payer, "payer");
  const quoteMint = requireRealPublicKey(input.quoteMint, "quoteMint");
  forced(
    input.transferHookProgram?.toBase58(),
    FORCED.transferHookProgram.toBase58(),
    "transferHookProgram",
    "the sale's rules live in Pangu, so Pangu has to be the hook"
  );

  const client = new DynamicBondingCurveClient(input.connection, "confirmed");
  const config = Keypair.generate();
  const transaction = await client.partner.createConfigWithTransferHook({
    config: config.publicKey,
    feeClaimer: input.feeClaimer ?? partner,
    leftoverReceiver: input.leftoverReceiver ?? partner,
    payer,
    quoteMint,
    tokenBadge: input.tokenBadge,
    transferHookProgram: FORCED.transferHookProgram,
    ...buildCurve(panguCurve(input.curve)),
  });

  await readyToSign(input.connection, transaction, payer);
  return {
    transaction,
    config,
    bytes: requireOneTransaction(transaction, "the launch template"),
  };
}
