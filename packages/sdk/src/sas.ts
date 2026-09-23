import { Buffer } from "buffer";
import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
  type Connection,
} from "@solana/web3.js";
import { attestationAddress } from "./addresses.js";
import { SAS_PROGRAM_ID, SEEDS } from "./constants.js";
import {
  PanguInputError,
  requireRealPublicKey,
  requireWholeNumber,
} from "./inputs.js";

/*
 * Instructions and reads for the Solana Attestation Service: what a verifier
 * needs to run a Pangu credential-mode sale. Open a credential, open a schema
 * under it, attest a wallet, revoke it by closing the attestation, and read
 * back what has been issued.
 *
 * Built by hand rather than through the service's own `sas-lib`, which is
 * generated for `@solana/kit` v2 while this package and everything that uses it
 * is web3.js 1.x. Every discriminator, account order and argument encoding is
 * copied from the service's source: `program/src/entrypoint.rs` for the
 * discriminators, `program/src/instructions.rs` for the account lists, and each
 * processor's `process_instruction_data` for the argument bytes. The same bytes
 * are proven against the real service in
 * packages/program/fork-tests/life-credential.ts.
 */

const CREATE_CREDENTIAL = 0;
const CREATE_SCHEMA = 1;
const CREATE_ATTESTATION = 6;
const CLOSE_ATTESTATION = 7;

/** The service derives a schema address with its version as the last seed. */
const FIRST_SCHEMA_VERSION = 1;

/** A program address seed is at most 32 bytes, and a name is used as one. */
const MAX_NAME_BYTES = 32;

/** sas.rs MAX_AUTHORIZED_SIGNERS: Pangu refuses every buy against a longer list. */
const MAX_AUTHORIZED_SIGNERS = 64;

/** The service's layout code for one unsigned byte. */
const LAYOUT_U8 = 0;

/**
 * The schema a Pangu sale is written for: one byte, named "verified".
 *
 * Pangu never reads an attestation's data. It reads who the attestation is
 * about, who signed it, and when it runs out (programs/pangu/src/sas.rs), so
 * the smallest shape the service accepts is the right one. The service checks
 * every attestation's data against its schema's layout, which is why an
 * attestation defaults to the one byte this layout expects.
 */
export const VERIFIED_SCHEMA: {
  readonly layout: readonly number[];
  readonly fieldNames: readonly string[];
  readonly attestationData: readonly number[];
} = {
  layout: [LAYOUT_U8],
  fieldNames: ["verified"],
  attestationData: [1],
};

export interface CreateCredentialInput {
  /** Pays the rent. May be the authority. */
  payer: PublicKey;
  /** Runs the credential and signs. The address is derived from it and the name. */
  authority: PublicKey;
  name: string;
  /** The keys allowed to attest under this credential, one to 64 of them. */
  signers: PublicKey[];
}

export interface CreateSchemaInput {
  payer: PublicKey;
  /** The credential's authority, who alone can add a schema to it. */
  authority: PublicKey;
  credential: PublicKey;
  name: string;
  description: string;
  /** The service's layout codes, one per field. Defaults to VERIFIED_SCHEMA. */
  layout?: readonly number[];
  fieldNames?: readonly string[];
}

export interface CreateAttestationInput {
  payer: PublicKey;
  /** One of the credential's signers. Pangu checks it is still on the list at every buy. */
  authorizedSigner: PublicKey;
  credential: PublicKey;
  schema: PublicKey;
  /**
   * The buyer. Used as the attestation's nonce, which is the convention Pangu
   * requires: the hook derives the attestation address from the buying wallet
   * and refuses an attestation about anyone else.
   */
  wallet: PublicKey;
  /** Unix seconds at which the attestation runs out. Zero means it never does. */
  expiry: number;
  /** Bytes matching the schema's layout. Defaults to VERIFIED_SCHEMA's one byte. */
  data?: Uint8Array | readonly number[];
}

