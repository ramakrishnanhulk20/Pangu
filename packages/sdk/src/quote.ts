import type { Connection, PublicKey } from "@solana/web3.js";
import { PublicKey as Web3PublicKey } from "@solana/web3.js";
import type { Sale } from "./accounts.js";
import { DOLLAR_SCALE, dollars } from "./band.js";
import { SWITCHBOARD_QUOTE_PROGRAM_ID } from "./constants.js";
import type { PanguErrorName } from "./errors.js";
import { explainPanguError } from "./errors.js";
import { PanguInputError } from "./inputs.js";

/** One feed's numbers inside a stored quote. */
export interface QuoteFeed {
  /** Lowercase hex, no prefix, matching Sale.priceFeedId. */
  id: string;
  /** Scaled by 1e18, the way Switchboard publishes every value. */
  value: bigint;
  /** The quorum the feed itself asks for. */
  minOracleSamples: number;
}

/** What one Switchboard quote account carries. */
export interface QuoteReading {
  /** The queue recorded inside the account, not the one the caller passed. */
  queue: PublicKey;
  /** The Solana slot the oracles signed for. */
  slot: bigint;
  signatures: number;
  feeds: QuoteFeed[];
}

/** A sale's live price, and whether a buy could use it right now. */
export interface PriceReading {
  /** The one account this sale's queue and feeds can write to. */
  address: PublicKey;
  /** The stock price in dollars, scaled by 1e18. Zero when there is no quote. */
  price: bigint;
  /** The same price as an ordinary number, for display. */
  priceDollars: number;
  /** Unix seconds of the last real market trade, or zero when unknown. */
  lastTradeUnix: number;
  /** How many slots old the quote is, counted against the chain's current slot. */
  ageSlots: number;
  signatures: number;
  /** The slot the oracles signed for. */
  slot: bigint;
  usable: boolean;
  /** Why it cannot be used, as the program's own refusal. Null when usable. */
  error: PanguErrorName | null;
  /** One sentence for a buyer. Null when usable. */
  reason: string | null;
}

const QUOTE_DISCRIMINATOR = "SBOracle";
const TAIL_DISCRIMINATOR = "SBOD";
const PAYLOAD_LEN_OFFSET = 40;
const PAYLOAD_OFFSET = 42;
const OFFSETS_RECORD_LEN = 14;
const MESSAGE_OFFSET_FIELD = 8;
const QUOTE_HEADER_LEN = 32;
const FEED_INFO_LEN = 49;
const TAIL_FIXED_LEN = 13;
const MAX_SIGNATURES = 8;
const MAX_FEEDS = 8;
/** price.rs CLOCK_FUTURE_TOLERANCE_SECS: the oracle's clock is not Solana's. */
const CLOCK_FUTURE_TOLERANCE_SECS = 60;

function slice(data: Uint8Array, start: number, length: number): Uint8Array {
  const end = start + length;
  if (start < 0 || length < 0 || end > data.length) {
    throw new PanguInputError(
      "these bytes are not a Switchboard quote: they end before the layout does"
    );
  }
  return data.subarray(start, end);
}

function text(data: Uint8Array): string {
  return Array.from(data, (byte) => String.fromCharCode(byte)).join("");
}

