// Shared plumbing for the fork tests: a connection to the local validator that
// holds Meteora's real mainnet programs, transaction measuring, and the swap and
// transfer builders that carry Pangu's hook accounts.

import * as fs from "fs";
import * as path from "path";
import { assert } from "chai";
import { AnchorProvider, BN, Program } from "@anchor-lang/core";
import {
  AccountMeta,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  AccountsType,
  createDbcProgram,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export const RPC_URL = "http://127.0.0.1:8899";


export const PANGU_PROGRAM_ID = new PublicKey(
  "4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG"
);
export const DBC_POOL_AUTHORITY = new PublicKey(
  "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"
);
/** The DAMM v2 config for the "Customizable" migration fee option. */
export const DAMM_V2_CONFIG = new PublicKey(
  "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck"
);
export const AAPLX_MINT = new PublicKey(
  "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"
);
export const AAPLX_TOKEN_BADGE = new PublicKey(
  "8VeVZe3Zxfpax2qQUp7i68FCLspLYErm2FJChc5NDuVn"
);
/** The Solana Attestation Service, dumped from mainnet by fetch-fixtures.sh. */
export const SAS_PROGRAM_ID = new PublicKey(
  "22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG"
);

/** Where fork-validator.sh leaves the throwaway wallets. Never inside the repo. */
export const FORK_ACCOUNTS_DIR = path.join(
  process.env.HOME ?? "",
  "pangu-fork-accounts"
);

export const ACCESS_ISSUER_LIST = 1;
export const SWAP_EXACT_IN = 0;
export const SWAP_PARTIAL_FILL = 1;
export const SWAP_EXACT_OUT = 2;

const ZERO_FEED = Array.from({ length: 32 }, () => 0);
const SWAP_COMPUTE_LIMIT = 600_000;
const TRANSACTION_SIZE_LIMIT = 1232;

export const connection = new Connection(RPC_URL, "confirmed");

export const dbcProgram = createDbcProgram(connection).program;

export const pangu = new Program(
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "target", "idl", "pangu.json"),
      "utf8"
    )
  ),
  new AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any) => txs,
    } as any,
    { commitment: "confirmed" }
  )
) as any;

export function saleRulesPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sale"), mint.toBuffer()],
    PANGU_PROGRAM_ID
  )[0];
}

export function buyerRecordPda(mint: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("buyer"), mint.toBuffer(), wallet.toBuffer()],
    PANGU_PROGRAM_ID
  )[0];
}

export function extraMetasPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    PANGU_PROGRAM_ID
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

export function sasEventAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    SAS_PROGRAM_ID
  )[0];
}

/**
 * Instructions for the attestation service, built by hand.
 *
 * Their npm package, `sas-lib`, is generated for `@solana/kit` v2. This test
 * stack is web3.js 1.x all the way through, and pulling a second, incompatible
 * Solana client library into it to build five instructions would be a worse
 * trade than writing the five instructions. Every discriminator, account order
 * and argument encoding below is copied from their program's own source:
 * `program/src/entrypoint.rs` for the discriminators, `program/src/instructions.rs`
 * for the account lists, and each processor's `process_instruction_data` for the
 * argument bytes.
 */
export function createCredentialIx(
  payer: PublicKey,
  authority: PublicKey,
  name: string,
  signers: PublicKey[]
): TransactionInstruction {
  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: credentialPda(authority, name), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([0]),
      lengthPrefixed(Buffer.from(name, "utf8")),
      u32(signers.length),
      ...signers.map((signer) => signer.toBuffer()),
    ]),
  });
}

export function createSchemaIx(
  payer: PublicKey,
  authority: PublicKey,
  credential: PublicKey,
  name: string,
  description: string,
  layout: number[],
  fieldNames: string[]
): TransactionInstruction {
  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: credential, isSigner: false, isWritable: false },
      { pubkey: schemaPda(credential, name), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([1]),
      lengthPrefixed(Buffer.from(name, "utf8")),
      lengthPrefixed(Buffer.from(description, "utf8")),
      lengthPrefixed(Buffer.from(layout)),
      u32(fieldNames.length),
      ...fieldNames.map((field) => lengthPrefixed(Buffer.from(field, "utf8"))),
    ]),
  });
}

