import * as fs from "fs";
import * as path from "path";
import { assert } from "chai";
import { AnchorProvider, BN, Program } from "@anchor-lang/core";
import {
  AccountMeta,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ExtensionType,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeAccount3Instruction,
  createInitializeImmutableOwnerInstruction,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
  createUpdateTransferHookInstruction,
  getAccountLen,
  getAssociatedTokenAddressSync,
  getMintLen,
} from "@solana/spl-token";
import {
  BanksClient,
  BanksTransactionMeta,
  BanksTransactionResultWithMeta,
  Clock,
  ProgramTestContext,
  start,
} from "solana-bankrun";
import {
  PriceUpdateSpec,
  RECEIVER_PROGRAM_ID,
  encodePriceUpdate,
} from "./quote";

export const PROGRAM_ID = new PublicKey(
  "4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG"
);
export const DBC_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
);
export const SAS_PROGRAM_ID = new PublicKey(
  "22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG"
);
export const CREDENTIAL_DISCRIMINATOR = 0;
export const SCHEMA_DISCRIMINATOR = 1;
export const ATTESTATION_DISCRIMINATOR = 2;
export const HOOK_POOL_DISCRIMINATOR = Buffer.from([
  237, 219, 184, 23, 42, 189, 169, 35,
]);
export const HOOK_POOL_LEN = 424;
export const HOOK_CONFIG_DISCRIMINATOR = Buffer.from([
  40, 220, 194, 251, 41, 199, 123, 253,
]);
export const HOOK_CONFIG_LEN = 1128;
/** Where DBC's launch template carries `collect_fee_mode`, worked out in docs/measurements/review-fixes.md. */
export const CONFIG_COLLECT_FEE_MODE_OFFSET = 232;
export const COLLECT_FEE_MODE_QUOTE_TOKEN = 0;
export const COLLECT_FEE_MODE_OUTPUT_TOKEN = 1;
export const POOL_CONFIG_OFFSET = 72;
export const POOL_SQRT_PRICE_OFFSET = 280;
export const DECIMALS = 6;
export const ACCESS_OPEN = 0;
export const ACCESS_ISSUER_LIST = 1;
export const ACCESS_VERIFIER_CREDENTIAL = 2;

/** DBC's Q64.64 square root of a one to one raw price. */
export const SQRT_PRICE_ONE = 1n << 64n;

export const ZERO_FEED = Array.from({ length: 32 }, () => 0);
const WALLET_FUNDING = 1_000_000_000_000;

/** What a sale with no price band stores and passes. */
export const NO_BAND = {
  bandBps: 0,
  priceAccount: PublicKey.default,
  priceFeedId: ZERO_FEED,
  priceShard: 0,
  maxPriceAgeSecs: 0,
  maxConfBps: 0,
};

export interface BandArgs {
  bandBps?: number;
  priceAccount?: PublicKey;
  priceFeedId?: number[];
  priceShard?: number;
  maxPriceAgeSecs?: number;
  maxConfBps?: number;
}

const idlPath = path.join(__dirname, "..", "target", "idl", "pangu.json");
const deployDir = path.join(__dirname, "..", "target", "deploy");

export function saleRulesPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sale"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function buyerRecordPda(mint: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("buyer"), mint.toBuffer(), wallet.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function extraMetasPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function credentialPda(authority: PublicKey, name: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("credential"), authority.toBuffer(), Buffer.from(name, "utf8")],
    SAS_PROGRAM_ID
  )[0];
}

export function schemaPda(credential: PublicKey, name: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("schema"),
      credential.toBuffer(),
      Buffer.from(name, "utf8"),
      Buffer.from([1]),
    ],
    SAS_PROGRAM_ID
  )[0];
}

export function attestationPda(
  credential: PublicKey,
  schema: PublicKey,
  nonce: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("attestation"),
      credential.toBuffer(),
      schema.toBuffer(),
      nonce.toBuffer(),
    ],
    SAS_PROGRAM_ID
  )[0];
}

export function dbcVaultPda(mint: PublicKey, pool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), mint.toBuffer(), pool.toBuffer()],
    DBC_PROGRAM_ID
  )[0];
}

/** A read-only Connection backed by bankrun, enough for the SPL and Anchor clients. */
function connectionFor(client: BanksClient): Connection {
  const read = async (address: PublicKey) => {
    const account = await client.getAccount(address);
    if (account === null) {
      return null;
    }
    return {
      data: Buffer.from(account.data),
      executable: account.executable,
      lamports: Number(account.lamports),
      owner: account.owner,
      rentEpoch: Number(account.rentEpoch ?? 0),
    };
  };
  return {
    getAccountInfo: read,
    getAccountInfoAndContext: async (address: PublicKey) => ({
      context: { slot: 0 },
      value: await read(address),
    }),
  } as unknown as Connection;
}