function meta(pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta {
  return { pubkey, isSigner, isWritable };
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function lengthPrefixed(bytes: Uint8Array): Buffer {
  return Buffer.concat([u32(bytes.length), Buffer.from(bytes)]);
}

function requireName(value: unknown, field: string): Buffer {
  if (typeof value !== "string" || value.length === 0) {
    throw new PanguInputError(`${field} must be a name that is not empty`);
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > MAX_NAME_BYTES) {
    throw new PanguInputError(
      `${field} must be at most ${MAX_NAME_BYTES} bytes, because it is part of an address, got ${bytes.length}`
    );
  }
  return bytes;
}

function requireText(value: unknown, field: string): Buffer {
  if (typeof value !== "string") {
    throw new PanguInputError(`${field} must be text`);
  }
  return Buffer.from(value, "utf8");
}

function requireBytes(value: unknown, field: string): Buffer {
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (
    Array.isArray(value) &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    return Buffer.from(value);
  }
  throw new PanguInputError(`${field} must be bytes`);
}

/** A credential's address. Seeds "credential", the authority and the name. */
export function credentialAddress(authority: PublicKey, name: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEEDS.credential),
      requireRealPublicKey(authority, "authority").toBuffer(),
      requireName(name, "name"),
    ],
    SAS_PROGRAM_ID
  )[0];
}

/** A schema's first version. Seeds "schema", the credential, the name and the version byte. */
export function schemaAddress(credential: PublicKey, name: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEEDS.schema),
      requireRealPublicKey(credential, "credential").toBuffer(),
      requireName(name, "name"),
      Buffer.from([FIRST_SCHEMA_VERSION]),
    ],
    SAS_PROGRAM_ID
  )[0];
}

/**
 * Opens a credential on the attestation service: a named verifier with a list
 * of keys allowed to attest under it.
 *
 * Throws PanguInputError for an empty or over-long name, no signers, a repeated
 * signer, or more signers than Pangu will read. Sends nothing.
 */
export function createCredentialInstruction(
  input: CreateCredentialInput
): TransactionInstruction {
  const payer = requireRealPublicKey(input.payer, "payer");
  const authority = requireRealPublicKey(input.authority, "authority");
  const name = requireName(input.name, "name");
  if (!Array.isArray(input.signers) || input.signers.length === 0) {
    throw new PanguInputError("signers must hold at least one key, or nobody can attest");
  }
  if (input.signers.length > MAX_AUTHORIZED_SIGNERS) {
    throw new PanguInputError(
      `signers must hold at most ${MAX_AUTHORIZED_SIGNERS} keys, Pangu refuses every buy against a longer list, got ${input.signers.length}`
    );
  }
  const signers = input.signers.map((signer, index) =>
    requireRealPublicKey(signer, `signers[${index}]`)
  );
  if (new Set(signers.map((signer) => signer.toBase58())).size !== signers.length) {
    throw new PanguInputError("signers must not repeat a key");
  }

  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      meta(payer, true, true),
      meta(credentialAddress(authority, input.name), false, true),
      meta(authority, true, false),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([
      Buffer.from([CREATE_CREDENTIAL]),
      lengthPrefixed(name),
      u32(signers.length),
      ...signers.map((signer) => signer.toBuffer()),
    ]),
  });
}

/**
 * Opens the first version of a schema under a credential. Only the credential's
 * authority can send it.
 *
 * Throws PanguInputError for an empty or over-long name, an empty layout, a
 * layout code outside one byte, or a field name list that does not match the
 * layout one for one. Sends nothing.
 */
export function createSchemaInstruction(input: CreateSchemaInput): TransactionInstruction {
  const payer = requireRealPublicKey(input.payer, "payer");
  const authority = requireRealPublicKey(input.authority, "authority");
  const credential = requireRealPublicKey(input.credential, "credential");
  const name = requireName(input.name, "name");
  const description = requireText(input.description, "description");
  const layout = requireBytes(input.layout ?? VERIFIED_SCHEMA.layout, "layout");
  if (layout.length === 0) {
    throw new PanguInputError("layout must name at least one field");
  }
  const fieldNames = input.fieldNames ?? VERIFIED_SCHEMA.fieldNames;
  if (!Array.isArray(fieldNames) || fieldNames.length !== layout.length) {
    throw new PanguInputError(
      `fieldNames must name every field in the layout, one each: the layout has ${layout.length}`
    );
  }
  const fields = fieldNames.map((field, index) => requireText(field, `fieldNames[${index}]`));

  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      meta(payer, true, true),
      meta(authority, true, false),
      meta(credential, false, false),
      meta(schemaAddress(credential, input.name), false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([
      Buffer.from([CREATE_SCHEMA]),
      lengthPrefixed(name),
      lengthPrefixed(description),
      lengthPrefixed(layout),
      u32(fields.length),
      ...fields.map((field) => lengthPrefixed(field)),
    ]),
  });
}

