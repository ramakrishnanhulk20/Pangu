// Decoding and reading. Accounts are encoded here with the IDL coder, the same
// bytes the program writes, then read back through the package and compared
// field by field.
//
// Not covered: a live RPC. The connection is a stand-in that answers with bytes,
// which is enough to prove the addresses, filters and decoding, and nothing about
// network behaviour.

import { beforeAll, describe, expect, it } from "vitest";
import { BN, BorshCoder } from "@anchor-lang/core";
import type { Connection } from "@solana/web3.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ExtensionType, getMintLen, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ACCESS_MODE,
  buyerRecordAddress,
  decodeBuyerRecord,
  decodeSale,
  getBuyerRecord,
  getSale,
  isSaleRunning,
  listBuyerRecords,
  saleRulesAddress,
  saleStanding,
  PanguLayoutError,
  PANGU_IDL,
  SALE_RULES_LAYOUT_VERSIONS,
  PANGU_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "../src/index.js";
import type { Sale } from "../src/index.js";

const coder = new BorshCoder(PANGU_IDL);
const key = () => Keypair.generate().publicKey;

const openRules = {
  mint: key(),
  pool: key(),
  base_vault: key(),
  issuer: key(),
  cap: new BN("18446744073709551615"),
  access_mode: ACCESS_MODE.open,
  credential: PublicKey.default,
  schema: PublicKey.default,
  price_account: PublicKey.default,
  price_feed_id: Array<number>(32).fill(0),
  price_shard: 0,
  band_bps: 0,
  max_price_age_secs: 0,
  max_conf_bps: 0,
  base_decimals: 6,
  quote_decimals: 6,
  buyers: 0,
  total_net_bought: new BN(0),
  bump: 254,
  layout_version: 2,
  quote_mint: key(),
  ends_at: new BN(1_790_000_000),
  reserved: Array<number>(23).fill(0),
};

/** What the program wrote before the paying token and the end existed: zeros. */
const versionOneRules = {
  ...openRules,
  mint: key(),
  layout_version: 1,
  quote_mint: PublicKey.default,
  ends_at: new BN(0),
};

const bandedRules = {
  ...openRules,
  mint: key(),
  access_mode: ACCESS_MODE.verifierCredential,
  credential: key(),
  schema: key(),
  price_account: key(),
  price_feed_id: Array.from({ length: 32 }, (_, i) => i + 1),
  price_shard: 7_700,
  band_bps: 500,
  max_price_age_secs: 900,
  max_conf_bps: 100,
  base_decimals: 9,
  quote_decimals: 6,
  buyers: 7,
  total_net_bought: new BN("1234567890123"),
  bump: 251,
};

const hex = (bytes: number[]) =>
  bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");

function connectionWith(accounts: Map<string, { data: Buffer; owner: PublicKey }>) {
  const seen: { filters?: unknown } = {};
  const connection = {
    getAccountInfo: async (address: PublicKey) => {
      const found = accounts.get(address.toBase58());
      return found === undefined
        ? null
        : { ...found, executable: false, lamports: 1, rentEpoch: 0 };
    },
    getProgramAccounts: async (_program: PublicKey, config: { filters?: unknown }) => {
      seen.filters = config.filters;
      return [...accounts.entries()].map(([address, account]) => ({
        pubkey: new PublicKey(address),
        account: { ...account, executable: false, lamports: 1, rentEpoch: 0 },
      }));
    },
  } as unknown as Connection;
  return { connection, seen };
}

/** A Token-2022 mint carrying a transfer hook, built the way the token program lays one out. */
function mintWithHook(hookProgram: PublicKey): Buffer {
  const data = Buffer.alloc(getMintLen([ExtensionType.TransferHook]));
  data.writeUInt32LE(1, 0);
  key().toBuffer().copy(data, 4);
  data.writeUInt8(6, 44);
  data.writeUInt8(1, 45);
  data.writeUInt8(1, 165);
  data.writeUInt16LE(ExtensionType.TransferHook, 166);
  data.writeUInt16LE(64, 168);
  key().toBuffer().copy(data, 170);
  hookProgram.toBuffer().copy(data, 202);
  return data;
}