let shared: ProgramTestContext | null = null;

/**
 * One runtime for the whole suite.
 *
 * Starting a runtime costs about a second, and tests stay independent anyway
 * because every sale gets a fresh mint: a sale's rules, records and vault all hang
 * off that mint's address.
 */
async function context(): Promise<ProgramTestContext> {
  if (shared === null) {
    process.env.BPF_OUT_DIR = deployDir;
    shared = await start([{ name: "pangu", programId: PROGRAM_ID }], []);
  }
  return shared;
}

export interface Env {
  ctx: ProgramTestContext;
  client: BanksClient;
  /** The IDL is loaded at run time, so the client is untyped on purpose. */
  program: any;
  payer: Keypair;
  issuer: Keypair;
  poolAuthority: Keypair;
  mint: PublicKey;
  baseDecimals: number;
  pool: PublicKey;
  vault: PublicKey;
  rules: PublicKey;
  extraMetas: PublicKey;
  /** The DBC launch template the stand-in pool names. */
  poolConfig: PublicKey;
  /** The paying token that template was given, when the test asked for one. */
  quoteMint: PublicKey | null;
  quoteDecimals: number;
  /** True when the test asked for a mint that can still be minted. */
  keepsMintAuthority: boolean;
}

export interface EnvOptions {
  /** Transfer-hook program written into the mint. Defaults to Pangu. */
  hookProgram?: PublicKey;
  /** Owner written on the fake pool account. Defaults to DBC. */
  poolOwner?: PublicKey;
  /** Discriminator written on the fake pool account. */
  poolDiscriminator?: Buffer;
  /** Base mint written on the fake pool account. Defaults to the real one. */
  poolBaseMint?: PublicKey;
  /** Base vault written on the fake pool account. Defaults to DBC's PDA. */
  poolBaseVault?: PublicKey;
  /** Pool creator written on the fake pool account. Defaults to the issuer. */
  poolCreator?: PublicKey;
  /** Launch template written on the fake pool account. Defaults to a fresh one. */
  poolConfig?: PublicKey;
  /** Curve price written on the fake pool account. Defaults to one to one. */
  poolSqrtPrice?: bigint;
  /** Decimals of the sale token. Defaults to six. */
  baseDecimals?: number;
  /**
   * When set, a paying-token mint with these decimals is created and named by the
   * DBC launch template at the pool's config address. A price band cannot be
   * opened without both.
   */
  quoteDecimals?: number;
  /** Fee side written into the launch template. Defaults to the paying token. */
  collectFeeMode?: number;
  /**
   * Leaves the mint authority alive. DBC revokes it at pool creation, and
   * `create_sale` refuses a mint that still has one, so this is for that test.
   */
  keepMintAuthority?: boolean;
}

/**
 * Builds a sale token, a stand-in DBC hook pool and its vault, and stops short of
 * calling `create_sale` so a test can vary the arguments.
 */
export async function setupEnv(options: EnvOptions = {}): Promise<Env> {
  const ctx = await context();
  const client = ctx.banksClient;

  const payer = Keypair.generate();
  const issuer = Keypair.generate();
  const poolAuthority = Keypair.generate();
  const base: Env = {
    ctx,
    client,
    program: null,
    payer,
    issuer,
    poolAuthority,
    mint: PublicKey.default,
    baseDecimals: options.baseDecimals ?? DECIMALS,
    pool: PublicKey.default,
    vault: PublicKey.default,
    rules: PublicKey.default,
    extraMetas: PublicKey.default,
    poolConfig: options.poolConfig ?? Keypair.generate().publicKey,
    quoteMint: null,
    quoteDecimals: options.quoteDecimals ?? 0,
    keepsMintAuthority: true,
  };
  for (const key of [payer, issuer, poolAuthority]) {
    fund(base, key.publicKey);
  }

  base.program = new Program(
    JSON.parse(fs.readFileSync(idlPath, "utf8")),
    new AnchorProvider(
      connectionFor(client),
      {
        publicKey: payer.publicKey,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any) => txs,
      } as any,
      { commitment: "processed" }
    )
  );

  const mint = await createHookMint(
    base,
    options.hookProgram ?? PROGRAM_ID,
    base.baseDecimals
  );
  const pool = Keypair.generate().publicKey;
  const vault = dbcVaultPda(mint, pool);

  const poolData = Buffer.alloc(HOOK_POOL_LEN);
  (options.poolDiscriminator ?? HOOK_POOL_DISCRIMINATOR).copy(poolData, 0);
  base.poolConfig.toBuffer().copy(poolData, POOL_CONFIG_OFFSET);
  (options.poolCreator ?? issuer.publicKey).toBuffer().copy(poolData, 104);
  (options.poolBaseMint ?? mint).toBuffer().copy(poolData, 136);
  (options.poolBaseVault ?? vault).toBuffer().copy(poolData, 168);
  writeU128LE(
    poolData,
    POOL_SQRT_PRICE_OFFSET,
    options.poolSqrtPrice ?? SQRT_PRICE_ONE
  );
  ctx.setAccount(pool, {
    lamports: 10_000_000,
    data: poolData,
    owner: options.poolOwner ?? DBC_PROGRAM_ID,
    executable: false,
    rentEpoch: 0,
  });

  base.mint = mint;
  base.pool = pool;
  base.vault = vault;
  base.rules = saleRulesPda(mint);
  base.extraMetas = extraMetasPda(mint);

  if (options.quoteDecimals !== undefined) {
    base.quoteMint = await createPlainMint(base, options.quoteDecimals);
  }
  // Every sale reads the template now, not only a banded one, so it is always there.
  placeDbcConfig(
    base,
    base.poolConfig,
    base.quoteMint ?? PublicKey.default,
    options.collectFeeMode
  );

  await placeVault(base, poolAuthority.publicKey);
  // DBC mints the whole supply into the vault at pool creation and then drops the
  // mint authority, so this is the state a real sale is opened in.
  base.keepsMintAuthority = options.keepMintAuthority ?? false;
  if (!base.keepsMintAuthority) {
    await writeMintAuthority(base, null);
  }
  return base;
}