/**
 * Attests one wallet under a credential and schema, with the wallet as the
 * nonce, so the attestation lands at the one address Pangu's hook derives for
 * that buyer.
 *
 * The expiry is unix seconds; zero means never. The service checks the signer
 * is on the credential's list at this moment and never again, which is why
 * Pangu checks it again on every buy. Throws PanguInputError for a missing key,
 * the all zero wallet, a negative or fractional expiry, or data that is not
 * bytes. Sends nothing.
 */
export function createAttestationInstruction(
  input: CreateAttestationInput
): TransactionInstruction {
  const payer = requireRealPublicKey(input.payer, "payer");
  const authorizedSigner = requireRealPublicKey(input.authorizedSigner, "authorizedSigner");
  const credential = requireRealPublicKey(input.credential, "credential");
  const schema = requireRealPublicKey(input.schema, "schema");
  const wallet = requireRealPublicKey(input.wallet, "wallet");
  const expiry = requireWholeNumber(input.expiry, "expiry", 0, Number.MAX_SAFE_INTEGER);
  const data = requireBytes(input.data ?? VERIFIED_SCHEMA.attestationData, "data");

  const expiryBytes = Buffer.alloc(8);
  expiryBytes.writeBigInt64LE(BigInt(expiry));

  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      meta(payer, true, true),
      meta(authorizedSigner, true, false),
      meta(credential, false, false),
      meta(schema, false, false),
      meta(attestationAddress(credential, schema, wallet), false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([
      Buffer.from([CREATE_ATTESTATION]),
      wallet.toBuffer(),
      lengthPrefixed(data),
      expiryBytes,
    ]),
  });
}

/** The service's event authority, which the closing instruction names. Seed "__event_authority". */
function eventAuthorityAddress(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], SAS_PROGRAM_ID)[0];
}

export interface CloseAttestationInput {
  /** Receives the attestation's rent. The verifier, when the verifier revokes. */
  payer: PublicKey;
  /** One of the credential's signers right now. Not necessarily the one who issued it. */
  authorizedSigner: PublicKey;
  credential: PublicKey;
  schema: PublicKey;
  /** The wallet the attestation is about, which is its nonce. */
  wallet: PublicKey;
}

/**
 * Revokes a wallet's credential by closing its attestation, the only
 * revocation the service has. Pangu sees it at the next buy: the account is
 * gone, so the buy is refused with CredentialInvalid.
 *
 * The service pays the attestation's rent to the payer, checks the signer is on
 * the credential's list now, and refuses a tokenized attestation, which needs a
 * different instruction. Throws PanguInputError for a missing key or the all
 * zero wallet. Sends nothing.
 */
export function closeAttestationInstruction(input: CloseAttestationInput): TransactionInstruction {
  const payer = requireRealPublicKey(input.payer, "payer");
  const authorizedSigner = requireRealPublicKey(input.authorizedSigner, "authorizedSigner");
  const credential = requireRealPublicKey(input.credential, "credential");
  const schema = requireRealPublicKey(input.schema, "schema");
  const wallet = requireRealPublicKey(input.wallet, "wallet");

  // Account order from `program/src/processor/close_attestation.rs`, which
  // destructures exactly these seven. The last is the service itself, which it
  // checks before it calls its own event instruction.
  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      meta(payer, true, true),
      meta(authorizedSigner, true, false),
      meta(credential, false, false),
      meta(attestationAddress(credential, schema, wallet), false, true),
      meta(eventAuthorityAddress(), false, false),
      meta(SystemProgram.programId, false, false),
      meta(SAS_PROGRAM_ID, false, false),
    ],
    data: Buffer.from([CLOSE_ATTESTATION]),
  });
}

/**
 * Where a wallet stands with one verifier, judged the way Pangu's hook judges
 * the attestation itself: there and in date, there and run out, or not there.
 */
export type CredentialStanding = "valid" | "expired" | "absent";

