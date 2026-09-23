// The sale list and the directory built on it. Rules accounts are encoded with
// the IDL coder, the same bytes the program writes; the metadata fixture is the
// real devnet mint of PBAND2, read on 23 September 2026.
//
// Not covered: a live RPC. The connection is a stand-in that answers with
// bytes, so this proves the filters, the decoding, the skipping and how many
// calls a directory costs, and nothing about a node's paging or rate limits.
// Pool bytes are built here at the offsets the DBC IDL gives, not read from a
// real pool; the live directory run is what checks them against DBC.

import { describe, expect, it } from "vitest";
import { BN, BorshCoder, utils } from "@anchor-lang/core";
import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import type { AccountInfo, Connection } from "@solana/web3.js";
import {
  ACCESS_MODE,
  DBC_PROGRAM_ID,
  PANGU_IDL,
  PANGU_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  listSales,
  saleDirectory,
  saleRulesAddress,
  saleTokenInfo,
} from "../src/index.js";

const coder = new BorshCoder(PANGU_IDL);
const key = () => Keypair.generate().publicKey;

const PBAND2_MINT = new PublicKey("5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo");
const PBAND2_MINT_BYTES = Buffer.from(
  [
    "00000000000000000000000000000000000000000000000000000000000000000000000000c817a80400000009010000",
    "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    "00000000000000000000000000000000000000000001120040007cdf966774f16fd017ac5cab037693ac563dc2807fc2",
    "a68b223c45c2edd3335d42d2d42da36c80eac4712c156263dc023f4791948e655469ce704d18978f35300e004000da63",
    "681f7286bcc806719e2c2b50a20157243bfc9668b11520bc53843edcdb08321d0605779ff992105645ec78a0980ab89e",
    "286c9060ddfc65ba2a6a7dddeb171300a1007cdf966774f16fd017ac5cab037693ac563dc2807fc2a68b223c45c2edd3",
    "335d42d2d42da36c80eac4712c156263dc023f4791948e655469ce704d18978f35302300000050616e67752050726963",
    "65642053686172652c207365636f6e64206f66666572696e67060000005042414e44322800000068747470733a2f2f70",
    "616e67752e6578616d706c652f6465766e65742f7062616e64322e6a736f6e00000000",
  ].join(""),
  "hex"
);
/** Where the metadata pointer's target and the metadata's name length sit in that mint. */
const POINTER_TARGET_OFFSET = 202;
const NAME_LENGTH_OFFSET = 370;

const versionTwo = {
  mint: PBAND2_MINT,
  pool: key(),
  base_vault: key(),
  issuer: key(),
  cap: new BN(1_099_999_999),
  access_mode: ACCESS_MODE.open as number,
  credential: PublicKey.default,
  schema: PublicKey.default,
  price_account: key(),
  price_feed_id: Array.from({ length: 32 }, (_, i) => i),
  price_shard: 7_700,
  band_bps: 500,
  max_price_age_secs: 60,
  max_conf_bps: 100,
  base_decimals: 9,
  quote_decimals: 6,
  buyers: 3,
  total_net_bought: new BN(42),
  bump: 254,
  layout_version: 2,
  quote_mint: key(),
  ends_at: new BN(1_790_000_000),
  reserved: Array<number>(23).fill(0),
};

const versionOne = {
  ...versionTwo,
  mint: key(),
  pool: key(),
  access_mode: ACCESS_MODE.issuerList as number,
  price_account: PublicKey.default,
  price_feed_id: Array<number>(32).fill(0),
  price_shard: 0,
  band_bps: 0,
  max_price_age_secs: 0,
  max_conf_bps: 0,
  base_decimals: 0,
  quote_decimals: 0,
  buyers: 1,
  layout_version: 1,
  quote_mint: PublicKey.default,
  ends_at: new BN(0),
};

type Stored = { data: Buffer; owner: PublicKey };