/**
 * Sets or clears the mint authority by writing the mint account.
 *
 * The bytes at the front of a mint are a four byte "is there one" tag and then the
 * key. Writing them directly is how a test can hand the authority back for a single
 * `mint_to` and take it away again, which no instruction can do once it is gone.
 */
async function writeMintAuthority(env: Env, authority: PublicKey | null) {
  const account = await env.client.getAccount(env.mint);
  assert.isNotNull(account, "the mint account is missing");
  const data = Buffer.from(account!.data);
  data.writeUInt32LE(authority === null ? 0 : 1, 0);
  (authority ?? PublicKey.default).toBuffer().copy(data, 4);
  env.ctx.setAccount(env.mint, {
    lamports: Number(account!.lamports),
    data,
    owner: account!.owner,
    executable: account!.executable,
    rentEpoch: 0,
  });
}

/**
 * Puts a DBC launch template at an address, carrying the paying token it names and
 * the side of a trade the pool takes its fees from.
 */
export function placeDbcConfig(
  env: Env,
  config: PublicKey,
  quoteMint: PublicKey,
  collectFeeMode: number = COLLECT_FEE_MODE_QUOTE_TOKEN
) {
  const data = Buffer.alloc(HOOK_CONFIG_LEN);
  HOOK_CONFIG_DISCRIMINATOR.copy(data, 0);
  quoteMint.toBuffer().copy(data, 8);
  data.writeUInt8(collectFeeMode, CONFIG_COLLECT_FEE_MODE_OFFSET);
  env.ctx.setAccount(config, {
    lamports: 10_000_000,
    data,
    owner: DBC_PROGRAM_ID,
    executable: false,
    rentEpoch: 0,
  });
}

/** Moves the stand-in pool's curve price, as a real swap would. */
export async function setPoolSqrtPrice(env: Env, sqrtPrice: bigint) {
  const pool = await env.client.getAccount(env.pool);
  assert.isNotNull(pool, "the pool account is missing");
  const data = Buffer.from(pool!.data);
  writeU128LE(data, POOL_SQRT_PRICE_OFFSET, sqrtPrice);
  env.ctx.setAccount(env.pool, {
    lamports: Number(pool!.lamports),
    data,
    owner: pool!.owner,
    executable: pool!.executable,
    rentEpoch: 0,
  });
}

/**
 * Writes a Pyth price feed account, owned by the receiver program unless told
 * otherwise.
 *
 * On a real chain only Pyth's receiver can write one of these, and it does so
 * only after checking the guardians' signatures. Writing them here is the only
 * way to aim a stale, short, partly verified or nonsense price at the hook.
 */
export function writePriceUpdate(
  env: Env,
  address: PublicKey,
  spec: PriceUpdateSpec,
  owner: PublicKey = RECEIVER_PROGRAM_ID
) {
  env.ctx.setAccount(address, {
    lamports: 1_823_520,
    data: encodePriceUpdate(spec),
    owner,
    executable: false,
    rentEpoch: 0,
  });
}

/** Moves the runtime's clock, which is what makes a price fresh or stale. */
export async function setClock(
  env: Env,
  slot: bigint,
  unixTimestamp: bigint
) {
  const current = await env.client.getClock();
  env.ctx.setClock(
    new Clock(
      slot,
      current.epochStartTimestamp,
      current.epoch,
      current.leaderScheduleEpoch,
      unixTimestamp
    )
  );
}

