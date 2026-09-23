// What the mainnet rehearsal's account writer and its runs must agree on.
//
// The rehearsal runs the mainnet build of Pangu on a local validator holding
// copies of mainnet's real programs and tokens, started by
// scripts/wsl/mainnet-rehearsal.sh. A local validator can only be handed
// accounts at genesis, so the Apple price the ceilings read and the USDC the
// buyers pay with are written before the chain starts, by
// rehearsal-accounts.ts, and never rewritten. The curves are pure functions of
// the numbers below, which is how the writer can place Apple's price where the
// sales need it before any sale exists.
//
// Throwaway wallets live in ~/pangu-rehearsal, outside the repository, so no key
// can reach a tracked file. Nothing here ships.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  type Signer,
} from "@solana/web3.js";
import {
  ActivationType,
  BaseFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  TokenAuthorityOption,
  TokenDecimal,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { panguErrorFromLogs } from "../src/index.js";

export const RPC_URL = "http://127.0.0.1:8899";

/** Where the writer leaves the accounts, the wallets and the manifest. */
export const REHEARSAL_DIR = join(homedir(), "pangu-rehearsal");
export const ACCOUNTS_DIR = join(REHEARSAL_DIR, "accounts");
const MANIFEST_FILE = join(ACCOUNTS_DIR, "rehearsal.json");

/** Where fork-validator.sh leaves the wallets it hands AAPLx and the demo dollar authority. */
export const FORK_ACCOUNTS_DIR = join(homedir(), "pangu-fork-accounts");

/** Circle's USDC on mainnet, the one dollar the mainnet build lists. */
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const USDC_DECIMALS = 6;
/** What every rehearsal wallet is handed at genesis, in whole USDC. */
export const USDC_PER_WALLET = 200_000n;
export const USDC_WALLETS = 10;

/** AAPLx, the Token-2022 stock token, and the DBC badge that lets it be a paying token. */
export const AAPLX_MINT = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
export const AAPLX_TOKEN_BADGE = new PublicKey("8VeVZe3Zxfpax2qQUp7i68FCLspLYErm2FJChc5NDuVn");
export const AAPLX_DECIMALS = 8;

/** The demo dollar, on the devnet build's list only. band-accounts.ts plants it. */
export const DEMO_DOLLAR_MINT = new PublicKey("2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5");

/** Pyth's Equity.US.AAPL/USD feed, the real id a mainnet sale would name. */
export const APPLE_FEED_ID = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
/** Pangu's own shard, the account the price refresher writes on every network. */
export const APPLE_SHARD = 7_700;
/** Pyth publishes US equities at this exponent. */
export const APPLE_EXPONENT = -5;

/** Five percent over Apple's price, the ceiling the rehearsal's USDC sales carry. */
export const BAND_BPS = 500;
export const MAX_CONF_BPS = 100;
export const MAX_PRICE_AGE_SECS = 3_600;
/** The offering period the USDC sales run for. */
export const OFFERING_SECS = 14 * 24 * 60 * 60;
/** The ceiling sits this many times above the crossing curve's opening price. */
export const CEILING_OVER_START = 2n;

/**
 * Two curves paid in USDC under the same Apple price. A price written at genesis
 * never moves, so the ceiling cannot be lifted partway through one sale, and a
 * sale whose ceiling binds can never graduate. So one curve climbs through the
 * ceiling and shows the refusal, and the other finishes below it and graduates,
 * the same two-pool arrangement the program's own price-band fork test uses.
 */
export const USDC_CURVES = {
  crossing: { supply: 10_000_000, threshold: 500_000 },
  graduating: { supply: 1_000_000_000, threshold: 100_000 },
} as const;
export type UsdcCurveName = keyof typeof USDC_CURVES;

/** The paying side of the AAPLx sale, in whole AAPLx. */
export const AAPLX_THRESHOLD = 100;

/** Every rehearsal curve: only the supply, the paying decimals and the threshold change. */
export function curveFor(
  supply: number,
  quoteDecimal: TokenDecimal,
  threshold: number
): never {
  return {
    token: {
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: quoteDecimal,
      tokenAuthorityOption: TokenAuthorityOption.CreatorUpdateAuthority,
      totalTokenSupply: supply,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 25,
          endingFeeBps: 25,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Disabled,
        poolFeeBps: 25,
        baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
      },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 100,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold: threshold,
  } as never;
}

export function usdcCurve(name: UsdcCurveName): never {
  const shape = USDC_CURVES[name];
  return curveFor(shape.supply, TokenDecimal.SIX, shape.threshold);
}

export function aaplxCurve(): never {
  return curveFor(1_000_000_000, TokenDecimal.EIGHT, AAPLX_THRESHOLD);
}

export interface RehearsalManifest {
  /** The Apple price account Pangu's shard produces for the real feed id. */
  priceAccount: string;
  shard: number;
  /** The whole number written into the account, at APPLE_EXPONENT. */
  rawPrice: string;
  /** Apple's price in dollars scaled by 1e18, as the program reads it back. */
  stockPrice: string;
  /** Unix second the account says the price was published. */
  publishTime: number;
  /** The file names of the wallets handed USDC, inside ACCOUNTS_DIR. */
  usdcWallets: string[];
  /** Each USDC curve's opening and graduation price, dollars scaled by 1e18. */
  curves: Record<UsdcCurveName, { start: string; migration: string }>;
}

export function writeManifest(manifest: RehearsalManifest): void {
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

export function readManifest(): RehearsalManifest {
  return JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as RehearsalManifest;
}

export function loadWallet(directory: string, name: string): Keypair {
  const file = join(directory, name.endsWith(".json") ? name : `${name}.json`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
}

export function loadOrCreateWallet(directory: string, name: string): Keypair {
  const file = join(directory, `${name}.json`);
  if (existsSync(file)) {
    return loadWallet(directory, name);
  }
  const keypair = Keypair.generate();
  writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  return keypair;
}

export const connection = new Connection(RPC_URL, "confirmed");

export interface Measurement {
  action: string;
  bytes: number;
  units: number;
  lamports: number;
}
export const measurements: Measurement[] = [];

export function step(name: string): void {
  console.log(`\n== ${name}`);
}

export async function airdrop(address: PublicKey, sol: number): Promise<void> {
  const signature = await connection.requestAirdrop(address, sol * LAMPORTS_PER_SOL);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
}

async function logsOf(signature: string): Promise<string[]> {
  const detail = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 1,
  });
  return detail?.meta?.logMessages ?? [];
}

function measure(transaction: Transaction): number {
  const message = transaction.compileMessage();
  return message.serialize().length + 1 + 64 * message.header.numRequiredSignatures;
}

/** Sends a transaction that must land, and records its size, compute and fee. */
export async function send(
  action: string,
  transaction: Transaction,
  signers: Signer[]
): Promise<string> {
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  transaction.feePayer = transaction.feePayer ?? signers[0]!.publicKey;
  const bytes = measure(transaction);
  transaction.sign(...signers);

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const latest = await connection.getLatestBlockhash();
  const result = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  if (result.value.err !== null) {
    throw new Error(
      `${action} failed: ${JSON.stringify(result.value.err)}\n${(await logsOf(signature)).join("\n")}`
    );
  }
  const detail = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 1,
  });
  const units = detail?.meta?.computeUnitsConsumed ?? 0;
  const lamports = detail?.meta?.fee ?? 0;
  measurements.push({ action, bytes, units, lamports });
  console.log(`   ${action}: ${bytes} bytes, ${units} compute units, fee ${lamports} lamports`);
  return signature;
}