describe("decoding", () => {
  it("reads back every field of an open sale", async () => {
    const sale = decodeSale(await coder.accounts.encode("SaleRules", openRules));
    expect(sale.mint.equals(openRules.mint)).toBe(true);
    expect(sale.pool.equals(openRules.pool)).toBe(true);
    expect(sale.baseVault.equals(openRules.base_vault)).toBe(true);
    expect(sale.issuer.equals(openRules.issuer)).toBe(true);
    expect(sale.cap).toBe(18446744073709551615n);
    expect(sale.accessMode).toBe(ACCESS_MODE.open);
    expect(sale.credential.equals(PublicKey.default)).toBe(true);
    expect(sale.schema.equals(PublicKey.default)).toBe(true);
    expect(sale.priceAccount.equals(PublicKey.default)).toBe(true);
    expect(sale.bandBps).toBe(0);
    expect(sale.priceFeedId).toBe("0".repeat(64));
    expect(sale.priceShard).toBe(0);
    expect(sale.maxPriceAgeSecs).toBe(0);
    expect(sale.maxConfBps).toBe(0);
    expect(sale.baseDecimals).toBe(6);
    expect(sale.quoteDecimals).toBe(6);
    expect(sale.buyers).toBe(0);
    expect(sale.totalNetBought).toBe(0n);
    expect(sale.bump).toBe(254);
    expect(sale.reserved).toHaveLength(23);
    expect(sale.hasBand).toBe(false);
  });

  it("reads the paying token and the end of the offering on version 2", async () => {
    const sale = decodeSale(await coder.accounts.encode("SaleRules", openRules));
    expect(sale.layoutVersion).toBe(2);
    expect(sale.quoteMint?.equals(openRules.quote_mint)).toBe(true);
    expect(sale.endsAt).toBe(1_790_000_000);
  });

  it("reads a version 2 sale with no end as no end", async () => {
    const sale = decodeSale(
      await coder.accounts.encode("SaleRules", { ...openRules, ends_at: new BN(0) })
    );
    expect(sale.endsAt).toBeNull();
    expect(sale.quoteMint?.equals(openRules.quote_mint)).toBe(true);
  });

  it("reads a version 1 sale, with no paying token and no end", async () => {
    const data = await coder.accounts.encode("SaleRules", versionOneRules);
    // The same 362 bytes the sales already open on devnet hold.
    expect(data).toHaveLength(362);
    expect(data.readUInt8(298)).toBe(1);
    expect(data.subarray(299).equals(Buffer.alloc(63))).toBe(true);

    const sale = decodeSale(data);
    expect(sale.layoutVersion).toBe(1);
    expect(sale.quoteMint).toBeNull();
    expect(sale.endsAt).toBeNull();
    expect(sale.cap).toBe(18446744073709551615n);
    expect(sale.mint.equals(versionOneRules.mint)).toBe(true);
  });

  it("accepts exactly versions 1 and 2", () => {
    expect([...SALE_RULES_LAYOUT_VERSIONS]).toEqual([1, 2]);
  });

  it("reads back a banded sale that also needs a credential", async () => {
    const sale = decodeSale(await coder.accounts.encode("SaleRules", bandedRules));
    expect(sale.accessMode).toBe(ACCESS_MODE.verifierCredential);
    expect(sale.credential.equals(bandedRules.credential)).toBe(true);
    expect(sale.schema.equals(bandedRules.schema)).toBe(true);
    expect(sale.priceAccount.equals(bandedRules.price_account)).toBe(true);
    expect(sale.bandBps).toBe(500);
    expect(sale.priceFeedId).toBe(hex(bandedRules.price_feed_id));
    expect(sale.priceShard).toBe(7_700);
    expect(sale.maxPriceAgeSecs).toBe(900);
    expect(sale.maxConfBps).toBe(100);
    expect(sale.baseDecimals).toBe(9);
    expect(sale.quoteDecimals).toBe(6);
    expect(sale.buyers).toBe(7);
    expect(sale.totalNetBought).toBe(1234567890123n);
    expect(sale.bump).toBe(251);
    expect(sale.hasBand).toBe(true);
  });

  it("reads back every field of a buyer record", async () => {
    const raw = {
      mint: openRules.mint,
      wallet: key(),
      approved: true,
      net_bought: new BN("4200000000"),
      bump: 249,
    };
    const record = decodeBuyerRecord(
      await coder.accounts.encode("BuyerRecord", raw)
    );
    expect(record.mint.equals(raw.mint)).toBe(true);
    expect(record.wallet.equals(raw.wallet)).toBe(true);
    expect(record.approved).toBe(true);
    expect(record.netBought).toBe(4200000000n);
    expect(record.bump).toBe(249);
  });

  it("refuses bytes that are not the account they are read as", async () => {
    const bytes = await coder.accounts.encode("BuyerRecord", {
      mint: key(),
      wallet: key(),
      approved: false,
      net_bought: new BN(0),
      bump: 1,
    });
    expect(() => decodeSale(bytes)).toThrow(/not a Pangu SaleRules/);
  });

  it("refuses an account that is not the size this build writes", async () => {
    const current = await coder.accounts.encode("SaleRules", openRules);
    // 427 bytes is the size an earlier build's rules account really is on
    // devnet. Anchor reads every field at a fixed offset and would hand back a
    // sale with 146 decimals and 28 million buyers rather than an error.
    const older = Buffer.concat([current, Buffer.alloc(427 - current.length)]);
    expect(older).toHaveLength(427);
    expect(() => decodeSale(older)).toThrow(PanguLayoutError);
    expect(() => decodeSale(older)).toThrow(
      new RegExp(`is ${current.length} bytes and these are 427`)
    );
  });

  it("refuses an account of the right size from another layout", async () => {
    const data = await coder.accounts.encode("SaleRules", {
      ...openRules,
      layout_version: 0,
    });
    expect(() => decodeSale(data)).toThrow(PanguLayoutError);
    expect(() => decodeSale(data)).toThrow(
      /layout version 0 and this package reads versions 1 and 2/
    );
    const newer = await coder.accounts.encode("SaleRules", {
      ...openRules,
      layout_version: 3,
    });
    expect(() => decodeSale(newer)).toThrow(PanguLayoutError);
  });
});

