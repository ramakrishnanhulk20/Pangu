import { PublicKey } from "@solana/web3.js";
import { SAS_PROGRAM_ID } from "../constants.js";
import type { PanguErrorName } from "../errors.js";

/** An account as the RPC hands it back: who owns it and what is in it. */
export interface AccountBytes {
  owner: PublicKey;
  data: Uint8Array;
}

/** The two accounts the hook reads in mode 2, plus the clock it compares against. */
export interface CredentialState {
  /** The account at the one attestation address this wallet can have, or null. */
  attestation: AccountBytes | null;
  /** The credential the sale's rules name, or null when nothing is there. */
  credential: AccountBytes | null;
  /** Unix seconds, read off the chain's own clock rather than this machine's. */
  now: number;
}

/**
 * The layout the attestation service writes, mirrored from
 * programs/pangu/src/sas.rs. The blob between the stated length and the signer
 * is schema-shaped and means nothing here, so it is stepped over, not read.
 */
const ATTESTATION_DISCRIMINATOR = 2;
const CREDENTIAL_DISCRIMINATOR = 0;
const NONCE_OFFSET = 1;
const ATTESTATION_CREDENTIAL_OFFSET = 33;
const ATTESTATION_SCHEMA_OFFSET = 65;
const ATTESTATION_DATA_LEN_OFFSET = 97;
const ATTESTATION_DATA_OFFSET = 101;
const CREDENTIAL_NAME_LEN_OFFSET = 33;
const CREDENTIAL_NAME_OFFSET = 37;
const PUBKEY_LEN = 32;

/** sas.rs MAX_AUTHORIZED_SIGNERS: a longer list is refused rather than walked. */
const MAX_AUTHORIZED_SIGNERS = 64;

/** Zero expiry means the attestation never runs out. sas.rs NEVER_EXPIRES. */
const NEVER_EXPIRES = 0;

function readPubkey(data: Uint8Array, offset: number): PublicKey | null {
  const end = offset + PUBKEY_LEN;
  if (!Number.isSafeInteger(end) || offset < 0 || end > data.length) {
    return null;
  }
  return new PublicKey(data.subarray(offset, end));
}

function readU32(data: Uint8Array, offset: number): number | null {
  const end = offset + 4;
  if (!Number.isSafeInteger(end) || offset < 0 || end > data.length) {
    return null;
  }
  return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
}

function readI64(data: Uint8Array, offset: number): bigint | null {
  const end = offset + 8;
  if (!Number.isSafeInteger(end) || offset < 0 || end > data.length) {
    return null;
  }
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigInt64(0, true);
}

interface Attestation {
  nonce: PublicKey;
  credential: PublicKey;
  schema: PublicKey;
  signer: PublicKey;
  expiry: bigint;
}

function parseAttestation(account: AccountBytes): Attestation | null {
  if (!account.owner.equals(SAS_PROGRAM_ID)) {
    return null;
  }
  const data = account.data;
  if (data.length === 0 || data[0] !== ATTESTATION_DISCRIMINATOR) {
    return null;
  }
  const nonce = readPubkey(data, NONCE_OFFSET);
  const credential = readPubkey(data, ATTESTATION_CREDENTIAL_OFFSET);
  const schema = readPubkey(data, ATTESTATION_SCHEMA_OFFSET);
  const blobLength = readU32(data, ATTESTATION_DATA_LEN_OFFSET);
  if (nonce === null || credential === null || schema === null || blobLength === null) {
    return null;
  }
  const signerOffset = ATTESTATION_DATA_OFFSET + blobLength;
  const signer = readPubkey(data, signerOffset);
  const expiry = readI64(data, signerOffset + PUBKEY_LEN);
  if (signer === null || expiry === null) {
    return null;
  }
  return { nonce, credential, schema, signer, expiry };
}

/**
 * Whether the credential lists this key as an authorized signer right now.
 *
 * Null when the account is not a credential at all, or claims a list longer
 * than the hook will walk, so the caller can tell "no" from "unreadable".
 */
function listsSigner(account: AccountBytes, signer: PublicKey): boolean | null {
  if (!account.owner.equals(SAS_PROGRAM_ID)) {
    return null;
  }
  const data = account.data;
  if (data.length === 0 || data[0] !== CREDENTIAL_DISCRIMINATOR) {
    return null;
  }
  const nameLength = readU32(data, CREDENTIAL_NAME_LEN_OFFSET);
  if (nameLength === null) {
    return null;
  }
  const countOffset = CREDENTIAL_NAME_OFFSET + nameLength;
  const count = readU32(data, countOffset);
  if (count === null || count > MAX_AUTHORIZED_SIGNERS) {
    return null;
  }
  let offset = countOffset + 4;
  for (let index = 0; index < count; index += 1) {
    const key = readPubkey(data, offset);
    if (key === null) {
      return null;
    }
    if (key.equals(signer)) {
      return true;
    }
    offset += PUBKEY_LEN;
  }
  return false;
}

/**
 * The refusal the transfer hook would give this wallet in access mode 2, or null
 * when the hook would let the buy through.
 *
 * Reads the same bytes in the same order as `require_attestation` in
 * programs/pangu/src/instructions/execute.rs: the credential has to be the
 * service's own account of the right kind, the attestation has to sit at the one
 * address this sale's credential, schema and wallet derive, it has to agree with
 * its own address, it has to be in date, and the key that signed it has to still
 * be on the credential's list. Anything missing, foreign, truncated or
 * self-contradicting is CredentialInvalid, the same way the hook fails closed.
 *
 * What it cannot see: the moment the buy actually lands. A revocation between
 * this read and the transaction changes the answer, and the chain has the last
 * word.
 */
export function credentialRefusal(
  rules: { credential: PublicKey; schema: PublicKey },
  wallet: PublicKey,
  state: CredentialState
): PanguErrorName | null {
  if (state.attestation === null || state.credential === null) {
    return "CredentialInvalid";
  }

  const attested = parseAttestation(state.attestation);
  if (attested === null) {
    return "CredentialInvalid";
  }
  if (
    !attested.credential.equals(rules.credential) ||
    !attested.schema.equals(rules.schema) ||
    !attested.nonce.equals(wallet)
  ) {
    return "CredentialInvalid";
  }

  const expiry = attested.expiry;
  if (expiry !== BigInt(NEVER_EXPIRES) && expiry <= BigInt(Math.floor(state.now))) {
    return "CredentialExpired";
  }

  const authorized = listsSigner(state.credential, attested.signer);
  if (authorized === null) {
    return "CredentialInvalid";
  }
  return authorized ? null : "CredentialSignerNotAuthorized";
}
