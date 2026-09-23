// The attestation service builders, checked against the hand-built versions the
// fork tests sent to the real service, and the two readers, checked against
// accounts written byte for byte the way the service's own `to_bytes` writes
// them. The reference functions below are copied from
// packages/program/fork-tests/fork-sale.ts as it stood when life-credential.ts
// last passed against the service dumped from mainnet, so equal bytes here means
// bytes the live service has already accepted.
//
// Not covered: the service itself, and a real node's getProgramAccounts
// filtering. Whether the service still accepts these bytes is proven by the
// fork run and the devnet run, not here.

import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import {
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import {
  PanguInputError,
  SAS_PROGRAM_ID,
  VERIFIED_SCHEMA,
  attestationAddress,
  closeAttestationInstruction,
  createAttestationInstruction,
  createCredentialInstruction,
  createSchemaInstruction,
  credentialAddress,
  credentialStatus,
  listAttestations,
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

// Copied from fork-sale.ts: sasEventAuthority and closeAttestationIx, the
// revoke life-credential.ts sent to the service.
const forkClose = {
  eventAuthority(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], SAS_PROGRAM_ID)[0];
  },
  instruction(
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
        { pubkey: forkClose.eventAuthority(), isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SAS_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([7]),
    });
  },
};

describe("closeAttestationInstruction", () => {
  it("writes the bytes and accounts the fork test's revoke sent", () => {
    const ix = closeAttestationInstruction({
      payer: verifier,
      authorizedSigner: signer,
      credential,
      schema,
      wallet,
    });
    const expected = forkClose.instruction(
      verifier,
      signer,
      credential,
      reference.attestationPda(credential, schema, wallet)
    );
    expect(ix.programId.equals(SAS_PROGRAM_ID)).toBe(true);
    expect(Buffer.from(ix.data).equals(Buffer.from(expected.data))).toBe(true);
    expect(accounts(ix)).toEqual(accounts(expected));
  });

  it("refuses the all zero wallet and a missing key", () => {
    const base = { payer: verifier, authorizedSigner: signer, credential, schema };
    expect(() => closeAttestationInstruction({ ...base, wallet: PublicKey.default })).toThrow(
      /all zero/
    );
    expect(() =>
      closeAttestationInstruction({ ...base, wallet: undefined as unknown as PublicKey })
    ).toThrow(PanguInputError);
  });
});

/**
 * An attestation account as the service writes it: the discriminator, then
 * `Attestation::to_bytes_inner` in program/src/state/attestation.rs, which is
 * nonce, credential, schema, the data behind its u32 length, signer, expiry and
 * the token account.
 */
function attestationAccount(fields: {
  nonce: PublicKey;
  credential?: PublicKey;
  schema?: PublicKey;
  signer?: PublicKey;
  expiry: bigint;
  data?: Buffer;
  discriminator?: number;
}): Buffer {
  const expiry = Buffer.alloc(8);
  expiry.writeBigInt64LE(fields.expiry);
  return Buffer.concat([
    Buffer.from([fields.discriminator ?? 2]),
    fields.nonce.toBuffer(),
    (fields.credential ?? credential).toBuffer(),
    (fields.schema ?? schema).toBuffer(),
    lengthPrefixed(fields.data ?? Buffer.from(VERIFIED_SCHEMA.attestationData)),
    (fields.signer ?? signer).toBuffer(),
    expiry,
    PublicKey.default.toBuffer(),
  ]);
}

/** The clock sysvar: slot, epoch start timestamp, epoch, leader schedule epoch, unix timestamp. */
function clockAccount(now: number): Buffer {
  const bytes = Buffer.alloc(40);
  bytes.writeBigInt64LE(BigInt(now), 32);
  return bytes;
}

const NOW = 1_800_000_000;

interface FakeAccount {
  owner: PublicKey;
  data: Buffer;
}

/**
 * A node that answers from a fixed set of accounts and one transaction per
 * attestation, recording what it was asked. Enough of Connection for the two
 * readers and nothing else.
 */