export function createAttestationIx(options: {
  payer: PublicKey;
  authorizedSigner: PublicKey;
  credential: PublicKey;
  schema: PublicKey;
  nonce: PublicKey;
  data: Buffer;
  expiry: bigint;
}): TransactionInstruction {
  const expiry = Buffer.alloc(8);
  expiry.writeBigInt64LE(options.expiry);
  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      { pubkey: options.payer, isSigner: true, isWritable: true },
      { pubkey: options.authorizedSigner, isSigner: true, isWritable: false },
      { pubkey: options.credential, isSigner: false, isWritable: false },
      { pubkey: options.schema, isSigner: false, isWritable: false },
      {
        pubkey: attestationPda(options.credential, options.schema, options.nonce),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([6]),
      options.nonce.toBuffer(),
      lengthPrefixed(options.data),
      expiry,
    ]),
  });
}

export function closeAttestationIx(
  payer: PublicKey,
  authorizedSigner: PublicKey,
  credential: PublicKey,
  attestation: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: authorizedSigner, isSigner: true, isWritable: false },
      { pubkey: credential, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: sasEventAuthority(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SAS_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([7]),
  });
}

export function changeAuthorizedSignersIx(
  payer: PublicKey,
  authority: PublicKey,
  credential: PublicKey,
  signers: PublicKey[]
): TransactionInstruction {
  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: credential, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([3]),
      u32(signers.length),
      ...signers.map((signer) => signer.toBuffer()),
    ]),
  });
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function lengthPrefixed(bytes: Buffer): Buffer {
  return Buffer.concat([u32(bytes.length), bytes]);
}

export interface Measurement {
  signature: string;
  bytes: number;
  units: number;
  accounts: number;
}

const measurements: { action: string; measurement: Measurement }[] = [];

export function measurementTable() {
  return measurements;
}

/**
 * Size of a transaction without serialising it.
 *
 * `serialize()` throws once a transaction passes the 1232 byte limit, and the
 * whole point of measuring is to find out whether it does, so the size is worked
 * out from the compiled message instead.
 */
export function transactionSize(tx: Transaction): {
  bytes: number;
  accounts: number;
} {
  const message = tx.compileMessage();
  const bytes =
    message.serialize().length + 1 + 64 * message.header.numRequiredSignatures;
  return { bytes, accounts: message.accountKeys.length };
}

export async function airdrop(address: PublicKey, sol: number) {
  const signature = await connection.requestAirdrop(
    address,
    sol * LAMPORTS_PER_SOL
  );
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed"
  );
}

export async function prepare(
  tx: Transaction,
  payer: Keypair,
  signers: Keypair[]
): Promise<Transaction> {
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const extra = signers.filter(
    (signer) => !signer.publicKey.equals(payer.publicKey)
  );
  tx.sign(payer, ...extra);
  return tx;
}

/** Sends a transaction and records its size, accounts and compute units. */
export async function send(
  action: string,
  tx: Transaction,
  payer: Keypair,
  signers: Keypair[] = []
): Promise<Measurement> {
  await prepare(tx, payer, signers);
  const { bytes, accounts } = transactionSize(tx);
  assert.isAtMost(
    bytes,
    TRANSACTION_SIZE_LIMIT,
    `${action} does not fit in one transaction: ${bytes} bytes`
  );

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const latest = await connection.getLatestBlockhash();
  const result = await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed"
  );
  if (result.value.err !== null) {
    const logs = await logsOf(signature);
    assert.fail(`${action} failed: ${JSON.stringify(result.value.err)}\n${logs}`);
  }

  const detail = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 1,
  });
  const measurement: Measurement = {
    signature,
    bytes,
    accounts,
    units: detail?.meta?.computeUnitsConsumed ?? 0,
  };
  measurements.push({ action, measurement });
  console.log(
    `      ${action}: ${measurement.bytes} bytes, ${measurement.units} compute units, ${measurement.accounts} accounts`
  );
  return measurement;
}

async function logsOf(signature: string): Promise<string> {
  const detail = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 1,
  });
  return (detail?.meta?.logMessages ?? []).join("\n");
}

