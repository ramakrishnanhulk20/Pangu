import { SYSVAR_CLOCK_PUBKEY, type Connection, type PublicKey } from "@solana/web3.js";
import type { Sale } from "../accounts.js";
import { getBuyerRecord } from "../accounts.js";
import { attestationAddress } from "../addresses.js";
import { curvePriceDollars, priceCeiling } from "../band.js";
import { ACCESS_MODE } from "../constants.js";
import { explainPanguError, type PanguErrorName } from "../errors.js";
import { PanguInputError, requireBigint, requireRealPublicKey } from "../inputs.js";
import { readPrice, type PriceReading } from "../feed.js";
import { credentialRefusal } from "./credential.js";
import { quoteExactOut } from "./quote.js";
import { loadPool } from "./state.js";

/** What the chain says about a buy that has not been signed yet. */
export interface BuyPreflight {
  ok: boolean;
  /** The program's own refusal this buy would hit, or null when it would pass. */
  error: PanguErrorName | null;
  /** One sentence a buyer can read. Null when the buy would pass. */
  reason: string | null;
  /** Raw token units this wallet may still buy before the cap stops it. */
  capRoom: bigint;
  /** Where this buy would leave the curve, in dollars scaled by 1e18. */
  curvePrice: bigint | null;
  /** The highest curve price the band allows right now, same scale. */
  ceiling: bigint | null;
  /** The sale's live stock price, when it has a band. */
  price: PriceReading | null;
  /**
   * True when the wallet has no record yet and the caller said the buy opens
   * one in the same transaction, so every answer above assumes a fresh record:
   * unapproved, nothing bought. `buyTransaction` always does that.
   */
  recordOpensInThisBuy: boolean;
}

function refused(
  error: PanguErrorName,
  capRoom: bigint,
  extra: Partial<BuyPreflight> = {}
): BuyPreflight {
  return {
    ok: false,
    error,
    reason: explainPanguError(error),
    capRoom,
    curvePrice: null,
    ceiling: null,
    price: null,
    recordOpensInThisBuy: false,
    ...extra,
  };
}

export interface PreflightBuyInput {
  connection: Connection;
  buyer: PublicKey;
  mint: PublicKey;
  /** Raw units of the sale token the buyer wants to end up with. */
  amountOut: bigint;
  /**
   * Set when the buy will open the wallet's record in the same transaction, as
   * `buyTransaction` does on a first buy. A missing record is then judged as
   * the fresh one that transaction creates instead of being refused, so a first
   * buyer gets the band and the cap answers. Off by default, which refuses a
   * missing record with BuyerRecordMissing as the hook would on its own.
   */
  openingRecord?: boolean;
}

/**
 * Says whether a buy would be refused, and why, before anything is signed.
 *
 * Runs the hook's own checks in the hook's own order against live chain state:
 * the record, the approval or the credential, the price band, then the cap.
 * The order is the hook's and not a tidier one, because a buy that breaks two
 * rules at once has to be given the same refusal here that the chain would
 * give it, and handle_execute judges the band before the cap.
 *
 * In mode 2 the attestation and the credential's list of authorized signers are
 * decoded here the way the hook decodes them, so a wallet is told whether its
 * approval is missing, out of date, or signed by a key the verifier has since
 * dropped. The answer is one of the program's error names with its plain
 * sentence, so the app can say the same thing before and after a refusal.
 *
 * With `openingRecord` a wallet with no record is judged as the record the buy
 * opens would leave it: not approved, nothing bought, so an issuer-list sale
 * still answers NotApproved and every other sale goes on to the band and the
 * cap with the whole cap as room.
 *
 * What it cannot see: the Wormhole guardian signatures behind the price, which
 * only Pyth's receiver program can check, and anything that changes between
 * this read and the buy landing. A "pass" here is the state now, not a promise.
 *
 * Throws PanguInputError for a mint with no Pangu sale.
 */
