// Instruction shape and the refusals that come before it. The expected account
// list is walked out of the IDL here, including the program addresses, so a
// reordered or reflagged account in the program fails this file.
//
// Not covered: whether the program accepts the instruction. That is the
// program's own test suite, which runs the same accounts against the runtime.

import { describe, expect, it } from "vitest";
import { BorshCoder } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ACCESS_MODE,
  approveBuyerInstruction,
  closeBuyerRecordInstruction,
  createSaleInstruction,
  openBuyerRecordInstruction,
  priceFeedAddress,
  revokeBuyerInstruction,
  PANGU_IDL,
  PANGU_PROGRAM_ID,
  PANGU_SHARD_ID,
} from "../src/index.js";

interface IdlSeed {
  kind: string;
  value?: number[];
  path?: string;
}

interface IdlAccount {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  pda?: { seeds: IdlSeed[] };
}

interface IdlInstruction {
  name: string;
  discriminator: number[];
  accounts: IdlAccount[];
}

const idl = PANGU_IDL as unknown as { instructions: IdlInstruction[] };
const coder = new BorshCoder(PANGU_IDL);
const key = () => Keypair.generate().publicKey;

function instructionFromIdl(name: string): IdlInstruction {
  const found = idl.instructions.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`the IDL has no instruction called ${name}`);
  }
  return found;
}

/** The account list the IDL says this instruction takes, in the IDL's own order. */
function expectedKeys(
  name: string,
  provided: Record<string, PublicKey | undefined>,
  args: Record<string, PublicKey> = {}
) {
  const resolve = (account: IdlAccount): PublicKey | undefined => {
    if (account.address !== undefined) {
      return new PublicKey(account.address);
    }
    if (account.pda !== undefined) {
      const seeds = account.pda.seeds.map((seed) => {
        if (seed.kind === "const") {
          return Uint8Array.from(seed.value ?? []);
        }
        const from = seed.kind === "arg" ? args : provided;
        const value = from[seed.path ?? ""];
        if (value === undefined) {
          throw new Error(`no ${seed.path} to derive ${account.name} from`);
        }
        return value.toBuffer();
      });
      return PublicKey.findProgramAddressSync(seeds, PANGU_PROGRAM_ID)[0];
    }
    return provided[account.name];
  };

  return instructionFromIdl(name).accounts.map((account) => {
    const pubkey = resolve(account);
    if (pubkey === undefined) {
      if (account.optional !== true) {
        throw new Error(`${name} needs an account for ${account.name}`);
      }
      // Anchor reads the program's own id in an optional slot as "not passed".
      return { pubkey: PANGU_PROGRAM_ID, isSigner: false, isWritable: false };
    }
    return {
      pubkey,
      isSigner: account.signer === true,
      isWritable: account.writable === true,
    };
  });
}

function sameKeys(actual: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[], expected: ReturnType<typeof expectedKeys>) {
  expect(actual.map((entry) => entry.pubkey.toBase58())).toEqual(
    expected.map((entry) => entry.pubkey.toBase58())
  );
  expect(actual.map((entry) => [entry.isSigner, entry.isWritable])).toEqual(
    expected.map((entry) => [entry.isSigner, entry.isWritable])
  );
}

const discriminatorOf = (name: string) =>
  Uint8Array.from(instructionFromIdl(name).discriminator);

const issuer = key();
const pool = key();
const mint = key();
const dbcConfig = key();
const wallet = key();
/** Pyth's own Equity.US.AAPL/USD feed id. */
const PRICE_FEED =
  "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";

const band = {
  bps: 500,
  priceFeedId: PRICE_FEED,
  maxPriceAgeSecs: 300,
  maxConfBps: 100,
};

