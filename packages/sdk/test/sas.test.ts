// The three attestation service builders, checked against the hand-built
// versions the fork tests sent to the real service. The reference functions
// below are copied from packages/program/fork-tests/fork-sale.ts as it stood
// when life-credential.ts last passed against the service dumped from mainnet,
// so equal bytes here means bytes the live service has already accepted.
//
// Not covered: the service itself. Whether it still accepts these bytes is
// proven by the fork run, not here.

import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  PanguInputError,
  SAS_PROGRAM_ID,
  VERIFIED_SCHEMA,
  attestationAddress,
  createAttestationInstruction,
  createCredentialInstruction,
  createSchemaInstruction,
  credentialAddress,
  schemaAddress,
} from "../src/index.js";

const key = () => Keypair.generate().publicKey;

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function lengthPrefixed(bytes: Buffer): Buffer {
  return Buffer.concat([u32(bytes.length), bytes]);
}

const reference = {
  credentialPda(authority: PublicKey, name: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("credential"), authority.toBuffer(), Buffer.from(name, "utf8")],
      SAS_PROGRAM_ID
    )[0];
  },
  schemaPda(credential: PublicKey, name: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("schema"), credential.toBuffer(), Buffer.from(name, "utf8"), Buffer.from([1])],
      SAS_PROGRAM_ID
    )[0];
  },
  attestationPda(credential: PublicKey, schema: PublicKey, nonce: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("attestation"), credential.toBuffer(), schema.toBuffer(), nonce.toBuffer()],
      SAS_PROGRAM_ID
    )[0];
  },
  credentialData(name: string, signers: PublicKey[]): Buffer {
    return Buffer.concat([
      Buffer.from([0]),
      lengthPrefixed(Buffer.from(name, "utf8")),
      u32(signers.length),
      ...signers.map((signer) => signer.toBuffer()),
    ]);
  },
  schemaData(name: string, description: string, layout: number[], fieldNames: string[]): Buffer {
    return Buffer.concat([
      Buffer.from([1]),
      lengthPrefixed(Buffer.from(name, "utf8")),
      lengthPrefixed(Buffer.from(description, "utf8")),
      lengthPrefixed(Buffer.from(layout)),
      u32(fieldNames.length),
      ...fieldNames.map((field) => lengthPrefixed(Buffer.from(field, "utf8"))),
    ]);
  },
  attestationData(nonce: PublicKey, data: Buffer, expiry: bigint): Buffer {
    const bytes = Buffer.alloc(8);
    bytes.writeBigInt64LE(expiry);
    return Buffer.concat([Buffer.from([6]), nonce.toBuffer(), lengthPrefixed(data), bytes]);
  },
};

function accounts(ix: TransactionInstruction) {
  return ix.keys.map((account) => [account.pubkey.toBase58(), account.isSigner, account.isWritable]);
}

const verifier = key();
const signer = key();
const wallet = key();
const credential = reference.credentialPda(verifier, "pangu-verifier");
const schema = reference.schemaPda(credential, "shareholder");

describe("attestation service addresses", () => {
  it("derive the same credential, schema and attestation addresses as the fork tests", () => {
    expect(credentialAddress(verifier, "pangu-verifier").equals(credential)).toBe(true);
    expect(schemaAddress(credential, "shareholder").equals(schema)).toBe(true);
    expect(
      attestationAddress(credential, schema, wallet).equals(
        reference.attestationPda(credential, schema, wallet)
      )
    ).toBe(true);
  });

  it("refuse a name that cannot be an address seed", () => {
    expect(() => credentialAddress(verifier, "")).toThrow(PanguInputError);
    expect(() => schemaAddress(credential, "x".repeat(33))).toThrow(/at most 32 bytes/);
  });
});