async function rules(fields: typeof versionTwo): Promise<[PublicKey, Stored]> {
  return [
    saleRulesAddress(fields.mint),
    { data: await coder.accounts.encode("SaleRules", fields), owner: PANGU_PROGRAM_ID },
  ];
}

/** A DBC transfer hook pool with the fields the directory reads, at the IDL's offsets. */
function hookPool(mint: PublicKey, migrationProgress: number): Stored {
  const data = Buffer.alloc(424);
  Buffer.from([237, 219, 184, 23, 42, 189, 169, 35]).copy(data, 0);
  mint.toBuffer().copy(data, 136);
  data.writeUInt8(migrationProgress, 308);
  return { data, owner: DBC_PROGRAM_ID };
}

function clockAt(unix: number): Stored {
  const data = Buffer.alloc(40);
  data.writeBigInt64LE(BigInt(unix), 32);
  return { data, owner: new PublicKey("Sysvar1111111111111111111111111111111111111") };
}

function stand(scanned: [PublicKey, Stored][], accounts: Map<string, Stored> = new Map()) {
  const calls = { scans: [] as unknown[], batches: [] as number[] };
  const asInfo = (found: Stored | undefined): AccountInfo<Buffer> | null =>
    found === undefined ? null : { ...found, executable: false, lamports: 1, rentEpoch: 0 };
  const connection = {
    getAccountInfo: async (address: PublicKey) => asInfo(accounts.get(address.toBase58())),
    getMultipleAccountsInfo: async (addresses: PublicKey[]) => {
      calls.batches.push(addresses.length);
      return addresses.map((address) => asInfo(accounts.get(address.toBase58())));
    },
    getProgramAccounts: async (_program: PublicKey, config: { filters?: unknown }) => {
      calls.scans.push(config.filters);
      return scanned.map(([pubkey, account]) => ({ pubkey, account: asInfo(account) }));
    },
  } as unknown as Connection;
  return { connection, calls };
}

describe("listSales", () => {
  it("asks the node for SaleRules accounts only, by discriminator and by size", async () => {
    const { connection, calls } = stand([]);
    await listSales(connection);
    const discriminator = PANGU_IDL.accounts!.find((a) => a.name === "SaleRules")!.discriminator;
    expect(calls.scans).toEqual([
      [
        { dataSize: 362 },
        { memcmp: { offset: 0, bytes: utils.bytes.bs58.encode(Buffer.from(discriminator)) } },
      ],
    ]);
  });

  it("reads a version 2 sale and a version 1 sale", async () => {
    const { connection } = stand([await rules(versionTwo), await rules(versionOne)]);
    const [two, one] = await listSales(connection);
    expect(two?.mint.equals(PBAND2_MINT)).toBe(true);
    expect(two?.quoteMint?.equals(versionTwo.quote_mint)).toBe(true);
    expect(two?.endsAt).toBe(1_790_000_000);
    expect(two?.hasBand).toBe(true);
    expect(one?.layoutVersion).toBe(1);
    expect(one?.quoteMint).toBeNull();
    expect(one?.endsAt).toBeNull();
    expect(one?.accessMode).toBe(ACCESS_MODE.issuerList);
  });

  it("skips and reports an unknown layout and rules at the wrong address, and lists the rest", async () => {
    const unknown = await rules({ ...versionTwo, mint: key(), layout_version: 3 });
    const [, stray] = await rules({ ...versionOne, mint: key() });
    const strayAddress = key();
    const { connection } = stand([unknown, [strayAddress, stray], await rules(versionTwo)]);
    const skipped: [string, string][] = [];
    const sales = await listSales(connection, {
      onSkipped: (address, reason) => skipped.push([address.toBase58(), reason]),
    });
    expect(sales).toHaveLength(1);
    expect(sales[0]?.mint.equals(PBAND2_MINT)).toBe(true);
    expect(skipped).toHaveLength(2);
    expect(skipped[0]?.[0]).toBe(unknown[0].toBase58());
    expect(skipped[0]?.[1]).toMatch(/layout version 3/);
    expect(skipped[1]?.[0]).toBe(strayAddress.toBase58());
    expect(skipped[1]?.[1]).toMatch(/live at another address/);
  });
});

