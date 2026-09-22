// The mode 2 answer the preflight gives, from the same bytes the hook reads.
// The accounts are crafted here byte for byte the way the attestation service
// writes them, including shapes no real service would ever produce, because the
// point is what the reader does with them.
//
// Not covered: the service itself, and the moment the buy lands. This proves the
// decoding and the refusal that comes out of it, not that the chain still agrees
// a block later. The layouts are proven against the live attestation service in
// packages/program/fork-tests/life-credential.ts.

import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { Keypair, PublicKey } from "@solana/web3.js";
import { SAS_PROGRAM_ID } from "../src/index.js";
import { credentialRefusal } from "../src/dbc/credential.js";

const key = () => Keypair.generate().publicKey;

const rules = { credential: key(), schema: key() };
const wallet = key();
const signer = key();

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function encodeAttestation(fields: {
  nonce?: PublicKey;
  credential?: PublicKey;
  schema?: PublicKey;
  signer?: PublicKey;
  expiry?: bigint;
  discriminator?: number;
  blob?: Buffer;
  statedDataLength?: number;
}): Buffer {
  const blob = fields.blob ?? Buffer.from([1]);
  const expiry = Buffer.alloc(8);
  expiry.writeBigInt64LE(fields.expiry ?? 0n);
  return Buffer.concat([
    Buffer.from([fields.discriminator ?? 2]),
    (fields.nonce ?? wallet).toBuffer(),
    (fields.credential ?? rules.credential).toBuffer(),
    (fields.schema ?? rules.schema).toBuffer(),
    u32(fields.statedDataLength ?? blob.length),
    blob,
    (fields.signer ?? signer).toBuffer(),
    expiry,
    PublicKey.default.toBuffer(),
  ]);
}

function encodeCredential(signers: PublicKey[], statedCount?: number): Buffer {
  const name = Buffer.from("pangu-test-verifier", "utf8");
  return Buffer.concat([
    Buffer.from([0]),
    key().toBuffer(),
    u32(name.length),
    name,
    u32(statedCount ?? signers.length),
    ...signers.map((entry) => entry.toBuffer()),
  ]);
}

const sas = (data: Buffer) => ({ owner: SAS_PROGRAM_ID, data });

const NOW = 1_800_000_000;

function refusalFor(
  attestation: { owner: PublicKey; data: Buffer } | null,
  credential: { owner: PublicKey; data: Buffer } | null = sas(encodeCredential([signer]))
) {
  return credentialRefusal(rules, wallet, { attestation, credential, now: NOW });
}

describe("what the hook would say about a wallet's approval", () => {
  it("lets through an attestation that never expires and a signer still listed", () => {
    expect(refusalFor(sas(encodeAttestation({})))).toBeNull();
    expect(
      refusalFor(sas(encodeAttestation({ expiry: BigInt(NOW + 60) })))
    ).toBeNull();
  });

  it("refuses a missing, foreign or wrongly labelled account", () => {
    expect(refusalFor(null)).toBe("CredentialInvalid");
    expect(
      refusalFor({ owner: key(), data: encodeAttestation({}) })
    ).toBe("CredentialInvalid");
    expect(
      refusalFor(sas(encodeAttestation({ discriminator: 1 })))
    ).toBe("CredentialInvalid");
    expect(refusalFor(sas(encodeAttestation({})), null)).toBe("CredentialInvalid");
  });

  it("refuses an attestation that belongs to another sale or another wallet", () => {
    expect(refusalFor(sas(encodeAttestation({ credential: key() })))).toBe(
      "CredentialInvalid"
    );
    expect(refusalFor(sas(encodeAttestation({ schema: key() })))).toBe(
      "CredentialInvalid"
    );
    expect(refusalFor(sas(encodeAttestation({ nonce: key() })))).toBe(
      "CredentialInvalid"
    );
  });

  it("refuses an account that claims more data than it holds, rather than reading past it", () => {
    expect(
      refusalFor(sas(encodeAttestation({ statedDataLength: 4_000_000_000 })))
    ).toBe("CredentialInvalid");
    const cut = encodeAttestation({}).subarray(0, 80);
    expect(refusalFor(sas(Buffer.from(cut)))).toBe("CredentialInvalid");
  });

  it("calls an attestation past its expiry expired, and the second before it fine", () => {
    expect(refusalFor(sas(encodeAttestation({ expiry: BigInt(NOW - 1) })))).toBe(
      "CredentialExpired"
    );
    expect(refusalFor(sas(encodeAttestation({ expiry: BigInt(NOW) })))).toBe(
      "CredentialExpired"
    );
    expect(refusalFor(sas(encodeAttestation({ expiry: BigInt(NOW + 1) })))).toBeNull();
  });

  it("names the signer when the verifier has dropped the key that signed", () => {
    expect(
      refusalFor(sas(encodeAttestation({})), sas(encodeCredential([key(), key()])))
    ).toBe("CredentialSignerNotAuthorized");
    expect(
      refusalFor(sas(encodeAttestation({})), sas(encodeCredential([])))
    ).toBe("CredentialSignerNotAuthorized");
  });

  it("finds a signer anywhere in the list, and refuses a list longer than the hook walks", () => {
    const others = Array.from({ length: 63 }, () => key());
    expect(
      refusalFor(sas(encodeAttestation({})), sas(encodeCredential([...others, signer])))
    ).toBeNull();
    expect(
      refusalFor(
        sas(encodeAttestation({})),
        sas(encodeCredential([...others, key(), signer]))
      )
    ).toBe("CredentialInvalid");
    expect(
      refusalFor(sas(encodeAttestation({})), sas(encodeCredential([key()], 9)))
    ).toBe("CredentialInvalid");
  });
});