describe("reads", () => {
  it("returns null when no sale was ever opened", async () => {
    const { connection } = connectionWith(new Map());
    expect(await getSale(connection, key())).toBeNull();
    expect(await getBuyerRecord(connection, key(), key())).toBeNull();
  });

  it("reads the sale at the rules address for the mint", async () => {
    const data = await coder.accounts.encode("SaleRules", openRules);
    const { connection } = connectionWith(
      new Map([
        [
          saleRulesAddress(openRules.mint).toBase58(),
          { data, owner: PANGU_PROGRAM_ID },
        ],
      ])
    );
    const sale = await getSale(connection, openRules.mint);
    expect(sale?.issuer.equals(openRules.issuer)).toBe(true);
  });

  it("fills the decimals from the mint for a sale that stores none", async () => {
    const mint = key();
    const data = await coder.accounts.encode("SaleRules", {
      ...openRules,
      mint,
      base_decimals: 0,
      quote_decimals: 0,
    });
    const { connection } = connectionWith(
      new Map<string, { data: Buffer; owner: PublicKey }>([
        [saleRulesAddress(mint).toBase58(), { data, owner: PANGU_PROGRAM_ID }],
        [
          mint.toBase58(),
          { data: mintWithHook(PANGU_PROGRAM_ID), owner: TOKEN_2022_PROGRAM_ID },
        ],
      ])
    );
    expect(decodeSale(data).baseDecimals).toBe(0);
    expect((await getSale(connection, mint))?.baseDecimals).toBe(6);
  });

  it("leaves the decimals at zero when the mint cannot be read", async () => {
    const mint = key();
    const data = await coder.accounts.encode("SaleRules", {
      ...openRules,
      mint,
      base_decimals: 0,
    });
    const { connection } = connectionWith(
      new Map([[saleRulesAddress(mint).toBase58(), { data, owner: PANGU_PROGRAM_ID }]])
    );
    expect((await getSale(connection, mint))?.baseDecimals).toBe(0);
  });

  it("refuses an account at the rules address that Pangu does not own", async () => {
    const data = await coder.accounts.encode("SaleRules", openRules);
    const { connection } = connectionWith(
      new Map([
        [
          saleRulesAddress(openRules.mint).toBase58(),
          { data, owner: TOKEN_PROGRAM_ID },
        ],
      ])
    );
    await expect(getSale(connection, openRules.mint)).rejects.toThrow(
      /not by Pangu/
    );
  });

  it("reads a wallet's record at its own address", async () => {
    const wallet = key();
    const data = await coder.accounts.encode("BuyerRecord", {
      mint: openRules.mint,
      wallet,
      approved: true,
      net_bought: new BN(500),
      bump: 253,
    });
    const { connection } = connectionWith(
      new Map([
        [
          buyerRecordAddress(openRules.mint, wallet).toBase58(),
          { data, owner: PANGU_PROGRAM_ID },
        ],
      ])
    );
    const record = await getBuyerRecord(connection, openRules.mint, wallet);
    expect(record?.netBought).toBe(500n);
    expect(record?.approved).toBe(true);
  });

  it("lists this sale's records with a size and a mint filter", async () => {
    const wallet = key();
    const data = await coder.accounts.encode("BuyerRecord", {
      mint: openRules.mint,
      wallet,
      approved: false,
      net_bought: new BN(10),
      bump: 252,
    });
    const { connection, seen } = connectionWith(
      new Map([
        [
          buyerRecordAddress(openRules.mint, wallet).toBase58(),
          { data, owner: PANGU_PROGRAM_ID },
        ],
      ])
    );
    const records = await listBuyerRecords(connection, openRules.mint);
    expect(records).toHaveLength(1);
    expect(records[0]?.wallet.equals(wallet)).toBe(true);

    const filters = seen.filters as [
      { dataSize: number },
      { memcmp: { offset: number; bytes: string } },
    ];
    expect(filters[0].dataSize).toBe(data.length);
    expect(filters[1].memcmp.offset).toBe(0);
    expect(filters[1].memcmp.bytes).toBe(
      coder.accounts.memcmp("BuyerRecord", openRules.mint.toBuffer()).bytes
    );
  });

  it("refuses to read a sale whose rules came from another layout", async () => {
    const mint = key();
    const data = await coder.accounts.encode("SaleRules", {
      ...openRules,
      mint,
      layout_version: 0,
    });
    const { connection } = connectionWith(
      new Map<string, { data: Buffer; owner: PublicKey }>([
        [saleRulesAddress(mint).toBase58(), { data, owner: PANGU_PROGRAM_ID }],
        [
          mint.toBase58(),
          { data: mintWithHook(PANGU_PROGRAM_ID), owner: TOKEN_2022_PROGRAM_ID },
        ],
      ])
    );
    await expect(getSale(connection, mint)).rejects.toThrow(PanguLayoutError);
    // Whether the sale is still running is read off the mint alone, so it keeps
    // answering for a sale this package refuses to decode.
    expect(await isSaleRunning(connection, mint)).toBe(true);
  });

  it("calls a sale running while the mint still names Pangu", async () => {
    const mint = key();
    const { connection } = connectionWith(
      new Map([
        [
          mint.toBase58(),
          { data: mintWithHook(PANGU_PROGRAM_ID), owner: TOKEN_2022_PROGRAM_ID },
        ],
      ])
    );
    expect(await isSaleRunning(connection, mint)).toBe(true);
  });

  it("calls a sale finished once the mint names another hook", async () => {
    const mint = key();
    const { connection } = connectionWith(
      new Map([
        [
          mint.toBase58(),
          { data: mintWithHook(PublicKey.default), owner: TOKEN_2022_PROGRAM_ID },
        ],
      ])
    );
    expect(await isSaleRunning(connection, mint)).toBe(false);
    expect(await isSaleRunning(connection, key())).toBe(false);
  });
});