describe("saleTokenInfo", () => {
  const withMint = (data: Buffer, owner = TOKEN_2022_PROGRAM_ID) =>
    stand([], new Map([[PBAND2_MINT.toBase58(), { data, owner }]])).connection;

  it("reads the name, symbol and link out of the real mint's metadata", async () => {
    expect(await saleTokenInfo(withMint(PBAND2_MINT_BYTES), PBAND2_MINT)).toEqual({
      name: "Pangu Priced Share, second offering",
      symbol: "PBAND2",
      uri: "https://pangu.example/devnet/pband2.json",
    });
  });

  it("answers null for a missing mint, a mint of another program, and a pointer elsewhere", async () => {
    expect(await saleTokenInfo(stand([]).connection, PBAND2_MINT)).toBeNull();
    expect(
      await saleTokenInfo(withMint(PBAND2_MINT_BYTES, DBC_PROGRAM_ID), PBAND2_MINT)
    ).toBeNull();
    const repointed = Buffer.from(PBAND2_MINT_BYTES);
    key().toBuffer().copy(repointed, POINTER_TARGET_OFFSET);
    expect(await saleTokenInfo(withMint(repointed), PBAND2_MINT)).toBeNull();
  });

  it("answers null when a length runs past the end of the metadata", async () => {
    const overlong = Buffer.from(PBAND2_MINT_BYTES);
    overlong.writeUInt32LE(0xffff_ffff, NAME_LENGTH_OFFSET);
    expect(await saleTokenInfo(withMint(overlong), PBAND2_MINT)).toBeNull();
  });
});

describe("saleDirectory", () => {
  it("names each sale and reads running, graduated and the offering from the chain", async () => {
    const accounts = new Map<string, Stored>([
      [SYSVAR_CLOCK_PUBKEY.toBase58(), clockAt(1_790_000_000)],
      [PBAND2_MINT.toBase58(), { data: PBAND2_MINT_BYTES, owner: TOKEN_2022_PROGRAM_ID }],
      [versionTwo.pool.toBase58(), hookPool(PBAND2_MINT, 0)],
      [versionOne.pool.toBase58(), hookPool(versionOne.mint, 1)],
    ]);
    const { connection } = stand([await rules(versionTwo), await rules(versionOne)], accounts);
    const [two, one] = await saleDirectory(connection);

    expect(two).toMatchObject({
      name: "Pangu Priced Share, second offering",
      symbol: "PBAND2",
      running: true,
      graduated: false,
      offeringOver: true,
      hasBand: true,
      endsAt: 1_790_000_000,
      buyers: 3,
    });
    expect(two?.issuer.equals(versionTwo.issuer)).toBe(true);
    expect(one).toMatchObject({
      name: null,
      symbol: null,
      running: false,
      graduated: true,
      offeringOver: false,
      quoteMint: null,
      accessMode: ACCESS_MODE.issuerList,
    });
  });

  it("shows graduated as unknown when the pool is not the hook pool selling this mint", async () => {
    const accounts = new Map<string, Stored>([
      [versionTwo.pool.toBase58(), hookPool(key(), 1)],
      [versionOne.pool.toBase58(), { ...hookPool(versionOne.mint, 1), owner: key() }],
    ]);
    const { connection } = stand([await rules(versionTwo), await rules(versionOne)], accounts);
    const entries = await saleDirectory(connection);
    expect(entries.map((entry) => entry.graduated)).toEqual([null, null]);
  });

  it("reads fifty sales in one scan and two batched calls", async () => {
    const scanned = await Promise.all(
      Array.from({ length: 50 }, () => rules({ ...versionTwo, mint: key(), pool: key() }))
    );
    const { connection, calls } = stand(scanned);
    expect(await saleDirectory(connection)).toHaveLength(50);
    expect(calls.scans).toHaveLength(1);
    expect(calls.batches).toEqual([100, 1]);
  });
});
