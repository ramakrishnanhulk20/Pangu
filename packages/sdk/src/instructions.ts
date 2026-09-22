import { BN } from "@anchor-lang/core";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  buyerRecordAddress,
  canonicalQuoteAddress,
  extraAccountListAddress,
  feedIdBytes,
  saleRulesAddress,
  type FeedId,
} from "./addresses.js";
import { panguCoder } from "./coder.js";
import { ACCESS_MODE, LIMITS, PANGU_PROGRAM_ID } from "./constants.js";
import {
  PanguInputError,
  requireAbsent,
  requireBigint,
  requireRealPublicKey,
  requireWholeNumber,
} from "./inputs.js";

/** The ceiling a sale can put on the curve price, against the real stock's price. */
export interface PriceBandInput {
  /** How far above the live stock price a buy may leave the curve, in basis points. */
  bps: number;
  /** The Switchboard queue whose oracles sign the quote. */
  priceQueue: PublicKey;
  /** The feed carrying the stock price, as hex or 32 bytes. */
  priceFeedId: FeedId;
  /** The feed carrying the time of the last real market trade. */
  clockFeedId: FeedId;
  maxPriceAgeSlots: number;
  maxMarketAgeSecs: number;
  minOracles: number;
}

export interface CreateSaleInput {
  /** The pool's creator, who signs and pays. */
  issuer: PublicKey;
  /** The DBC hook pool, which must already exist. */
  pool: PublicKey;
  mint: PublicKey;
  /** Most raw token units one wallet may hold, net of sells. */
  cap: bigint;
  accessMode: number;
  /** Access mode 2 only: the verifier's credential and the schema that counts. */
  credential?: PublicKey;
  schema?: PublicKey;
  band?: PriceBandInput;
  /**
   * The DBC launch template this pool was opened on. Needed in every mode: the
   * program reads the fee mode off it before it will open a sale at all.
   */
  dbcConfig: PublicKey;
  /** Band only: the token buyers pay in, whose decimals the rules store. */
  quoteMint?: PublicKey;
}

export interface OpenBuyerRecordInput {
  wallet: PublicKey;
  mint: PublicKey;
}

export interface ApproveBuyerInput {
  issuer: PublicKey;
  mint: PublicKey;
  wallet: PublicKey;
}

export type RevokeBuyerInput = ApproveBuyerInput;

export interface CloseBuyerRecordInput {
  wallet: PublicKey;
  mint: PublicKey;
}

const U32_MAX = 4_294_967_295;
const U8_MAX = 255;

const ZERO_FEED = Array<number>(LIMITS.feedIdLength).fill(0);

/** What the program stores for a sale with no band: every field zero. */
const NO_BAND = {
  band_bps: 0,
  price_account: PublicKey.default,
  price_queue: PublicKey.default,
  price_feed_id: ZERO_FEED,
  clock_feed_id: ZERO_FEED,
  max_price_age_slots: 0,
  max_market_age_secs: 0,
  min_oracles: 0,
};

function meta(
  pubkey: PublicKey,
  isSigner: boolean,
  isWritable: boolean
): AccountMeta {
  return { pubkey, isSigner, isWritable };
}

/**
 * How Anchor says "this optional account was not passed": the program's own id
 * sits in its place. Leaving the slot out instead would shift every account
 * after it.
 */
function absentAccount(): AccountMeta {
  return meta(PANGU_PROGRAM_ID, false, false);
}

function build(name: string, keys: AccountMeta[], args: object): TransactionInstruction {
  return new TransactionInstruction({
    programId: PANGU_PROGRAM_ID,
    keys,
    data: panguCoder().instruction.encode(name, args),
  });
}