/**
 * Asserts a transaction is refused by Pangu with one named error.
 *
 * Checks the error code in the program logs, not just that something failed, so a
 * test cannot pass because the transaction broke for an unrelated reason.
 */
export async function expectPanguError(
  tx: Transaction,
  payer: Keypair,
  signers: Keypair[],
  code: string
): Promise<string> {
  await prepare(tx, payer, signers);
  let logs = "";
  let succeeded = false;
  try {
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    const latest = await connection.getLatestBlockhash();
    const result = await connection.confirmTransaction(
      { signature, ...latest },
      "confirmed"
    );
    if (result.value.err === null) {
      succeeded = true;
    } else {
      logs = await logsOf(signature);
    }
  } catch (error: any) {
    logs = (error.logs ?? []).join("\n");
    if (logs === "" && typeof error.getLogs === "function") {
      logs = ((await error.getLogs(connection)) ?? []).join("\n");
    }
    if (logs === "") {
      logs = String(error.message ?? error);
    }
  }
  assert.isFalse(succeeded, `expected ${code}, but the transaction succeeded`);
  assert.include(logs, `Error Code: ${code}`, logs);
  return logs;
}

export interface Sale {
  config: PublicKey;
  pool: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  quoteProgram: PublicKey;
  /** Mode 2 only: the credential and schema this sale's extra accounts name. */
  credential?: PublicKey;
  schema?: PublicKey;
  /** Band only: the Pyth price feed account this sale's extra accounts name. */
  priceAccount?: PublicKey;
}

export function hookAccounts(
  mint: PublicKey,
  sourceOwner: PublicKey,
  destinationOwner: PublicKey,
  sale?: Pick<Sale, "credential" | "schema" | "pool" | "priceAccount">
): AccountMeta[] {
  const accounts: AccountMeta[] = [
    { pubkey: extraMetasPda(mint), isSigner: false, isWritable: false },
    { pubkey: saleRulesPda(mint), isSigner: false, isWritable: true },
    {
      pubkey: buyerRecordPda(mint, destinationOwner),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: buyerRecordPda(mint, sourceOwner),
      isSigner: false,
      isWritable: true,
    },
  ];

  // A credential-mode sale publishes three more accounts. Token-2022 works out
  // the same three itself and refuses to call the hook unless every one of them
  // is here, so a seller carries them too even though the sell path reads none.
  if (sale?.credential !== undefined && sale.schema !== undefined) {
    accounts.push(
      { pubkey: SAS_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: sale.credential, isSigner: false, isWritable: false },
      {
        pubkey: attestationPda(sale.credential, sale.schema, destinationOwner),
        isSigner: false,
        isWritable: false,
      }
    );
  }

  // A banded sale publishes two more again, after whatever the access mode
  // needed: the pool the curve price comes from, and the Pyth price feed account
  // the stock price comes from.
  if (sale?.priceAccount !== undefined) {
    accounts.push(
      { pubkey: sale.pool!, isSigner: false, isWritable: false },
      { pubkey: sale.priceAccount, isSigner: false, isWritable: false }
    );
  }

  accounts.push({
    pubkey: PANGU_PROGRAM_ID,
    isSigner: false,
    isWritable: false,
  });
  return accounts;
}

export const hookAccountsInfo = {
  slices: [{ accountsType: AccountsType.TransferHookBase, length: 5 }],
};

/** DBC has to be told how many of the remaining accounts belong to the hook. */
export function hookAccountsInfoFor(accounts: AccountMeta[]) {
  return {
    slices: [
      { accountsType: AccountsType.TransferHookBase, length: accounts.length },
    ],
  };
}

export interface SwapOptions {
  sale: Sale;
  owner: Keypair;
  swapBaseForQuote: boolean;
  swapMode?: number;
  amount0: BN;
  amount1?: BN;
  /** A buy can be pointed at a token account other than the owner's own ATA. */
  outputTokenAccount?: PublicKey;
  /** A sell can be made from a token account other than the owner's own ATA. */
  inputTokenAccount?: PublicKey;
}