describe("instruction shape", () => {
  it("builds an open sale with the accounts the IDL names", () => {
    const ix = createSaleInstruction({
      issuer,
      pool,
      mint,
      cap: 1_000n,
      accessMode: ACCESS_MODE.open,
      dbcConfig,
    });
    expect(ix.programId.equals(PANGU_PROGRAM_ID)).toBe(true);
    expect(Uint8Array.from(ix.data.subarray(0, 8))).toEqual(
      discriminatorOf("create_sale")
    );
    sameKeys(
      ix.keys,
      expectedKeys("create_sale", {
        issuer,
        pool,
        mint,
        dbc_config: dbcConfig,
        system_program: SystemProgram.programId,
      })
    );
  });

  it("builds a mode 2 sale with a band and derives the price account itself", () => {
    const credential = key();
    const schema = key();
    const quoteMint = key();
    const ix = createSaleInstruction({
      issuer,
      pool,
      mint,
      cap: 5_000n,
      accessMode: ACCESS_MODE.verifierCredential,
      credential,
      schema,
      band,
      dbcConfig,
      quoteMint,
    });
    sameKeys(
      ix.keys,
      expectedKeys("create_sale", {
        issuer,
        pool,
        mint,
        credential,
        schema,
        dbc_config: dbcConfig,
        quote_mint: quoteMint,
        system_program: SystemProgram.programId,
      })
    );

    const decoded = coder.instruction.decode(ix.data);
    const args = decoded?.data as {
      cap: { toString(): string };
      access_mode: number;
      credential: PublicKey;
      band: {
        band_bps: number;
        price_account: PublicKey;
        price_feed_id: number[];
        price_shard: number;
        max_price_age_secs: number;
        max_conf_bps: number;
      };
    };
    expect(decoded?.name).toBe("create_sale");
    expect(args.cap.toString()).toBe("5000");
    expect(args.access_mode).toBe(ACCESS_MODE.verifierCredential);
    expect(args.credential.equals(credential)).toBe(true);
    expect(args.band.band_bps).toBe(500);
    expect(args.band.max_price_age_secs).toBe(300);
    expect(args.band.max_conf_bps).toBe(100);
    // The shard is not asked for, and the price account is derived from it and
    // the feed id rather than taken on the caller's word.
    expect(args.band.price_shard).toBe(PANGU_SHARD_ID);
    expect(
      args.band.price_account.equals(priceFeedAddress(PRICE_FEED, PANGU_SHARD_ID))
    ).toBe(true);
  });

  it("puts a sale on another Pyth shard when it asks for one", () => {
    const quoteMint = key();
    const ix = createSaleInstruction({
      issuer,
      pool,
      mint,
      cap: 5_000n,
      accessMode: ACCESS_MODE.open,
      band: { ...band, shard: 12 },
      dbcConfig,
      quoteMint,
    });
    const args = coder.instruction.decode(ix.data)?.data as {
      band: { price_account: PublicKey; price_shard: number };
    };
    expect(args.band.price_shard).toBe(12);
    expect(args.band.price_account.equals(priceFeedAddress(PRICE_FEED, 12))).toBe(
      true
    );
  });

  it("builds open_buyer_record for the wallet itself", () => {
    const ix = openBuyerRecordInstruction({ wallet, mint });
    expect(Uint8Array.from(ix.data)).toEqual(discriminatorOf("open_buyer_record"));
    sameKeys(
      ix.keys,
      expectedKeys("open_buyer_record", {
        wallet,
        mint,
        system_program: SystemProgram.programId,
      })
    );
  });

  it("builds approve_buyer with the wallet as an argument, not a signer", () => {
    const ix = approveBuyerInstruction({ issuer, mint, wallet });
    expect(Uint8Array.from(ix.data.subarray(0, 8))).toEqual(
      discriminatorOf("approve_buyer")
    );
    sameKeys(
      ix.keys,
      expectedKeys(
        "approve_buyer",
        { issuer, mint, system_program: SystemProgram.programId },
        { wallet }
      )
    );
    const decoded = coder.instruction.decode(ix.data);
    expect((decoded?.data as { wallet: PublicKey }).wallet.equals(wallet)).toBe(true);
  });

  it("builds revoke_buyer", () => {
    const ix = revokeBuyerInstruction({ issuer, mint, wallet });
    expect(Uint8Array.from(ix.data.subarray(0, 8))).toEqual(
      discriminatorOf("revoke_buyer")
    );
    sameKeys(ix.keys, expectedKeys("revoke_buyer", { issuer, mint }, { wallet }));
  });

  it("builds close_buyer_record", () => {
    const ix = closeBuyerRecordInstruction({ wallet, mint });
    expect(Uint8Array.from(ix.data)).toEqual(discriminatorOf("close_buyer_record"));
    sameKeys(ix.keys, expectedKeys("close_buyer_record", { wallet, mint }));
  });
});