/** One credential a verifier has issued, as `listAttestations` reads it. */
export interface IssuedCredential {
  /** The attestation account. */
  address: PublicKey;
  /** The wallet it is about, read from the nonce. */
  wallet: PublicKey;
  /** The key that signed it into existence. */
  signer: PublicKey;
  /** Unix seconds at which it runs out, or zero for never. */
  expiry: number;
  /**
   * Unix seconds of the transaction that opened this attestation, or null when
   * it was not found in the account's recent history. The service stores no
   * date, so this comes from the transaction history.
   */
  created: number | null;
  /** Judged against the chain's own clock at the time of the read. */
  standing: Exclude<CredentialStanding, "absent">;
}

const ACCOUNT_ATTESTATION = 2;
const ATTESTATION_NONCE_OFFSET = 1;
const ATTESTATION_CREDENTIAL_OFFSET = 33;
const ATTESTATION_SCHEMA_OFFSET = 65;
const ATTESTATION_DATA_LEN_OFFSET = 97;
const ATTESTATION_DATA_OFFSET = 101;
const PUBKEY_BYTES = 32;

/** Base58 of the single byte 0x02 that opens every attestation account. */
const ATTESTATION_DISCRIMINATOR_BASE58 = "3";

/** The clock sysvar's unix_timestamp, after slot, epoch start, epoch and leader schedule epoch. */
const CLOCK_UNIX_TIMESTAMP_OFFSET = 32;

/** How far back an attestation's history is searched for the transaction that opened it. */
const CREATED_SIGNATURES = 20;
const CREATED_TRANSACTIONS = 5;

interface DecodedAttestation {
  nonce: PublicKey;
  credential: PublicKey;
  schema: PublicKey;
  signer: PublicKey;
  expiry: number;
}

function readKey(data: Uint8Array, offset: number): PublicKey | null {
  return offset >= 0 && offset + PUBKEY_BYTES <= data.length
    ? new PublicKey(data.subarray(offset, offset + PUBKEY_BYTES))
    : null;
}

/**
 * Reads an attestation the way programs/pangu/src/sas.rs does, every field
 * bounds checked. Null for anything that is not a well formed attestation owned
 * by the service, which the callers treat as not there, the same way the hook
 * fails closed.
 */
function decodeAttestation(owner: PublicKey, data: Uint8Array): DecodedAttestation | null {
  if (!owner.equals(SAS_PROGRAM_ID) || data.length < ATTESTATION_DATA_OFFSET) {
    return null;
  }
  if (data[0] !== ACCOUNT_ATTESTATION) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const signerOffset = ATTESTATION_DATA_OFFSET + view.getUint32(ATTESTATION_DATA_LEN_OFFSET, true);
  const signer = readKey(data, signerOffset);
  const expiryOffset = signerOffset + PUBKEY_BYTES;
  if (signer === null || expiryOffset + 8 > data.length) {
    return null;
  }
  return {
    nonce: readKey(data, ATTESTATION_NONCE_OFFSET) as PublicKey,
    credential: readKey(data, ATTESTATION_CREDENTIAL_OFFSET) as PublicKey,
    schema: readKey(data, ATTESTATION_SCHEMA_OFFSET) as PublicKey,
    signer,
    expiry: Number(view.getBigInt64(expiryOffset, true)),
  };
}

/** Zero never runs out, as sas.rs NEVER_EXPIRES says; any other runs out once the clock reaches it. */
function standingOf(expiry: number, now: number): "valid" | "expired" {
  return expiry !== 0 && expiry <= now ? "expired" : "valid";
}