function bandFields(band: PriceBandInput, field: string) {
  const bps = requireWholeNumber(band.bps, `${field}.bps`, 1, LIMITS.maxBandBps);
  const priceQueue = requireRealPublicKey(band.priceQueue, `${field}.priceQueue`);
  const priceFeedId = feedIdBytes(band.priceFeedId);
  const clockFeedId = feedIdBytes(band.clockFeedId);
  for (const [name, bytes] of [
    ["priceFeedId", priceFeedId],
    ["clockFeedId", clockFeedId],
  ] as const) {
    if (bytes.every((byte) => byte === 0)) {
      throw new PanguInputError(`${field}.${name} of all zeros is not a feed`);
    }
  }
  const maxPriceAgeSlots = requireWholeNumber(
    band.maxPriceAgeSlots,
    `${field}.maxPriceAgeSlots`,
    LIMITS.minPriceAgeSlots,
    LIMITS.maxPriceAgeSlots
  );
  const maxMarketAgeSecs = requireWholeNumber(
    band.maxMarketAgeSecs,
    `${field}.maxMarketAgeSecs`,
    LIMITS.minMarketAgeSecs,
    U32_MAX
  );
  const minOracles = requireWholeNumber(
    band.minOracles,
    `${field}.minOracles`,
    LIMITS.minOracles,
    U8_MAX
  );

  return {
    band_bps: bps,
    // Derived here rather than asked for: the quote account is a program address
    // over the queue and both feed ids, and the program derives the same one and
    // refuses anything else.
    price_account: canonicalQuoteAddress(priceQueue, [priceFeedId, clockFeedId]),
    price_queue: priceQueue,
    price_feed_id: Array.from(priceFeedId),
    clock_feed_id: Array.from(clockFeedId),
    max_price_age_slots: maxPriceAgeSlots,
    max_market_age_secs: maxMarketAgeSecs,
    min_oracles: minOracles,
  };
}

/**
 * Opens a sale: stores the rules for a mint and publishes the account list the
 * transfer hook will be called with.
 *
 * The pool must already exist and the signer must be its creator. The pool's
 * launch template is needed in every mode, because the program refuses a
 * template that collects fees in the sale token. Access mode 2 needs a
 * credential and a schema; a band needs both feeds and the token buyers pay in.
 * Every input that could never pass on chain is refused here, with the same
 * limits the program holds.
 *
 * Throws PanguInputError. Sends nothing.
 */
export function createSaleInstruction(input: CreateSaleInput): TransactionInstruction {
  const issuer = requireRealPublicKey(input.issuer, "issuer");
  const pool = requireRealPublicKey(input.pool, "pool");
  const mint = requireRealPublicKey(input.mint, "mint");

  const cap = requireBigint(input.cap, "cap");
  if (cap <= 0n) {
    throw new PanguInputError("cap must be above zero, the program refuses a zero cap");
  }
  if (cap > LIMITS.maxCap) {
    throw new PanguInputError("cap must fit in 64 bits");
  }

  const accessMode = requireWholeNumber(input.accessMode, "accessMode", 0, 2);
  const wantsCredential = accessMode === ACCESS_MODE.verifierCredential;

  let credential = PublicKey.default;
  let schema = PublicKey.default;
  if (wantsCredential) {
    if (input.credential === undefined || input.schema === undefined) {
      throw new PanguInputError(
        "access mode 2 needs both a credential and a schema, the program has nothing to check against without them"
      );
    }
    credential = requireRealPublicKey(input.credential, "credential");
    schema = requireRealPublicKey(input.schema, "schema");
  } else {
    const reason = "belongs to access mode 2, and the program refuses a sale that names it in any other mode";
    requireAbsent(input.credential, "credential", reason);
    requireAbsent(input.schema, "schema", reason);
  }

  const dbcConfig = requireRealPublicKey(input.dbcConfig, "dbcConfig");

  let band = NO_BAND;
  let quoteMint: PublicKey | null = null;
  if (input.band !== undefined && input.band !== null) {
    band = bandFields(input.band, "band");
    if (input.quoteMint === undefined) {
      throw new PanguInputError(
        "a band needs the quoteMint as well, because the program reads both mints' decimals at creation"
      );
    }
    quoteMint = requireRealPublicKey(input.quoteMint, "quoteMint");
  } else {
    requireAbsent(
      input.quoteMint,
      "quoteMint",
      "is only read by a sale with a price band, and the program refuses it otherwise"
    );
  }

  const keys: AccountMeta[] = [
    meta(issuer, true, true),
    meta(pool, false, false),
    meta(mint, false, false),
    wantsCredential ? meta(credential, false, false) : absentAccount(),
    wantsCredential ? meta(schema, false, false) : absentAccount(),
    meta(dbcConfig, false, false),
    quoteMint === null ? absentAccount() : meta(quoteMint, false, false),
    band.band_bps > 0 ? meta(band.price_queue, false, false) : absentAccount(),
    meta(saleRulesAddress(mint), false, true),
    meta(extraAccountListAddress(mint), false, true),
    meta(SystemProgram.programId, false, false),
  ];

  return build("create_sale", keys, {
    cap: new BN(cap.toString()),
    access_mode: accessMode,
    credential,
    schema,
    band,
  });
}