function hex(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function u16(data: Uint8Array, offset: number): number {
  const bytes = slice(data, offset, 2);
  return (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
}

function u64(data: Uint8Array, offset: number): bigint {
  const bytes = slice(data, offset, 8);
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(bytes[i] ?? 0);
  }
  return value;
}

function i128(data: Uint8Array, offset: number): bigint {
  const bytes = slice(data, offset, 16);
  let value = 0n;
  for (let i = 15; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(bytes[i] ?? 0);
  }
  return value >= 1n << 127n ? value - (1n << 128n) : value;
}

/**
 * Reads a stored Switchboard quote account without the Switchboard package.
 *
 * Every offset is the one `programs/pangu/src/price.rs` reads on chain, so what
 * the app shows and what the hook decides on come out of the same map. Safe in
 * a browser: it is arithmetic over bytes the caller already has.
 *
 * Throws PanguInputError for anything that is not a well formed quote.
 */
export function decodeQuote(data: Uint8Array): QuoteReading {
  const header = slice(data, 0, PAYLOAD_OFFSET);
  if (text(slice(header, 0, 8)) !== QUOTE_DISCRIMINATOR) {
    throw new PanguInputError("these bytes are not a Switchboard quote account");
  }
  const queue = new Web3PublicKey(slice(header, 8, 32));

  const payload = slice(data, PAYLOAD_OFFSET, u16(header, PAYLOAD_LEN_OFFSET));
  const signatures = payload[0] ?? 0;
  if (signatures < 1 || signatures > MAX_SIGNATURES) {
    throw new PanguInputError(
      `a quote carries one to ${MAX_SIGNATURES} signatures, this one claims ${signatures}`
    );
  }

  // The first signature record carries the message every signature covers.
  const record = slice(payload, 2, OFFSETS_RECORD_LEN);
  const message = slice(
    payload,
    u16(record, MESSAGE_OFFSET_FIELD),
    u16(record, MESSAGE_OFFSET_FIELD + 2)
  );
  if (message.length < QUOTE_HEADER_LEN) {
    throw new PanguInputError("the quote's signed message is too short to hold a feed");
  }
  const feedBytes = message.length - QUOTE_HEADER_LEN;
  if (feedBytes % FEED_INFO_LEN !== 0) {
    throw new PanguInputError("the quote's feed records are not whole");
  }
  const feedCount = feedBytes / FEED_INFO_LEN;
  if (feedCount < 1 || feedCount > MAX_FEEDS) {
    throw new PanguInputError(`a quote carries one to ${MAX_FEEDS} feeds`);
  }

  // The tail is counted back from the end of the payload, because the number of
  // signature records in front of it varies.
  const tail = slice(payload, payload.length - TAIL_FIXED_LEN, TAIL_FIXED_LEN);
  if (text(slice(tail, 9, 4)) !== TAIL_DISCRIMINATOR) {
    throw new PanguInputError("the quote does not end the way Switchboard ends one");
  }

  const feeds: QuoteFeed[] = [];
  for (let index = 0; index < feedCount; index += 1) {
    const start = QUOTE_HEADER_LEN + index * FEED_INFO_LEN;
    const info = slice(message, start, FEED_INFO_LEN);
    feeds.push({
      id: hex(slice(info, 0, 32)),
      value: i128(info, 32),
      minOracleSamples: info[48] ?? 0,
    });
  }

  return { queue, slot: u64(tail, 0), signatures, feeds };
}

function unusable(
  address: PublicKey,
  error: PanguErrorName,
  partial: Partial<PriceReading> = {}
): PriceReading {
  return {
    address,
    price: 0n,
    priceDollars: 0,
    lastTradeUnix: 0,
    ageSlots: 0,
    signatures: 0,
    slot: 0n,
    usable: false,
    error,
    reason: explainPanguError(error),
    ...partial,
  };
}

/**
 * The live stock price a banded sale checks against, read straight off the
 * chain, plus whether a buy could use it this moment.
 *
 * Runs the same four rules the hook runs: the account must be the quote
 * program's, it must carry both of this sale's feeds, it must carry at least
 * the sale's quorum of oracle signatures, it must be fresh in slots, and the
 * real market must have traded recently enough. Any doubt comes back as
 * `usable: false` with the program's own error name, because that is what the
 * buy would hit.
 *
 * Does not cover the oracle signature check or the slot hash check. Both are
 * the hook's, and neither can be redone from the account's bytes alone.
 *
 * Throws PanguInputError when the sale has no price band.
 */
export async function readPrice(
  connection: Connection,
  sale: Sale
): Promise<PriceReading> {
  if (sale === null || sale === undefined || !sale.hasBand) {
    throw new PanguInputError(
      "this sale has no price band, so there is no price account to read"
    );
  }
  const address = sale.priceAccount;

  const [info, currentSlot] = await Promise.all([
    connection.getAccountInfo(address),
    connection.getSlot(),
  ]);
  if (info === null) {
    return unusable(address, "PriceStale");
  }
  if (!info.owner.equals(SWITCHBOARD_QUOTE_PROGRAM_ID)) {
    return unusable(address, "WrongPriceAccount");
  }

  let quote: QuoteReading;
  try {
    quote = decodeQuote(info.data);
  } catch {
    return unusable(address, "WrongPriceAccount");
  }

  const price = quote.feeds.find((feed) => feed.id === sale.priceFeedId);
  const clock = quote.feeds.find((feed) => feed.id === sale.clockFeedId);
  if (price === undefined || clock === undefined || !quote.queue.equals(sale.priceQueue)) {
    return unusable(address, "WrongPriceAccount");
  }

  const lastTradeUnix = Number(clock.value / DOLLAR_SCALE);
  const ageSlots = currentSlot - Number(quote.slot);
  const reading: PriceReading = {
    address,
    price: price.value,
    priceDollars: dollars(price.value),
    lastTradeUnix,
    ageSlots,
    signatures: quote.signatures,
    slot: quote.slot,
    usable: true,
    error: null,
    reason: null,
  };

  const refuse = (error: PanguErrorName): PriceReading => ({
    ...reading,
    usable: false,
    error,
    reason: explainPanguError(error),
  });

  if (
    quote.signatures < sale.minOracles ||
    quote.signatures < price.minOracleSamples ||
    quote.signatures < clock.minOracleSamples
  ) {
    return refuse("PriceNotEnoughOracles");
  }
  if (price.value <= 0n || ageSlots < 0 || ageSlots > sale.maxPriceAgeSlots) {
    return refuse("PriceStale");
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    clock.value <= 0n ||
    lastTradeUnix > now + CLOCK_FUTURE_TOLERANCE_SECS ||
    now - lastTradeUnix > sale.maxMarketAgeSecs
  ) {
    return refuse("MarketClosed");
  }

  return reading;
}