describe("standing", () => {
  let sale: Sale;

  beforeAll(async () => {
    sale = decodeSale(
      await coder.accounts.encode("SaleRules", { ...openRules, cap: new BN(1_000) })
    );
  });

  const record = (wallet: PublicKey, netBought: bigint) => ({
    mint: openRules.mint,
    wallet,
    approved: true,
    netBought,
    bump: 1,
  });

  it("counts buyers and works out the largest wallet's share", () => {
    const whale = key();
    const standing = saleStanding(sale, [
      record(key(), 1_000n),
      record(whale, 3_000n),
      record(key(), 0n),
    ]);
    expect(standing.buyers).toBe(2);
    expect(standing.totalNetBought).toBe(4_000n);
    expect(standing.largestWallet?.equals(whale)).toBe(true);
    expect(standing.largestShare).toBeCloseTo(0.75, 9);
    expect(standing.capShare).toBeCloseTo(0.25, 9);
  });

  it("shows nothing sold as zero shares rather than as a division by zero", () => {
    const standing = saleStanding(sale, [record(key(), 0n)]);
    expect(standing.buyers).toBe(0);
    expect(standing.largestShare).toBe(0);
    expect(standing.capShare).toBe(0);
    expect(standing.largestWallet).toBeNull();
  });

  it("calls the offering over from its end time on, by the clock it is given", async () => {
    expect(sale.endsAt).toBe(1_790_000_000);
    expect(saleStanding(sale, [], 1_789_999_999).offeringOver).toBe(false);
    expect(saleStanding(sale, [], 1_790_000_000).offeringOver).toBe(true);

    const noEnd = decodeSale(await coder.accounts.encode("SaleRules", versionOneRules));
    expect(saleStanding(noEnd, [], Number.MAX_SAFE_INTEGER).offeringOver).toBe(false);
  });

  it("refuses a record from another sale", () => {
    expect(() => saleStanding(sale, [record(key(), 1n)])).not.toThrow();
    const foreign = { ...record(key(), 1n), mint: key() };
    expect(() => saleStanding(sale, [foreign])).toThrow(/was passed with/);
  });
});