describe("what create_sale refuses before it builds anything", () => {
  const base = {
    issuer,
    pool,
    mint,
    cap: 1_000n,
    accessMode: ACCESS_MODE.open,
    dbcConfig,
  };

  it("refuses a cap of zero", () => {
    expect(() => createSaleInstruction({ ...base, cap: 0n })).toThrow(
      /cap must be above zero/
    );
  });

  it("refuses an access mode the program does not have", () => {
    expect(() => createSaleInstruction({ ...base, accessMode: 3 })).toThrow(
      /accessMode must be between 0 and 2/
    );
  });

  it("refuses mode 2 without a credential and a schema", () => {
    expect(() =>
      createSaleInstruction({
        ...base,
        accessMode: ACCESS_MODE.verifierCredential,
      })
    ).toThrow(/needs both a credential and a schema/);
    expect(() =>
      createSaleInstruction({
        ...base,
        accessMode: ACCESS_MODE.verifierCredential,
        credential: key(),
      })
    ).toThrow(/needs both a credential and a schema/);
  });

  it("refuses a credential on a sale that is not in mode 2", () => {
    expect(() =>
      createSaleInstruction({ ...base, credential: key(), schema: key() })
    ).toThrow(/access mode 2/);
  });

  it("refuses a band with no feed", () => {
    const { priceFeedId, ...noPrice } = band;
    expect(() =>
      createSaleInstruction({
        ...base,
        band: noPrice as typeof band,
        quoteMint: key(),
      })
    ).toThrow(/feed id/);
    expect(() =>
      createSaleInstruction({
        ...base,
        band: { ...band, priceFeedId: `0x${"00".repeat(32)}` },
        quoteMint: key(),
      })
    ).toThrow(/all zeros is not a feed/);
  });

  it("refuses a price age outside the 1 to 3600 seconds the program takes", () => {
    for (const seconds of [0, 3_601]) {
      expect(() =>
        createSaleInstruction({
          ...base,
          band: { ...band, maxPriceAgeSecs: seconds },
          quoteMint: key(),
        })
      ).toThrow(/maxPriceAgeSecs must be between 1 and 3600/);
    }
  });

  it("refuses a band wider than half again over the stock price", () => {
    expect(() =>
      createSaleInstruction({
        ...base,
        band: { ...band, bps: 5_001 },
        quoteMint: key(),
      })
    ).toThrow(/bps must be between 1 and 5000/);
  });

  it("refuses a band without the paying token", () => {
    expect(() => createSaleInstruction({ ...base, band })).toThrow(
      /needs the quoteMint/
    );
  });

  it("refuses a sale of any mode without the pool's launch template", () => {
    const { dbcConfig: _left_out, ...noTemplate } = base;
    expect(() =>
      createSaleInstruction(noTemplate as typeof base)
    ).toThrow(/dbcConfig must be a PublicKey/);
  });

  it("refuses the paying token on a sale with no band", () => {
    expect(() => createSaleInstruction({ ...base, quoteMint: key() })).toThrow(
      /price band/
    );
  });

  it("refuses a confidence limit the program would not take, zero included", () => {
    // Zero is refused the same way an out of range setting is: a band that
    // accepted any confidence interval would be measured against a number
    // Pyth's own publishers do not agree on.
    for (const bps of [0, 1_001]) {
      expect(() =>
        createSaleInstruction({
          ...base,
          band: { ...band, maxConfBps: bps },
          quoteMint: key(),
        })
      ).toThrow(/maxConfBps must be between 1 and 1000/);
    }
  });

  it("refuses a shard id that is not a whole number inside two bytes", () => {
    expect(() =>
      createSaleInstruction({
        ...base,
        band: { ...band, shard: 65_536 },
        quoteMint: key(),
      })
    ).toThrow(/band.shard must be between 0 and 65535/);
  });

  it("refuses a missing or zero key", () => {
    expect(() =>
      createSaleInstruction({ ...base, issuer: undefined as unknown as PublicKey })
    ).toThrow(/issuer must be a PublicKey/);
    expect(() => createSaleInstruction({ ...base, mint: PublicKey.default })).toThrow(
      /all zero/
    );
  });
});