/**
 * Builds a DBC transfer-hook swap.
 *
 * The SDK's own `swap2WithTransferHook` resolves a hook's extra accounts against
 * placeholder token accounts, which cannot work for a hook whose accounts are
 * derived from the real destination owner, so the accounts are built here and
 * handed to the same on-chain instruction.
 */
export async function buildSwapTx(options: SwapOptions): Promise<Transaction> {
  const { sale, owner } = options;
  const quoteAta = getAssociatedTokenAddressSync(
    sale.quoteMint,
    owner.publicKey,
    false,
    sale.quoteProgram
  );
  const baseAta = getAssociatedTokenAddressSync(
    sale.baseMint,
    owner.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const pre: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: SWAP_COMPUTE_LIMIT }),
  ];

  let inputTokenAccount: PublicKey;
  let outputTokenAccount: PublicKey;
  let sourceOwner: PublicKey;
  let destinationOwner: PublicKey;

  if (options.swapBaseForQuote) {
    inputTokenAccount = options.inputTokenAccount ?? baseAta;
    outputTokenAccount = quoteAta;
    sourceOwner = owner.publicKey;
    destinationOwner = DBC_POOL_AUTHORITY;
    pre.push(
      createAssociatedTokenAccountIdempotentInstruction(
        owner.publicKey,
        quoteAta,
        owner.publicKey,
        sale.quoteMint,
        sale.quoteProgram
      )
    );
  } else {
    inputTokenAccount = quoteAta;
    outputTokenAccount = options.outputTokenAccount ?? baseAta;
    sourceOwner = DBC_POOL_AUTHORITY;
    destinationOwner = owner.publicKey;
    pre.push(
      createAssociatedTokenAccountIdempotentInstruction(
        owner.publicKey,
        quoteAta,
        owner.publicKey,
        sale.quoteMint,
        sale.quoteProgram
      )
    );
    if (options.outputTokenAccount === undefined) {
      pre.push(
        createAssociatedTokenAccountIdempotentInstruction(
          owner.publicKey,
          baseAta,
          owner.publicKey,
          sale.baseMint,
          TOKEN_2022_PROGRAM_ID
        )
      );
    }
    if (sale.quoteMint.equals(NATIVE_MINT)) {
      const lamports = BigInt(
        (options.swapMode === SWAP_EXACT_OUT
          ? options.amount1 ?? options.amount0
          : options.amount0
        ).toString()
      );
      pre.push(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: quoteAta,
          lamports,
        }),
        createSyncNativeInstruction(quoteAta, TOKEN_PROGRAM_ID)
      );
    }
  }

  const hook = hookAccounts(
    sale.baseMint,
    sourceOwner,
    destinationOwner,
    sale
  );

  return dbcProgram.methods
    .swap2WithTransferHook(
      {
        amount0: options.amount0,
        amount1: options.amount1 ?? new BN(0),
        swapMode: options.swapMode ?? SWAP_EXACT_IN,
      },
      hookAccountsInfoFor(hook)
    )
    .accountsPartial({
      poolAuthority: DBC_POOL_AUTHORITY,
      config: sale.config,
      pool: sale.pool,
      inputTokenAccount,
      outputTokenAccount,
      baseVault: sale.baseVault,
      quoteVault: sale.quoteVault,
      baseMint: sale.baseMint,
      quoteMint: sale.quoteMint,
      payer: owner.publicKey,
      tokenBaseProgram: TOKEN_2022_PROGRAM_ID,
      tokenQuoteProgram: sale.quoteProgram,
      referralTokenAccount: null,
    })
    .remainingAccounts(hook)
    .preInstructions(pre)
    .transaction();
}

/** A plain Token-2022 transfer, with the hook accounts resolved from the chain. */
export async function buildTransferTx(
  mint: PublicKey,
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number
): Promise<Transaction> {
  const ix = await createTransferCheckedWithTransferHookInstruction(
    connection,
    source,
    mint,
    destination,
    owner,
    amount,
    decimals,
    [],
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );
  return new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: SWAP_COMPUTE_LIMIT }),
    ix
  );
}

/** What a sale with no price band stores and passes. */
export const NO_BAND = {
  bandBps: 0,
  priceAccount: PublicKey.default,
  priceFeedId: ZERO_FEED,
  priceShard: 0,
  maxPriceAgeSecs: 0,
  maxConfBps: 0,
};

