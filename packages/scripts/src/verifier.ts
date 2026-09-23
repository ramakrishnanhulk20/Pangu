/**
 * The devnet verifier a credential-mode demo sale checks: a credential and a
 * schema on the Solana Attestation Service, run by the paying key.
 *
 * Both addresses are derived from the paying key and two fixed names, so every
 * command finds the same verifier without being told, and a second launch or a
 * second prove reuses it instead of opening another. The paying key is the
 * credential's authority and its one authorized signer, which is what lets
 * `prove` attest a throwaway wallet on its own.
 */

import {
  Transaction,
  type Connection,
  type Keypair,
  type PublicKey,
} from "@solana/web3.js";
import {
  SAS_PROGRAM_ID,
  attestationAddress,
  createAttestationInstruction,
  createCredentialInstruction,
  createSchemaInstruction,
  credentialAddress,
  schemaAddress,
} from "pangu-sdk";
import { send, type Landed } from "./chain.js";

export const VERIFIER_CREDENTIAL_NAME = "pangu-demo-verifier";
export const VERIFIER_SCHEMA_NAME = "pangu-demo-holder";
const SCHEMA_DESCRIPTION = "the wallet passed the Pangu demo verifier's checks";

export interface Verifier {
  credential: PublicKey;
  schema: PublicKey;
}

/** The paying key's own verifier, derived rather than stored. */
export function payerVerifier(payer: PublicKey): Verifier {
  const credential = credentialAddress(payer, VERIFIER_CREDENTIAL_NAME);
  return { credential, schema: schemaAddress(credential, VERIFIER_SCHEMA_NAME) };
}

/** Whether two verifiers are the same credential and schema. */
export function sameVerifier(left: Verifier, right: Verifier): boolean {
  return left.credential.equals(right.credential) && left.schema.equals(right.schema);
}

/**
 * Opens the paying key's credential and schema if they are not there yet.
 *
 * Reads both addresses first and only sends what is missing, so running it
 * again costs nothing. Throws when either address holds an account the
 * attestation service does not own, which would mean the derivation is wrong.
 * Returns the verifier and the signature of the transaction that opened it, or
 * null when both were already there.
 */
export async function ensureVerifier(
  connection: Connection,
  payer: Keypair
): Promise<Verifier & { opened: Landed | null }> {
  const verifier = payerVerifier(payer.publicKey);
  const [credential, schema] = await connection.getMultipleAccountsInfo(
    [verifier.credential, verifier.schema],
    "confirmed"
  );
  for (const [label, info] of [
    ["credential", credential],
    ["schema", schema],
  ] as const) {
    if (info !== null && info !== undefined && !info.owner.equals(SAS_PROGRAM_ID)) {
      throw new Error(
        `the verifier's ${label} address holds an account owned by ${info.owner.toBase58()}, not the attestation service`
      );
    }
  }

  const transaction = new Transaction();
  if (credential === null || credential === undefined) {
    transaction.add(
      createCredentialInstruction({
        payer: payer.publicKey,
        authority: payer.publicKey,
        name: VERIFIER_CREDENTIAL_NAME,
        signers: [payer.publicKey],
      })
    );
  }
  if (schema === null || schema === undefined) {
    transaction.add(
      createSchemaInstruction({
        payer: payer.publicKey,
        authority: payer.publicKey,
        credential: verifier.credential,
        name: VERIFIER_SCHEMA_NAME,
        description: SCHEMA_DESCRIPTION,
      })
    );
  }
  if (transaction.instructions.length === 0) {
    return { ...verifier, opened: null };
  }
  const opened = await send(connection, "opening the verifier's credential and schema", transaction, [
    payer,
  ]);
  return { ...verifier, opened };
}

/**
 * Attests wallets under a verifier, one attestation each, with the wallet as
 * the nonce so each lands where Pangu's hook looks for it.
 *
 * The paying key signs as the credential's authorized signer. `expiry` is unix
 * seconds on the chain's clock. Throws with the service's logs when the chain
 * refuses, for example when the paying key is not a signer on this credential.
 */
export async function attestWallets(
  connection: Connection,
  payer: Keypair,
  verifier: Verifier,
  wallets: readonly PublicKey[],
  expiry: number
): Promise<{ landed: Landed; attestations: PublicKey[] }> {
  const transaction = new Transaction();
  for (const wallet of wallets) {
    transaction.add(
      createAttestationInstruction({
        payer: payer.publicKey,
        authorizedSigner: payer.publicKey,
        credential: verifier.credential,
        schema: verifier.schema,
        wallet,
        expiry,
      })
    );
  }
  const landed = await send(connection, "attesting the wallets", transaction, [payer]);
  return {
    landed,
    attestations: wallets.map((wallet) =>
      attestationAddress(verifier.credential, verifier.schema, wallet)
    ),
  };
}