function writeU128LE(buffer: Buffer, offset: number, value: bigint) {
  buffer.writeBigUInt64LE(value & 0xffffffffffffffffn, offset);
  buffer.writeBigUInt64LE((value >> 64n) & 0xffffffffffffffffn, offset + 8);
}

export interface SaleOptions extends EnvOptions {
  cap?: bigint;
  accessMode?: number;
  /** Tokens minted into the pool vault so buys have something to move. */
  vaultSupply?: bigint;
}

/** `setupEnv` plus a created sale and a funded vault. */
export async function setupSale(options: SaleOptions = {}): Promise<Env> {
  const env = await setupEnv(options);
  mustSucceed(
    await sendCreateSale(env, {
      cap: options.cap ?? 1_000n,
      accessMode: options.accessMode ?? ACCESS_OPEN,
    })
  );
  await mintTokens(env, env.vault, options.vaultSupply ?? 1_000_000n);
  return env;
}

export interface CreateSaleArgs {
  cap?: bigint;
  accessMode?: number;
  credential?: PublicKey;
  schema?: PublicKey;
  /** Overrides which account is passed for the credential. Null means none. */
  credentialAccount?: PublicKey | null;
  /** Overrides which account is passed for the schema. Null means none. */
  schemaAccount?: PublicKey | null;
  band?: BandArgs;
  /** Overrides which account is passed for the launch template. Null means none. */
  dbcConfigAccount?: PublicKey | null;
  /** Overrides which account is passed for the paying token. Null means none. */
  quoteMintAccount?: PublicKey | null;
  signer?: Keypair;
}

export function bandArgs(args: BandArgs = {}) {
  return {
    bandBps: args.bandBps ?? 0,
    priceAccount: args.priceAccount ?? PublicKey.default,
    priceFeedId: args.priceFeedId ?? ZERO_FEED,
    priceShard: args.priceShard ?? 0,
    maxPriceAgeSecs: args.maxPriceAgeSecs ?? 0,
    maxConfBps: args.maxConfBps ?? 0,
  };
}