function fakeNode(
  accountsAt: Map<string, FakeAccount>,
  opened: Map<string, { blockTime: number; payer: PublicKey }> = new Map()
) {
  const asked: { filters: unknown[] }[] = [];
  const info = (key: PublicKey) => {
    if (key.equals(SYSVAR_CLOCK_PUBKEY)) {
      return { owner: SystemProgram.programId, data: clockAccount(NOW), lamports: 1, executable: false };
    }
    const found = accountsAt.get(key.toBase58());
    return found === undefined
      ? null
      : { owner: found.owner, data: found.data, lamports: 1_500_000, executable: false };
  };
  const node = {
    async getProgramAccounts(program: PublicKey, config: { filters: unknown[] }) {
      expect(program.equals(SAS_PROGRAM_ID)).toBe(true);
      asked.push({ filters: config.filters });
      return [...accountsAt.entries()].map(([address, account]) => ({
        pubkey: new PublicKey(address),
        account: { owner: account.owner, data: account.data, lamports: 1_500_000, executable: false },
      }));
    },
    async getAccountInfo(key: PublicKey) {
      return info(key);
    },
    async getMultipleAccountsInfo(keys: PublicKey[]) {
      return keys.map(info);
    },
    async getSignaturesForAddress(address: PublicKey) {
      const found = opened.get(address.toBase58());
      return found === undefined
        ? []
        : [{ signature: `opened-${address.toBase58()}`, err: null, blockTime: found.blockTime }];
    },
    async getTransaction(signature: string) {
      const address = new PublicKey(signature.slice("opened-".length));
      const found = opened.get(address.toBase58());
      if (found === undefined) {
        return null;
      }
      // A real attesting transaction, compiled, so the account order is the
      // one a node would report the balances in.
      const message = new Transaction({
        feePayer: found.payer,
        recentBlockhash: PublicKey.default.toBase58(),
      })
        .add(
          createAttestationInstruction({
            payer: found.payer,
            authorizedSigner: found.payer,
            credential,
            schema,
            wallet: new PublicKey(accountsAt.get(address.toBase58())?.data.subarray(1, 33) ?? PublicKey.default.toBuffer()),
            expiry: 0,
          })
        )
        .compileMessage();
      const keys = message.accountKeys;
      return {
        blockTime: found.blockTime,
        transaction: { message },
        meta: {
          err: null,
          loadedAddresses: undefined,
          preBalances: keys.map((key) => (key.equals(address) ? 0 : 1_000_000_000)),
          postBalances: keys.map((key) => (key.equals(address) ? 1_500_000 : 998_000_000)),
        },
      };
    },
  };
  return { connection: node as unknown as Connection, asked };
}

describe("listAttestations", () => {
  const valid = key();
  const expired = key();
  const forever = key();
  const at = (owner: PublicKey) => attestationAddress(credential, schema, owner).toBase58();

  it("reads every attestation under the pair, with its wallet, expiry, opening time and standing", async () => {
    const accountsAt = new Map<string, FakeAccount>([
      [at(valid), { owner: SAS_PROGRAM_ID, data: attestationAccount({ nonce: valid, expiry: BigInt(NOW + 3600) }) }],
      [at(expired), { owner: SAS_PROGRAM_ID, data: attestationAccount({ nonce: expired, expiry: BigInt(NOW) }) }],
      [at(forever), { owner: SAS_PROGRAM_ID, data: attestationAccount({ nonce: forever, expiry: 0n }) }],
    ]);
    const opened = new Map([[at(valid), { blockTime: NOW - 60, payer: signer }]]);
    const { connection, asked } = fakeNode(accountsAt, opened);

    const issued = await listAttestations(connection, credential, schema);
    const byWallet = new Map(issued.map((entry) => [entry.wallet.toBase58(), entry]));

    expect(issued).toHaveLength(3);
    expect(byWallet.get(valid.toBase58())).toMatchObject({
      expiry: NOW + 3600,
      created: NOW - 60,
      standing: "valid",
    });
    expect(byWallet.get(valid.toBase58())?.signer.equals(signer)).toBe(true);
    expect(byWallet.get(valid.toBase58())?.address.toBase58()).toBe(at(valid));
    // Expiry equal to the clock is out, the same comparison the hook makes.
    expect(byWallet.get(expired.toBase58())).toMatchObject({ standing: "expired", created: null });
    // Zero is never, not 1970.
    expect(byWallet.get(forever.toBase58())).toMatchObject({ expiry: 0, standing: "valid" });

    expect(asked[0]?.filters).toEqual([
      { memcmp: { offset: 0, bytes: "3" } },
      { memcmp: { offset: 33, bytes: credential.toBase58() } },
      { memcmp: { offset: 65, bytes: schema.toBase58() } },
    ]);
  });

  it("leaves out an attestation that is not at its own nonce's address, or is not an attestation", async () => {
    const stray = key();
    const accountsAt = new Map<string, FakeAccount>([
      [at(valid), { owner: SAS_PROGRAM_ID, data: attestationAccount({ nonce: stray, expiry: 0n }) }],
      [at(forever), { owner: SAS_PROGRAM_ID, data: attestationAccount({ nonce: forever, expiry: 0n, discriminator: 1 }) }],
      [at(expired), { owner: SAS_PROGRAM_ID, data: attestationAccount({ nonce: expired, expiry: 0n }).subarray(0, 120) }],
    ]);
    const { connection } = fakeNode(accountsAt);
    expect(await listAttestations(connection, credential, schema)).toEqual([]);
  });

  it("steps over a data blob longer than the one byte schema", async () => {
    const accountsAt = new Map<string, FakeAccount>([
      [
        at(valid),
        {
          owner: SAS_PROGRAM_ID,
          data: attestationAccount({ nonce: valid, expiry: BigInt(NOW + 1), data: Buffer.alloc(40, 7) }),
        },
      ],
    ]);
    const { connection } = fakeNode(accountsAt);
    const [entry] = await listAttestations(connection, credential, schema);
    expect(entry?.signer.equals(signer)).toBe(true);
    expect(entry?.expiry).toBe(NOW + 1);
  });
});