/**
 * Opens a wallet's own record, so a later buy has somewhere to count against.
 * A transfer hook cannot create accounts, which is why this comes first. Safe to
 * send twice.
 */
export function openBuyerRecordInstruction(
  input: OpenBuyerRecordInput
): TransactionInstruction {
  const wallet = requireRealPublicKey(input.wallet, "wallet");
  const mint = requireRealPublicKey(input.mint, "mint");
  return build(
    "open_buyer_record",
    [
      meta(wallet, true, true),
      meta(mint, false, false),
      meta(saleRulesAddress(mint), false, false),
      meta(buyerRecordAddress(mint, wallet), false, true),
      meta(SystemProgram.programId, false, false),
    ],
    {}
  );
}

/**
 * Puts a wallet on the issuer's approved list, in access mode 1. Creates the
 * record if the wallet never opened one. Only the issuer named in the rules can
 * send it, and it never resets what the wallet has already bought.
 */
export function approveBuyerInstruction(
  input: ApproveBuyerInput
): TransactionInstruction {
  const issuer = requireRealPublicKey(input.issuer, "issuer");
  const mint = requireRealPublicKey(input.mint, "mint");
  const wallet = requireRealPublicKey(input.wallet, "wallet");
  return build(
    "approve_buyer",
    [
      meta(issuer, true, true),
      meta(mint, false, false),
      meta(saleRulesAddress(mint), false, false),
      meta(buyerRecordAddress(mint, wallet), false, true),
      meta(SystemProgram.programId, false, false),
    ],
    { wallet }
  );
}

/**
 * Takes a wallet off the approved list. The wallet can still sell what it holds,
 * which is why the record is not closed.
 */
export function revokeBuyerInstruction(
  input: RevokeBuyerInput
): TransactionInstruction {
  const issuer = requireRealPublicKey(input.issuer, "issuer");
  const mint = requireRealPublicKey(input.mint, "mint");
  const wallet = requireRealPublicKey(input.wallet, "wallet");
  return build(
    "revoke_buyer",
    [
      meta(issuer, true, false),
      meta(mint, false, false),
      meta(saleRulesAddress(mint), false, false),
      meta(buyerRecordAddress(mint, wallet), false, true),
    ],
    { wallet }
  );
}

/**
 * Closes a wallet's record and returns the rent.
 *
 * A record with nothing left in it closes at any time, mid-sale included, since
 * it holds no count anybody could lose. A record that still counts tokens waits
 * for the sale to finish, which is the moment the mint stops naming Pangu as its
 * hook; until then the program answers SaleStillRunning. Reopening later is
 * safe, and in the issuer-list mode the wallet has to be approved again.
 */
export function closeBuyerRecordInstruction(
  input: CloseBuyerRecordInput
): TransactionInstruction {
  const wallet = requireRealPublicKey(input.wallet, "wallet");
  const mint = requireRealPublicKey(input.mint, "mint");
  return build(
    "close_buyer_record",
    [
      meta(wallet, true, true),
      meta(mint, false, false),
      meta(buyerRecordAddress(mint, wallet), false, true),
    ],
    {}
  );
}