export interface CreateSaleOptions {
  /**
   * The pool's DBC launch template. Every sale reads it, because its fee mode
   * decides whether the sale may open at all.
   */
  dbcConfig: PublicKey;
  verifier?: { credential: PublicKey; schema: PublicKey };
  band?: typeof NO_BAND;
  /** The paying token that template names. A band cannot be opened without it. */
  quoteMint?: PublicKey;
}

export function createSaleIx(
  issuer: PublicKey,
  pool: PublicKey,
  mint: PublicKey,
  cap: BN,
  accessMode: number,
  options: CreateSaleOptions
): Promise<TransactionInstruction> {
  const verifier = options.verifier;
  return pangu.methods
    .createSale(
      cap,
      accessMode,
      verifier?.credential ?? PublicKey.default,
      verifier?.schema ?? PublicKey.default,
      options.band ?? NO_BAND
    )
    .accountsPartial({
      issuer,
      pool,
      mint,
      credential: verifier?.credential ?? null,
      schema: verifier?.schema ?? null,
      dbcConfig: options.dbcConfig,
      quoteMint: options.quoteMint ?? null,
      rules: saleRulesPda(mint),
      extraAccountMetaList: extraMetasPda(mint),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export function openBuyerRecordIx(
  wallet: PublicKey,
  mint: PublicKey
): Promise<TransactionInstruction> {
  return pangu.methods
    .openBuyerRecord()
    .accountsPartial({
      wallet,
      mint,
      rules: saleRulesPda(mint),
      record: buyerRecordPda(mint, wallet),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export function approveBuyerIx(
  issuer: PublicKey,
  mint: PublicKey,
  wallet: PublicKey
): Promise<TransactionInstruction> {
  return pangu.methods
    .approveBuyer(wallet)
    .accountsPartial({
      issuer,
      mint,
      rules: saleRulesPda(mint),
      record: buyerRecordPda(mint, wallet),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export function revokeBuyerIx(
  issuer: PublicKey,
  mint: PublicKey,
  wallet: PublicKey
): Promise<TransactionInstruction> {
  return pangu.methods
    .revokeBuyer(wallet)
    .accountsPartial({
      issuer,
      mint,
      rules: saleRulesPda(mint),
      record: buyerRecordPda(mint, wallet),
    })
    .instruction();
}

export function closeBuyerRecordIx(
  wallet: PublicKey,
  mint: PublicKey
): Promise<TransactionInstruction> {
  return pangu.methods
    .closeBuyerRecord()
    .accountsPartial({
      wallet,
      mint,
      record: buyerRecordPda(mint, wallet),
    })
    .instruction();
}

export async function readRecord(mint: PublicKey, wallet: PublicKey) {
  return pangu.account.buyerRecord.fetchNullable(buyerRecordPda(mint, wallet));
}

export async function readRules(mint: PublicKey) {
  return pangu.account.saleRules.fetch(saleRulesPda(mint));
}

export async function tokenBalance(account: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(account);
  if (info === null) {
    return 0n;
  }
  return info.data.readBigUInt64LE(64);
}

/** Reads the mint's transfer-hook extension straight out of the account bytes. */
export async function transferHookOnMint(
  mint: PublicKey
): Promise<{ authority: PublicKey; program: PublicKey } | null> {
  const info = await connection.getAccountInfo(mint);
  assert.isNotNull(info, "mint is missing");
  const data = info!.data;
  let cursor = 166;
  while (cursor + 4 <= data.length) {
    const type = data.readUInt16LE(cursor);
    const length = data.readUInt16LE(cursor + 2);
    if (type === 0) {
      break;
    }
    if (type === 14) {
      const value = data.subarray(cursor + 4, cursor + 4 + length);
      return {
        authority: new PublicKey(value.subarray(0, 32)),
        program: new PublicKey(value.subarray(32, 64)),
      };
    }
    cursor += 4 + length;
  }
  return null;
}

export function loadForkWallet(name: string): Keypair {
  const file = path.join(FORK_ACCOUNTS_DIR, `${name}.json`);
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")))
  );
}