function clockTime(data: Uint8Array | undefined): number {
  if (data === undefined || data.length < CLOCK_UNIX_TIMESTAMP_OFFSET + 8) {
    throw new Error("the node returned no clock, so no credential can be judged in or out of date");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  return Number(view.getBigInt64(CLOCK_UNIX_TIMESTAMP_OFFSET, true));
}

/**
 * The time of the newest transaction that opened this attestation address.
 *
 * Newest, because a wallet revoked and issued again has the older opening in
 * its history as well. An opening is a transaction in which the address went
 * from no lamports to some. Only the latest few are read, so a wallet that has
 * bought many times since may come back null.
 */
async function openedAt(connection: Connection, address: PublicKey): Promise<number | null> {
  const signatures = await connection.getSignaturesForAddress(
    address,
    { limit: CREATED_SIGNATURES },
    "confirmed"
  );
  let read = 0;
  for (const entry of signatures) {
    if (entry.err !== null) {
      continue;
    }
    if (read === CREATED_TRANSACTIONS) {
      break;
    }
    read += 1;
    const detail = await connection.getTransaction(entry.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (detail === null || detail.meta === null || detail.meta === undefined) {
      continue;
    }
    const keys = detail.transaction.message
      .getAccountKeys({ accountKeysFromLookups: detail.meta.loadedAddresses })
      .keySegments()
      .flat();
    const index = keys.findIndex((key) => key.equals(address));
    if (
      index >= 0 &&
      detail.meta.preBalances[index] === 0 &&
      (detail.meta.postBalances[index] ?? 0) > 0
    ) {
      return detail.blockTime ?? entry.blockTime ?? null;
    }
  }
  return null;
}

/**
 * Every credential issued under one credential and schema, in no particular
 * order, each judged against the chain's clock.
 *
 * One scan of the service's accounts, filtered by the node on the attestation
 * discriminator, the credential and the schema. An attestation that does not
 * sit at the address its own nonce derives is left out: Pangu's hook would never
 * find it, so it approves nobody. Then, per attestation, a short read of its
 * history for the date it was opened, so the cost grows with the list. An RPC
 * that refuses getProgramAccounts throws rather than returning a short list.
 */
export async function listAttestations(
  connection: Connection,
  credential: PublicKey,
  schema: PublicKey
): Promise<IssuedCredential[]> {
  const credentialKey = requireRealPublicKey(credential, "credential");
  const schemaKey = requireRealPublicKey(schema, "schema");
  const accounts = await connection.getProgramAccounts(SAS_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { memcmp: { offset: 0, bytes: ATTESTATION_DISCRIMINATOR_BASE58 } },
      { memcmp: { offset: ATTESTATION_CREDENTIAL_OFFSET, bytes: credentialKey.toBase58() } },
      { memcmp: { offset: ATTESTATION_SCHEMA_OFFSET, bytes: schemaKey.toBase58() } },
    ],
  });
  const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  const now = clockTime(clock?.data);

  const issued: IssuedCredential[] = [];
  for (const entry of accounts) {
    const decoded = decodeAttestation(entry.account.owner, entry.account.data);
    if (
      decoded === null ||
      !decoded.credential.equals(credentialKey) ||
      !decoded.schema.equals(schemaKey) ||
      !attestationAddress(credentialKey, schemaKey, decoded.nonce).equals(entry.pubkey)
    ) {
      continue;
    }
    issued.push({
      address: entry.pubkey,
      wallet: decoded.nonce,
      signer: decoded.signer,
      expiry: decoded.expiry,
      created: await openedAt(connection, entry.pubkey),
      standing: standingOf(decoded.expiry, now),
    });
  }
  return issued;
}

/**
 * Whether a wallet holds a credential from this verifier right now: valid,
 * expired, or absent. Absent covers revoked, never issued, and anything at the
 * address that is not a well formed attestation about this wallet.
 *
 * Reads the attestation and the chain's clock in one call. Not checked here:
 * whether the key that signed it is still on the credential's list, which
 * Pangu also checks at every buy.
 */
export async function credentialStatus(
  connection: Connection,
  credential: PublicKey,
  schema: PublicKey,
  wallet: PublicKey
): Promise<CredentialStanding> {
  const credentialKey = requireRealPublicKey(credential, "credential");
  const schemaKey = requireRealPublicKey(schema, "schema");
  const walletKey = requireRealPublicKey(wallet, "wallet");
  const [attestation, clock] = await connection.getMultipleAccountsInfo(
    [attestationAddress(credentialKey, schemaKey, walletKey), SYSVAR_CLOCK_PUBKEY],
    "confirmed"
  );
  const now = clockTime(clock?.data);
  if (attestation === null || attestation === undefined) {
    return "absent";
  }
  const decoded = decodeAttestation(attestation.owner, attestation.data);
  if (
    decoded === null ||
    !decoded.nonce.equals(walletKey) ||
    !decoded.credential.equals(credentialKey) ||
    !decoded.schema.equals(schemaKey)
  ) {
    return "absent";
  }
  return standingOf(decoded.expiry, now);
}