describe("credentialStatus", () => {
  const at = (owner: PublicKey) => attestationAddress(credential, schema, owner).toBase58();

  it("says valid, expired, or absent, judged on the chain's clock", async () => {
    const valid = key();
    const expired = key();
    const forever = key();
    const { connection } = fakeNode(
      new Map<string, FakeAccount>([
        [at(valid), { owner: SAS_PROGRAM_ID, data: attestationAccount({ nonce: valid, expiry: BigInt(NOW + 1) }) }],
        [at(expired), { owner: SAS_PROGRAM_ID, data: attestationAccount({ nonce: expired, expiry: BigInt(NOW - 1) }) }],
        [at(forever), { owner: SAS_PROGRAM_ID, data: attestationAccount({ nonce: forever, expiry: 0n }) }],
      ])
    );
    expect(await credentialStatus(connection, credential, schema, valid)).toBe("valid");
    expect(await credentialStatus(connection, credential, schema, expired)).toBe("expired");
    expect(await credentialStatus(connection, credential, schema, forever)).toBe("valid");
    expect(await credentialStatus(connection, credential, schema, key())).toBe("absent");
  });

  it("calls a foreign, mismatched or truncated account absent, the way the hook fails closed", async () => {
    const foreign = key();
    const otherWallet = key();
    const otherCredential = key();
    const truncated = key();
    const { connection } = fakeNode(
      new Map<string, FakeAccount>([
        [at(foreign), { owner: key(), data: attestationAccount({ nonce: foreign, expiry: 0n }) }],
        [at(otherWallet), { owner: SAS_PROGRAM_ID, data: attestationAccount({ nonce: key(), expiry: 0n }) }],
        [
          at(otherCredential),
          {
            owner: SAS_PROGRAM_ID,
            data: attestationAccount({ nonce: otherCredential, credential: key(), expiry: 0n }),
          },
        ],
        [at(truncated), { owner: SAS_PROGRAM_ID, data: attestationAccount({ nonce: truncated, expiry: 0n }).subarray(0, 130) }],
      ])
    );
    for (const wallet of [foreign, otherWallet, otherCredential, truncated]) {
      expect(await credentialStatus(connection, credential, schema, wallet)).toBe("absent");
    }
  });

  it("refuses the all zero wallet before asking the node anything", async () => {
    const { connection } = fakeNode(new Map());
    await expect(credentialStatus(connection, credential, schema, PublicKey.default)).rejects.toThrow(
      PanguInputError
    );
  });
});
