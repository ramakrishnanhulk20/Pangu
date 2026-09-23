import { SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import {
  ExtensionType,
  getExtensionData,
  getMetadataPointerState,
  unpackMint,
  type Mint,
} from "@solana/spl-token";
import { listSales, mintRunsPangu, type ListSalesOptions, type Sale } from "./accounts.js";
import { DBC_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants.js";
import { requirePublicKey } from "./inputs.js";
import { saleStanding } from "./standing.js";

/** A sale token's name, symbol and metadata link, as the mint itself carries them. */
export interface SaleTokenInfo {
  name: string;
  symbol: string;
  uri: string;
}

/** The update authority and the mint, each 32 bytes, come before the name. */
const METADATA_NAME_OFFSET = 64;

function readMint(mint: PublicKey, info: AccountInfo<Uint8Array> | null): Mint | null {
  if (info === null || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return null;
  }
  try {
    return unpackMint(mint, info as AccountInfo<Buffer>, TOKEN_2022_PROGRAM_ID);
  } catch {
    return null;
  }
}

/**
 * The name, symbol and link out of a Token-2022 metadata extension, or null
 * when the bytes do not hold exactly what the layout says they hold.
 *
 * The extension is three length-prefixed strings after two keys, followed by
 * extra fields this reader has no use for. Every length is checked against what
 * is left before it is read, and the text must be valid UTF-8.
 */
function decodeMetadata(mint: PublicKey, data: Uint8Array): SaleTokenInfo | null {
  if (data.length < METADATA_NAME_OFFSET) {
    return null;
  }
  const named = data.subarray(32, METADATA_NAME_OFFSET);
  if (!mint.toBytes().every((byte, index) => byte === named[index])) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const fields: string[] = [];
  let offset = METADATA_NAME_OFFSET;
  for (let field = 0; field < 3; field += 1) {
    if (offset + 4 > data.length) {
      return null;
    }
    const length = view.getUint32(offset, true);
    offset += 4;
    if (length > data.length - offset) {
      return null;
    }
    try {
      fields.push(utf8.decode(data.subarray(offset, offset + length)));
    } catch {
      return null;
    }
    offset += length;
  }
  const [name, symbol, uri] = fields as [string, string, string];
  return { name, symbol, uri };
}

/** The token info out of mint bytes already in hand. */
function tokenInfoFromMint(
  mint: PublicKey,
  info: AccountInfo<Uint8Array> | null
): SaleTokenInfo | null {
  const state = readMint(mint, info);
  if (state === null) {
    return null;
  }
  const pointer = getMetadataPointerState(state);
  if (pointer?.metadataAddress?.equals(mint) !== true) {
    return null;
  }
  const data = getExtensionData(ExtensionType.TokenMetadata, state.tlvData);
  return data === null ? null : decodeMetadata(mint, data);
}

/**
 * The sale token's name, symbol and metadata link.
 *
 * DBC writes these into the Token-2022 metadata extension on the mint itself,
 * with the mint's metadata pointer naming the mint, when the pool opens. Only
 * that shape is read: a pointer naming some other account means the copy on the
 * mint is not the one the token claims, so the answer is null rather than a
 * guess. Null too when the mint does not exist, is not a Token-2022 mint, or
 * carries no metadata.
 *
 * The text is whatever the issuer typed at launch and nothing checks it, so
 * show it as a label, never trust it as an identity: two sales can carry the
 * same name. The mint address is what identifies a sale.
 */
export async function saleTokenInfo(
  connection: Connection,
  mint: PublicKey
): Promise<SaleTokenInfo | null> {
  const key = requirePublicKey(mint, "mint");
  return tokenInfoFromMint(key, await connection.getAccountInfo(key));
}

/** One sale as a list page shows it. */
export interface SaleDirectoryEntry {
  mint: PublicKey;
  pool: PublicKey;
  /** From the mint's metadata. Null when the mint carries none this package reads. */
  name: string | null;
  symbol: string | null;
  /** True while the mint still names Pangu as its transfer hook, as `isSaleRunning`. */
  running: boolean;
  /**
   * True once the curve is full, read from DBC's own record on the pool. Null
   * when the pool the rules name cannot be read as the transfer hook pool
   * selling this mint.
   */
  graduated: boolean | null;
  /** True once the offering period has ended by the chain's clock. */
  offeringOver: boolean;
  hasBand: boolean;
  accessMode: number;
  quoteMint: PublicKey | null;
  endsAt: number | null;
  buyers: number;
  issuer: PublicKey;
  /** The full rules, with the token's decimals filled from the mint when the rules store none. */
  sale: Sale;
}

/**
 * The largest number of addresses one getMultipleAccountsInfo call takes. Source:
 * the Solana RPC reference for getMultipleAccounts.
 */
const ACCOUNTS_PER_CALL = 100;

/**
 * The parts of a DBC transfer hook pool this reads. Source: the
 * `transferHookPool` account and `poolState` type in the DBC SDK's IDL, offsets
 * counted from the start of the account; ARCHITECTURE.md, "Offsets inside the
 * pool account", agrees on base_mint.
 */
const HOOK_POOL_DISCRIMINATOR = Uint8Array.from([237, 219, 184, 23, 42, 189, 169, 35]);
const HOOK_POOL_SIZE = 424;
const POOL_BASE_MINT_OFFSET = 136;
/** Zero until the trade that fills the curve moves it on. It never moves back. */
const POOL_MIGRATION_PROGRESS_OFFSET = 308;

/** The Clock sysvar: slot, epoch start, epoch, leader schedule epoch, then Unix time. */
const CLOCK_UNIX_TIMESTAMP_OFFSET = 32;

async function readAccounts(
  connection: Connection,
  addresses: PublicKey[]
): Promise<(AccountInfo<Uint8Array> | null)[]> {
  const found: (AccountInfo<Uint8Array> | null)[] = [];
  for (let start = 0; start < addresses.length; start += ACCOUNTS_PER_CALL) {
    const chunk = addresses.slice(start, start + ACCOUNTS_PER_CALL);
    const infos = await connection.getMultipleAccountsInfo(chunk);
    if (infos.length !== chunk.length) {
      throw new Error(
        `asked the node for ${chunk.length} accounts and it answered with ${infos.length}`
      );
    }
    found.push(...infos);
  }
  return found;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** Null unless these bytes are a DBC transfer hook pool selling this mint. */
function poolGraduated(mint: PublicKey, info: AccountInfo<Uint8Array> | null): boolean | null {
  if (
    info === null ||
    !info.owner.equals(DBC_PROGRAM_ID) ||
    info.data.length !== HOOK_POOL_SIZE ||
    !sameBytes(info.data.subarray(0, 8), HOOK_POOL_DISCRIMINATOR) ||
    !sameBytes(
      info.data.subarray(POOL_BASE_MINT_OFFSET, POOL_BASE_MINT_OFFSET + 32),
      mint.toBytes()
    )
  ) {
    return null;
  }
  return info.data[POOL_MIGRATION_PROGRESS_OFFSET] !== 0;
}

/**
 * The chain's Unix time, the clock the hook judges the offering period by.
 * This machine's clock stands in only when the node returns no Clock, which a
 * real node never does.
 */
function chainNow(info: AccountInfo<Uint8Array> | null): number {
  if (info === null || info.data.length < CLOCK_UNIX_TIMESTAMP_OFFSET + 8) {
    return Math.floor(Date.now() / 1000);
  }
  const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
  return Number(view.getBigInt64(CLOCK_UNIX_TIMESTAMP_OFFSET, true));
}

function isRunning(mint: PublicKey, info: AccountInfo<Uint8Array> | null): boolean {
  try {
    return mintRunsPangu(mint, info);
  } catch {
    return false;
  }
}

/**
 * Every Pangu sale on the chain with what a list page shows: the token's name
 * and symbol, whether it is running, graduated or past its offering period,
 * and the headline rules.
 *
 * Reads are batched: one scan for the rules (see `listSales`, whose skipping
 * and `onSkipped` apply here unchanged), then every mint and pool plus the
 * Clock sysvar in calls of 100 addresses. Fifty sales cost three calls. The
 * scan and the batch are separate calls, so a sale that changes between them
 * is shown as of two nearby moments.
 *
 * Nothing about one sale can stop the others being listed: a mint that cannot
 * be read shows no name and not running, and a pool that cannot be read shows
 * `graduated` as null. Throws only when the node refuses a call.
 */
export async function saleDirectory(
  connection: Connection,
  options: ListSalesOptions = {}
): Promise<SaleDirectoryEntry[]> {
  const sales = await listSales(connection, options);
  const addresses = [SYSVAR_CLOCK_PUBKEY, ...sales.flatMap((sale) => [sale.mint, sale.pool])];
  const infos = await readAccounts(connection, addresses);
  const now = chainNow(infos[0] ?? null);

  return sales.map((listed, index) => {
    const mintInfo = infos[1 + index * 2] ?? null;
    const poolInfo = infos[2 + index * 2] ?? null;
    const decimals = listed.baseDecimals === 0 ? readMint(listed.mint, mintInfo)?.decimals : undefined;
    const sale = decimals === undefined ? listed : { ...listed, baseDecimals: decimals };
    const token = tokenInfoFromMint(sale.mint, mintInfo);
    return {
      mint: sale.mint,
      pool: sale.pool,
      name: token?.name ?? null,
      symbol: token?.symbol ?? null,
      running: isRunning(sale.mint, mintInfo),
      graduated: poolGraduated(sale.mint, poolInfo),
      offeringOver: saleStanding(sale, [], now).offeringOver,
      hasBand: sale.hasBand,
      accessMode: sale.accessMode,
      quoteMint: sale.quoteMint,
      endsAt: sale.endsAt,
      buyers: sale.buyers,
      issuer: sale.issuer,
      sale,
    };
  });
}