export async function preflightBuy(
  input: PreflightBuyInput
): Promise<BuyPreflight> {
  const buyer = requireRealPublicKey(input.buyer, "buyer");
  const amountOut = requireBigint(input.amountOut, "amountOut");
  if (amountOut <= 0n) {
    throw new PanguInputError("amountOut must be above zero");
  }

  const openingRecord = input.openingRecord === true;

  const view = await loadPool(input.connection, input.mint);
  const sale = view.sale;
  const existing = await getBuyerRecord(input.connection, sale.mint, buyer);

  if (existing === null && !openingRecord) {
    return refused("BuyerRecordMissing", sale.cap);
  }
  const recordOpensInThisBuy = existing === null;
  // What open_buyer_record writes: this wallet, not approved, nothing bought.
  const record = existing ?? { approved: false, netBought: 0n };
  const capRoom = max(sale.cap - record.netBought, 0n);
  const opened = { recordOpensInThisBuy };

  if (sale.accessMode === ACCESS_MODE.issuerList && !record.approved) {
    return refused("NotApproved", capRoom, opened);
  }
  if (sale.accessMode === ACCESS_MODE.verifierCredential) {
    const refusal = await credentialCheck(input.connection, sale, buyer);
    if (refusal !== null) {
      return refused(refusal, capRoom, opened);
    }
  }

  let price: PriceReading | null = null;
  let curvePrice: bigint | null = null;
  let ceiling: bigint | null = null;

  if (sale.hasBand) {
    price = await readPrice(input.connection, sale);
    if (!price.usable) {
      return refused(price.error ?? "PriceStale", capRoom, { price, ...opened });
    }

    // Where this buy would leave the curve, from Meteora's own exact-out quote,
    // against the ceiling the band puts on it. Both roundings match the program's.
    const quote = quoteExactOut(view, false, amountOut, 0);
    curvePrice = curvePriceDollars(
      BigInt(quote.nextSqrtPrice.toString()),
      sale.baseDecimals,
      sale.quoteDecimals
    );
    ceiling = priceCeiling(sale, price.price);
    if (curvePrice > ceiling) {
      return refused("PriceOutsideBand", capRoom, { curvePrice, ceiling, price, ...opened });
    }
  }

  if (amountOut > capRoom) {
    return refused("OverCap", capRoom, { curvePrice, ceiling, price, ...opened });
  }

  return {
    ok: true,
    error: null,
    reason: null,
    capRoom,
    curvePrice,
    ceiling,
    price,
    recordOpensInThisBuy,
  };
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** Where the Clock sysvar keeps its Unix time: slot, epoch start, epoch, schedule. */
const CLOCK_UNIX_TIMESTAMP_OFFSET = 32;

/**
 * Reads the credential, the attestation and the chain's clock in one call, then
 * asks the same question the hook asks.
 *
 * The time comes from the Clock sysvar rather than this machine, because that is
 * the clock the hook compares an expiry against and a laptop can be minutes out.
 * If the sysvar cannot be read, this machine's clock stands in, which can only
 * misjudge an expiry within that drift.
 */
async function credentialCheck(
  connection: Connection,
  sale: Sale,
  buyer: PublicKey
): Promise<PanguErrorName | null> {
  const read = await connection.getMultipleAccountsInfo([
    sale.credential,
    attestationAddress(sale.credential, sale.schema, buyer),
    SYSVAR_CLOCK_PUBKEY,
  ]);
  const credential = read[0] ?? null;
  const attestation = read[1] ?? null;
  const clock = read[2] ?? null;

  const stamp =
    clock !== null && clock.data.length >= CLOCK_UNIX_TIMESTAMP_OFFSET + 8
      ? Number(clock.data.readBigInt64LE(CLOCK_UNIX_TIMESTAMP_OFFSET))
      : Math.floor(Date.now() / 1000);

  return credentialRefusal(sale, buyer, {
    credential:
      credential === null ? null : { owner: credential.owner, data: credential.data },
    attestation:
      attestation === null ? null : { owner: attestation.owner, data: attestation.data },
    now: stamp,
  });
}
