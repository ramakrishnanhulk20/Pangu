import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { attestationAddress } from "./addresses.js";
import { SAS_PROGRAM_ID, SEEDS } from "./constants.js";
import {
  PanguInputError,
  requireRealPublicKey,
  requireWholeNumber,
} from "./inputs.js";

/*
 * Instructions for the Solana Attestation Service, the three a verifier needs
 * to run a Pangu credential-mode sale: open a credential, open a schema under
 * it, and attest a wallet.
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