describe("createCredentialInstruction", () => {
  it("writes the bytes and accounts the fork tests sent", () => {
    const signers = [signer, key()];
    const ix = createCredentialInstruction({
      payer: verifier,
      authority: verifier,
      name: "pangu-verifier",
      signers,
    });
    expect(ix.programId.equals(SAS_PROGRAM_ID)).toBe(true);
    expect(Buffer.from(ix.data).equals(reference.credentialData("pangu-verifier", signers))).toBe(true);
    expect(accounts(ix)).toEqual([
      [verifier.toBase58(), true, true],
      [credential.toBase58(), false, true],
      [verifier.toBase58(), true, false],
      [SystemProgram.programId.toBase58(), false, false],
    ]);
  });

  it("refuses no signers, a repeated signer, and more than Pangu will read", () => {
    const base = { payer: verifier, authority: verifier, name: "v" };
    expect(() => createCredentialInstruction({ ...base, signers: [] })).toThrow(PanguInputError);
    expect(() => createCredentialInstruction({ ...base, signers: [signer, signer] })).toThrow(
      /must not repeat/
    );
    const many = Array.from({ length: 65 }, key);
    expect(() => createCredentialInstruction({ ...base, signers: many })).toThrow(/at most 64/);
    expect(() =>
      createCredentialInstruction({ ...base, signers: [PublicKey.default] })
    ).toThrow(PanguInputError);
  });
});

describe("createSchemaInstruction", () => {
  it("writes the bytes and accounts the fork tests sent, with the one byte layout by default", () => {
    const ix = createSchemaInstruction({
      payer: verifier,
      authority: verifier,
      credential,
      name: "shareholder",
      description: "the wallet passed this verifier's checks",
    });
    expect(
      Buffer.from(ix.data).equals(
        reference.schemaData(
          "shareholder",
          "the wallet passed this verifier's checks",
          [0],
          ["verified"]
        )
      )
    ).toBe(true);
    expect(accounts(ix)).toEqual([
      [verifier.toBase58(), true, true],
      [verifier.toBase58(), true, false],
      [credential.toBase58(), false, false],
      [schema.toBase58(), false, true],
      [SystemProgram.programId.toBase58(), false, false],
    ]);
  });

  it("refuses a layout the field names do not match", () => {
    const base = { payer: verifier, authority: verifier, credential, name: "s", description: "" };
    expect(() => createSchemaInstruction({ ...base, layout: [] })).toThrow(PanguInputError);
    expect(() =>
      createSchemaInstruction({ ...base, layout: [0, 0], fieldNames: ["one"] })
    ).toThrow(/one each/);
    expect(() => createSchemaInstruction({ ...base, layout: [256], fieldNames: ["x"] })).toThrow(
      PanguInputError
    );
  });
});

describe("createAttestationInstruction", () => {
  it("uses the wallet as the nonce and writes the bytes the fork tests sent", () => {
    const expiry = 1_900_000_000;
    const ix = createAttestationInstruction({
      payer: signer,
      authorizedSigner: signer,
      credential,
      schema,
      wallet,
      expiry,
    });
    expect(
      Buffer.from(ix.data).equals(
        reference.attestationData(wallet, Buffer.from(VERIFIED_SCHEMA.attestationData), BigInt(expiry))
      )
    ).toBe(true);
    expect(accounts(ix)).toEqual([
      [signer.toBase58(), true, true],
      [signer.toBase58(), true, false],
      [credential.toBase58(), false, false],
      [schema.toBase58(), false, false],
      [reference.attestationPda(credential, schema, wallet).toBase58(), false, true],
      [SystemProgram.programId.toBase58(), false, false],
    ]);
  });

  it("writes zero for an attestation that never expires", () => {
    const ix = createAttestationInstruction({
      payer: signer,
      authorizedSigner: signer,
      credential,
      schema,
      wallet,
      expiry: 0,
      data: [1],
    });
    expect(Buffer.from(ix.data).equals(reference.attestationData(wallet, Buffer.from([1]), 0n))).toBe(
      true
    );
  });

  it("refuses a negative or fractional expiry and the all zero wallet", () => {
    const base = { payer: signer, authorizedSigner: signer, credential, schema, wallet };
    expect(() => createAttestationInstruction({ ...base, expiry: -1 })).toThrow(PanguInputError);
    expect(() => createAttestationInstruction({ ...base, expiry: 1.5 })).toThrow(PanguInputError);
    expect(() =>
      createAttestationInstruction({ ...base, wallet: PublicKey.default, expiry: 0 })
    ).toThrow(/all zero/);
  });
});