/**
 * Sends something that must be refused and hands back the logs it was refused
 * with. Throws when it lands.
 */
export async function refusedLogs(
  action: string,
  transaction: Transaction,
  signers: Signer[]
): Promise<string[]> {
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  transaction.feePayer = transaction.feePayer ?? signers[0]!.publicKey;
  transaction.sign(...signers);

  try {
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    const latest = await connection.getLatestBlockhash();
    const result = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (result.value.err === null) {
      throw new Error(`${action} was expected to fail, and it went through`);
    }
    return await logsOf(signature);
  } catch (error) {
    const carried = (error as { logs?: string[] | null }).logs ?? undefined;
    if (carried !== undefined && carried !== null) {
      return carried;
    }
    const getLogs = (error as { getLogs?: (c: Connection) => Promise<string[]> }).getLogs;
    const logs = typeof getLogs === "function" ? ((await getLogs(connection)) ?? []) : [];
    if (logs.length === 0) {
      throw error;
    }
    return logs;
  }
}

/** Sends something Pangu must refuse, and reports Pangu's own error name. */
export async function refusal(
  action: string,
  transaction: Transaction,
  signers: Signer[]
): Promise<string> {
  const logs = await refusedLogs(action, transaction, signers);
  const found = panguErrorFromLogs(logs);
  if (found === null) {
    throw new Error(`${action} failed, but not with a Pangu error:\n${logs.join("\n")}`);
  }
  console.log(`   ${action}: refused with ${found.name}`);
  return found.name;
}

/** A token account's balance, read straight from its bytes. Zero when there is none. */
export async function tokenBalance(account: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(account);
  return info === null ? 0n : info.data.readBigUInt64LE(64);
}

/** The chain's own Unix time, the clock the offering period is judged by. */
export async function chainNow(): Promise<number> {
  const slot = await connection.getSlot("confirmed");
  const time = await connection.getBlockTime(slot);
  return time ?? Math.floor(Date.now() / 1000);
}

export function printMeasurements(title: string): void {
  console.log(`\n== ${title}`);
  console.log("| Action | Bytes | Compute units | Fee (lamports) |");
  console.log("|---|---|---|---|");
  for (const entry of measurements) {
    console.log(`| ${entry.action} | ${entry.bytes} | ${entry.units} | ${entry.lamports} |`);
  }
}