export async function sendCreateSale(env: Env, args: CreateSaleArgs = {}) {
  const signer = args.signer ?? env.issuer;
  const credential = args.credential ?? PublicKey.default;
  const schema = args.schema ?? PublicKey.default;
  const band = bandArgs(args.band);
  // A sale that names a credential or a band passes the matching accounts,
  // unless a test asks for something else on purpose.
  const named = !credential.equals(PublicKey.default);
  const banded = band.bandBps > 0;
  const ix: TransactionInstruction = await env.program.methods
    .createSale(
      new BN((args.cap ?? 1_000n).toString()),
      args.accessMode ?? ACCESS_OPEN,
      credential,
      schema,
      band
    )
    .accountsPartial({
      issuer: signer.publicKey,
      pool: env.pool,
      mint: env.mint,
      credential:
        args.credentialAccount !== undefined
          ? args.credentialAccount
          : named
            ? credential
            : null,
      schema:
        args.schemaAccount !== undefined
          ? args.schemaAccount
          : named
            ? schema
            : null,
      dbcConfig:
        args.dbcConfigAccount !== undefined
          ? args.dbcConfigAccount
          : env.poolConfig,
      quoteMint:
        args.quoteMintAccount !== undefined
          ? args.quoteMintAccount
          : banded
            ? env.quoteMint
            : null,
      rules: env.rules,
      extraAccountMetaList: env.extraMetas,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return send(env, [ix], [signer]);
}

export async function openBuyerRecord(env: Env, wallet: Keypair) {
  const ix: TransactionInstruction = await env.program.methods
    .openBuyerRecord()
    .accountsPartial({
      wallet: wallet.publicKey,
      mint: env.mint,
      rules: env.rules,
      record: buyerRecordPda(env.mint, wallet.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return send(env, [ix], [wallet]);
}

export async function approveBuyer(
  env: Env,
  wallet: PublicKey,
  signer?: Keypair
) {
  const issuer = signer ?? env.issuer;
  const ix: TransactionInstruction = await env.program.methods
    .approveBuyer(wallet)
    .accountsPartial({
      issuer: issuer.publicKey,
      mint: env.mint,
      rules: env.rules,
      record: buyerRecordPda(env.mint, wallet),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return send(env, [ix], [issuer]);
}

export async function revokeBuyer(
  env: Env,
  wallet: PublicKey,
  signer?: Keypair
) {
  const issuer = signer ?? env.issuer;
  const ix: TransactionInstruction = await env.program.methods
    .revokeBuyer(wallet)
    .accountsPartial({
      issuer: issuer.publicKey,
      mint: env.mint,
      rules: env.rules,
      record: buyerRecordPda(env.mint, wallet),
    })
    .instruction();
  return send(env, [ix], [issuer]);
}

export async function closeBuyerRecord(env: Env, wallet: Keypair) {
  const ix: TransactionInstruction = await env.program.methods
    .closeBuyerRecord()
    .accountsPartial({
      wallet: wallet.publicKey,
      mint: env.mint,
      record: buyerRecordPda(env.mint, wallet.publicKey),
    })
    .instruction();
  return send(env, [ix], [wallet]);
}

/**
 * Moves tokens with the transfer hook's extra accounts resolved from the chain.
 *
 * `rewrite` gets the resolved account list before the transfer is sent, which is
 * the only way to hand the hook an account the published list would never name.
 */
export async function transferTokens(
  env: Env,
  source: PublicKey,
  destination: PublicKey,
  owner: Keypair,
  amount: bigint,
  rewrite?: (keys: AccountMeta[]) => void
) {
  const ix = await createTransferCheckedWithTransferHookInstruction(
    connectionFor(env.client),
    source,
    env.mint,
    destination,
    owner.publicKey,
    amount,
    env.baseDecimals,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  if (rewrite !== undefined) {
    rewrite(ix.keys);
  }
  return send(env, [ix], [owner]);
}

export function buy(
  env: Env,
  destination: PublicKey,
  amount: bigint,
  rewrite?: (keys: AccountMeta[]) => void
) {
  return transferTokens(
    env,
    env.vault,
    destination,
    env.poolAuthority,
    amount,
    rewrite
  );
}

export function sell(
  env: Env,
  source: PublicKey,
  owner: Keypair,
  amount: bigint,
  rewrite?: (keys: AccountMeta[]) => void
) {
  return transferTokens(env, source, env.vault, owner, amount, rewrite);
}

/** Stands in for DBC clearing the mint's hook inside the curve-completing trade. */
export function graduate(env: Env) {
  const ix = createUpdateTransferHookInstruction(
    env.mint,
    env.issuer.publicKey,
    PublicKey.default,
    [],
    TOKEN_2022_PROGRAM_ID
  );
  return send(env, [ix], [env.issuer]);
}

export interface TokenAccountOptions {
  /**
   * Every associated token account carries ImmutableOwner. A plain token account
   * only carries it when asked, and without it the owner can be handed to someone
   * else later, which is the hole the buy path closes.
   */
  immutableOwner?: boolean;
}

export async function createTokenAccount(
  env: Env,
  owner: PublicKey,
  options: TokenAccountOptions = {}
): Promise<PublicKey> {
  const account = Keypair.generate();
  mustSucceed(
    await send(env, await tokenAccountIxs(env, account, owner, options), [
      account,
    ])
  );
  return account.publicKey;
}

export async function createAssociatedTokenAccount(
  env: Env,
  owner: PublicKey
): Promise<PublicKey> {
  const address = getAssociatedTokenAddressSync(
    env.mint,
    owner,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  const ix = createAssociatedTokenAccountInstruction(
    env.payer.publicKey,
    address,
    owner,
    env.mint,
    TOKEN_2022_PROGRAM_ID
  );
  mustSucceed(await send(env, [ix]));
  return address;
}

export async function mintTokens(
  env: Env,
  destination: PublicKey,
  amount: bigint
) {
  // A real sale's mint cannot be minted any more, which is what `create_sale`
  // insists on. Tests still have to put tokens somewhere, so the authority is
  // handed back for this one instruction and taken away again.
  if (!env.keepsMintAuthority) {
    await writeMintAuthority(env, env.issuer.publicKey);
  }
  const ix = createMintToInstruction(
    env.mint,
    destination,
    env.issuer.publicKey,
    amount,
    [],
    TOKEN_2022_PROGRAM_ID
  );
  const result = mustSucceed(await send(env, [ix], [env.issuer]));
  if (!env.keepsMintAuthority) {
    await writeMintAuthority(env, null);
  }
  return result;
}

/** Gives a fresh keypair lamports without waiting for an airdrop transaction. */
export function fund(env: Env, address: PublicKey) {
  env.ctx.setAccount(address, {
    lamports: WALLET_FUNDING,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
    rentEpoch: 0,
  });
}

export async function accountAt(env: Env, address: PublicKey) {
  return env.client.getAccount(address);
}

export async function balanceOf(env: Env, address: PublicKey): Promise<bigint> {
  return env.client.getBalance(address);
}

export async function tokenBalance(
  env: Env,
  account: PublicKey
): Promise<bigint> {
  const info = await env.client.getAccount(account);
  assert.isNotNull(info, "token account is missing");
  return Buffer.from(info!.data).readBigUInt64LE(64);
}

export async function readRules(env: Env) {
  return env.program.account.saleRules.fetch(env.rules);
}

export async function readRecord(env: Env, wallet: PublicKey) {
  return env.program.account.buyerRecord.fetchNullable(
    buyerRecordPda(env.mint, wallet)
  );
}

/**
 * Makes each transaction unique. The test runtime keeps one blockhash for the
 * whole run and rejects a byte for byte repeat as already processed, which two
 * transactions that differ only in an account's contents would be. A compute unit
 * limit that counts up puts a different byte in every transaction, so a buy that
 * fails and the same buy after the account changed are two transactions, not one.
 */
let sendNonce = 0;

export async function send(
  env: Env,
  instructions: TransactionInstruction[],
  signers: Keypair[] = []
): Promise<BanksTransactionResultWithMeta> {
  const tx = new Transaction();
  tx.recentBlockhash = (await env.client.getLatestBlockhash())![0];
  tx.feePayer = env.payer.publicKey;
  sendNonce += 1;
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 - sendNonce })
  );
  for (const ix of instructions) {
    tx.add(ix);
  }
  const extra = signers.filter(
    (signer) => !signer.publicKey.equals(env.payer.publicKey)
  );
  tx.sign(env.payer, ...extra);
  return env.client.tryProcessTransaction(tx);
}

let simulateNonce = 0;

/**
 * Asks the runtime whether a sell back to the pool vault would go through right
 * now and throws the answer away without committing it.
 *
 * The compute unit limit counts down from its own number so a simulation can
 * never be byte for byte equal to a transaction the runtime has already seen.
 */
export async function simulateSell(
  env: Env,
  source: PublicKey,
  owner: Keypair,
  amount: bigint
): Promise<BanksTransactionResultWithMeta> {
  const ix = await createTransferCheckedWithTransferHookInstruction(
    connectionFor(env.client),
    source,
    env.mint,
    env.vault,
    owner.publicKey,
    amount,
    env.baseDecimals,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  const tx = new Transaction();
  tx.recentBlockhash = (await env.client.getLatestBlockhash())![0];
  tx.feePayer = env.payer.publicKey;
  simulateNonce += 1;
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 - simulateNonce })
  );
  tx.add(ix);
  const extra = owner.publicKey.equals(env.payer.publicKey) ? [] : [owner];
  tx.sign(env.payer, ...extra);
  return env.client.simulateTransaction(tx);
}

export function mustSucceed(
  result: BanksTransactionResultWithMeta
): BanksTransactionMeta {
  if (result.result !== null) {
    assert.fail(
      `expected success, got ${result.result}\n${(
        result.meta?.logMessages ?? []
      ).join("\n")}`
    );
  }
  return result.meta!;
}

/** Asserts the transaction failed, whatever the reason. */
export function expectFailure(result: BanksTransactionResultWithMeta) {
  assert.isNotNull(result.result, "expected the transaction to fail");
  return result;
}

/** Asserts the transaction failed with a named Anchor error from Pangu. */
export function expectError(
  result: BanksTransactionResultWithMeta,
  code: string
) {
  expectFailure(result);
  const logs = (result.meta?.logMessages ?? []).join("\n");
  assert.include(logs, `Error Code: ${code}`, `${result.result}\n${logs}`);
}

/** Decodes Pangu's own events out of a successful transaction's logs. */
export function eventsFrom(env: Env, meta: BanksTransactionMeta) {
  const decoded: { name: string; data: any }[] = [];
  for (const line of meta.logMessages) {
    const match = line.match(/^Program data: (.*)$/);
    if (match === null) {
      continue;
    }
    const event = env.program.coder.events.decode(match[1].trim());
    if (event !== null) {
      decoded.push(event);
    }
  }
  return decoded;
}

export function eventNamed(events: { name: string; data: any }[], name: string) {
  const found = events.find(
    (event) => event.name.toLowerCase() === name.toLowerCase()
  );
  assert.isDefined(found, `no ${name} event in ${events.map((e) => e.name)}`);
  return found!.data;
}

/**
 * A stand-in verifier: one credential and one schema, written byte for byte the
 * way the attestation service writes them, and owned by its program id.
 *
 * The service itself is not loaded here. These tests are about whether Pangu
 * reads those bytes correctly and refuses everything that is not exactly right,
 * which means crafting accounts no real program would ever produce. The same
 * layouts are then proven against the live program in fork-tests/life-credential.ts.
 */
export interface Verifier {
  authority: Keypair;
  /** The key the credential authorizes to sign attestations. */
  signer: Keypair;
  name: string;
  schemaName: string;
  credential: PublicKey;
  schema: PublicKey;
}

export interface VerifierOptions {
  name?: string;
  schemaName?: string;
  /** Keys on the credential's list. Defaults to the verifier's own signer. */
  signers?: PublicKey[];
  paused?: boolean;
  /** The credential written inside the schema, so a mismatch can be tested. */
  schemaCredential?: PublicKey;
}

export function placeVerifier(
  env: Env,
  options: VerifierOptions = {}
): Verifier {
  const authority = Keypair.generate();
  const signer = Keypair.generate();
  const name = options.name ?? "pangu-test-verifier";
  const schemaName = options.schemaName ?? "shareholder";
  const credential = credentialPda(authority.publicKey, name);
  const schema = schemaPda(credential, schemaName);

  putSasAccount(
    env,
    credential,
    encodeCredential(
      authority.publicKey,
      name,
      options.signers ?? [signer.publicKey]
    )
  );
  putSasAccount(
    env,
    schema,
    encodeSchema({
      credential: options.schemaCredential ?? credential,
      name: schemaName,
      description: "the wallet passed this verifier's checks",
      layout: [0],
      fieldNames: ["verified"],
      isPaused: options.paused ?? false,
    })
  );

  return { authority, signer, name, schemaName, credential, schema };
}

/** Rewrites the credential's list of authorized signers, as the service would. */
export function setCredentialSigners(
  env: Env,
  verifier: Verifier,
  signers: PublicKey[]
) {
  putSasAccount(
    env,
    verifier.credential,
    encodeCredential(verifier.authority.publicKey, verifier.name, signers)
  );
}

export interface AttestOptions {
  /** The wallet written inside. Defaults to the wallet being attested. */
  nonce?: PublicKey;
  credential?: PublicKey;
  schema?: PublicKey;
  signer?: PublicKey;
  /** Unix seconds. Zero means never expires. */
  expiry?: bigint;
  /** Where the account is put. Defaults to the address derived for the wallet. */
  at?: PublicKey;
  owner?: PublicKey;
  discriminator?: number;
  /** Cuts the account short, so a half-written account can be aimed at the hook. */
  truncateTo?: number;
  /** Claims a data blob longer than the account really holds. */
  statedDataLength?: number;
}

/** Puts one attestation on chain and returns its address. */
export function attest(
  env: Env,
  verifier: Verifier,
  wallet: PublicKey,
  options: AttestOptions = {}
): PublicKey {
  const credential = options.credential ?? verifier.credential;
  const schema = options.schema ?? verifier.schema;
  const address =
    options.at ?? attestationPda(verifier.credential, verifier.schema, wallet);

  let data = encodeAttestation({
    nonce: options.nonce ?? wallet,
    credential,
    schema,
    blob: Buffer.from([1]),
    signer: options.signer ?? verifier.signer.publicKey,
    expiry: options.expiry ?? 0n,
    discriminator: options.discriminator ?? ATTESTATION_DISCRIMINATOR,
    statedDataLength: options.statedDataLength,
  });
  if (options.truncateTo !== undefined) {
    data = data.subarray(0, options.truncateTo);
  }

  putSasAccount(env, address, data, options.owner);
  return address;
}

/**
 * Where `layout_version` sits inside a serialized SaleRules, the eight byte
 * discriminator included. It is the first of the bytes that used to be spare,
 * so it lands behind every field an earlier build already wrote.
 */
export const RULES_LAYOUT_VERSION_OFFSET = 298;

/**
 * Rewrites the layout version on a sale's rules account. Writing the byte by
 * hand is the only way to aim an account from another build of the program at
 * the program, because create_sale only ever writes the current one.
 */
export async function setRulesLayoutVersion(env: Env, version: number) {
  const account = await env.client.getAccount(env.rules);
  assert.isNotNull(account, "the rules account is missing");
  const data = Buffer.from(account!.data);
  data.writeUInt8(version, RULES_LAYOUT_VERSION_OFFSET);
  env.ctx.setAccount(env.rules, {
    lamports: account!.lamports,
    data,
    owner: account!.owner,
    executable: account!.executable,
    rentEpoch: account!.rentEpoch,
  });
}

/** Makes an account look the way a closed one does: gone. */
export function removeAccount(env: Env, address: PublicKey) {
  env.ctx.setAccount(address, {
    lamports: 0,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
    rentEpoch: 0,
  });
}

export function putSasAccount(
  env: Env,
  address: PublicKey,
  data: Buffer,
  owner: PublicKey = SAS_PROGRAM_ID
) {
  env.ctx.setAccount(address, {
    lamports: 10_000_000,
    data,
    owner,
    executable: false,
    rentEpoch: 0,
  });
}

export function encodeCredential(
  authority: PublicKey,
  name: string,
  signers: PublicKey[]
): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  return Buffer.concat([
    Buffer.from([CREDENTIAL_DISCRIMINATOR]),
    authority.toBuffer(),
    u32(nameBytes.length),
    nameBytes,
    u32(signers.length),
    ...signers.map((signer) => signer.toBuffer()),
  ]);
}

export function encodeSchema(fields: {
  credential: PublicKey;
  name: string;
  description: string;
  layout: number[];
  fieldNames: string[];
  isPaused?: boolean;
  version?: number;
}): Buffer {
  const name = Buffer.from(fields.name, "utf8");
  const description = Buffer.from(fields.description, "utf8");
  const layout = Buffer.from(fields.layout);
  const fieldNames = Buffer.concat(
    fields.fieldNames.map((field) => {
      const bytes = Buffer.from(field, "utf8");
      return Buffer.concat([u32(bytes.length), bytes]);
    })
  );
  return Buffer.concat([
    Buffer.from([SCHEMA_DISCRIMINATOR]),
    fields.credential.toBuffer(),
    u32(name.length),
    name,
    u32(description.length),
    description,
    u32(layout.length),
    layout,
    u32(fieldNames.length),
    fieldNames,
    Buffer.from([fields.isPaused === true ? 1 : 0]),
    Buffer.from([fields.version ?? 1]),
  ]);
}

export function encodeAttestation(fields: {
  nonce: PublicKey;
  credential: PublicKey;
  schema: PublicKey;
  blob: Buffer;
  signer: PublicKey;
  expiry: bigint;
  discriminator?: number;
  statedDataLength?: number;
}): Buffer {
  const expiry = Buffer.alloc(8);
  expiry.writeBigInt64LE(fields.expiry);
  return Buffer.concat([
    Buffer.from([fields.discriminator ?? ATTESTATION_DISCRIMINATOR]),
    fields.nonce.toBuffer(),
    fields.credential.toBuffer(),
    fields.schema.toBuffer(),
    u32(fields.statedDataLength ?? fields.blob.length),
    fields.blob,
    fields.signer.toBuffer(),
    expiry,
    PublicKey.default.toBuffer(),
  ]);
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

async function rentFor(env: Env, space: number): Promise<number> {
  const rent = await env.client.getRent();
  return Number(rent.minimumBalance(BigInt(space)));
}

async function tokenAccountIxs(
  env: Env,
  account: Keypair,
  owner: PublicKey,
  options: TokenAccountOptions = {}
): Promise<TransactionInstruction[]> {
  const immutable = options.immutableOwner ?? true;
  const space = getAccountLen(
    immutable
      ? [ExtensionType.ImmutableOwner, ExtensionType.TransferHookAccount]
      : [ExtensionType.TransferHookAccount]
  );
  const ixs = [
    SystemProgram.createAccount({
      fromPubkey: env.payer.publicKey,
      newAccountPubkey: account.publicKey,
      lamports: await rentFor(env, space),
      space,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ];
  if (immutable) {
    ixs.push(
      createInitializeImmutableOwnerInstruction(
        account.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }
  ixs.push(
    createInitializeAccount3Instruction(
      account.publicKey,
      env.mint,
      owner,
      TOKEN_2022_PROGRAM_ID
    )
  );
  return ixs;
}

async function createHookMint(
  env: Env,
  hookProgram: PublicKey,
  decimals: number
): Promise<PublicKey> {
  const mint = Keypair.generate();
  const space = getMintLen([ExtensionType.TransferHook]);
  const ixs = [
    SystemProgram.createAccount({
      fromPubkey: env.payer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: await rentFor(env, space),
      space,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferHookInstruction(
      mint.publicKey,
      env.issuer.publicKey,
      hookProgram,
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      env.issuer.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID
    ),
  ];
  mustSucceed(await send(env, ixs, [mint]));
  return mint.publicKey;
}

/** A paying-token mint: an ordinary SPL token, the way a dollar stablecoin is. */
export async function createPlainMint(
  env: Env,
  decimals: number
): Promise<PublicKey> {
  const mint = Keypair.generate();
  const ixs = [
    SystemProgram.createAccount({
      fromPubkey: env.payer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: await rentFor(env, MINT_SIZE),
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      env.issuer.publicKey,
      null,
      TOKEN_PROGRAM_ID
    ),
  ];
  mustSucceed(await send(env, ixs, [mint]));
  return mint.publicKey;
}

/**
 * Puts a real Token-2022 account at DBC's vault address.
 *
 * The address is a PDA of DBC, so no keypair can sign for it. Token-2022 builds the
 * account bytes at a throwaway address and they are copied across, which keeps the
 * layout and the account extensions exactly as the token program would write them.
 */
async function placeVault(env: Env, owner: PublicKey) {
  const scratch = Keypair.generate();
  // No ImmutableOwner on the vault on purpose. It is the source on a buy, and the
  // buy path must never look at the source side.
  mustSucceed(
    await send(
      env,
      await tokenAccountIxs(env, scratch, owner, { immutableOwner: false }),
      [scratch]
    )
  );
  const built = await env.client.getAccount(scratch.publicKey);
  assert.isNotNull(built, "scratch token account was not created");
  env.ctx.setAccount(env.vault, {
    lamports: built!.lamports,
    data: built!.data,
    owner: built!.owner,
    executable: built!.executable,
    rentEpoch: 0,
  });
}
