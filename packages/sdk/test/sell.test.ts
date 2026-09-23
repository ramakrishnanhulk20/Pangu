// Building a sell for a sale whose rules this package cannot read.
//
// On chain the hook lets a sell through whatever the rules account holds (C5),
// so the client must not be the thing that traps a holder. Here the rules
// account is one an older build wrote, either the right size with layout
// version 0 or the 427 bytes such a sale really holds on devnet, and the sell
// is built anyway, against the pool DBC reports for the mint.
//
// Does NOT cover: Meteora's quote maths and the hook account resolution, which
// are stood in for here and proven against the live programs by
// fork-test/life.ts, or whether the program accepts the sell, which is the
// program's own layout test.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BN, BorshCoder, utils } from "@anchor-lang/core";
import {
  Keypair,
  PublicKey,
  type AccountInfo,
  type AccountMeta,
  type Connection,
} from "@solana/web3.js";
import { DBC_PROGRAM_ID, PANGU_IDL, PANGU_PROGRAM_ID, saleRulesAddress } from "../src/index.js";

vi.mock("../src/dbc/quote.js", () => ({
  quoteExactIn: vi.fn(),
  quoteExactOut: vi.fn(),
  quotePartialFill: vi.fn(),
}));
vi.mock("../src/dbc/hook.js", async (original) => ({
  ...(await original<typeof import("../src/dbc/hook.js")>()),
  hookAccounts: vi.fn(),
}));

const { quoteExactIn } = await import("../src/dbc/quote.js");
const { hookAccounts } = await import("../src/dbc/hook.js");
const { buyTransaction, sellTransaction } = await import("../src/dbc/trade.js");

const here = dirname(fileURLToPath(import.meta.url));
/** A real launch template, dumped from mainnet, so Meteora's own reader decodes it. */
const LIVE_CONFIG = readFileSync(join(here, "..", "..", "program", "feeds", "live-config.bin"));

const HOOK_POOL_DISCRIMINATOR = Buffer.from([237, 219, 184, 23, 42, 189, 169, 35]);
const HOOK_POOL_LEN = 424;

const coder = new BorshCoder(PANGU_IDL);
const key = () => Keypair.generate().publicKey;

interface Stored {
  data: Buffer;
  owner: PublicKey;
}

/** A DBC transfer hook pool, zero everywhere Pangu does not read. */
function hookPool(fields: {
  config: PublicKey;
  creator: PublicKey;
  baseMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
}): Buffer {
  const data = Buffer.alloc(HOOK_POOL_LEN);
  HOOK_POOL_DISCRIMINATOR.copy(data, 0);
  fields.config.toBuffer().copy(data, 72);
  fields.creator.toBuffer().copy(data, 104);
  fields.baseMint.toBuffer().copy(data, 136);
  fields.baseVault.toBuffer().copy(data, 168);
  fields.quoteVault.toBuffer().copy(data, 200);
  return data;
}

/**
 * A chain that answers from a map, including DBC's getProgramAccounts with its
 * memcmp and size filters applied the way a node applies them.
 */
function chainWith(accounts: Map<string, Stored>) {
  const asInfo = (stored: Stored): AccountInfo<Buffer> => ({
    ...stored,
    executable: false,
    lamports: 1_000_000,
    rentEpoch: 0,
  });
  const scans: unknown[] = [];
  const read = (address: PublicKey) => {
    const found = accounts.get(address.toBase58());
    return found === undefined ? null : asInfo(found);
  };
  const connection = {
    getAccountInfo: async (address: PublicKey) => read(address),
    getAccountInfoAndContext: async (address: PublicKey) => ({
      context: { slot: 400_000_000 },
      value: read(address),
    }),
    getProgramAccounts: async (
      program: PublicKey,
      config: { filters?: ({ memcmp: { offset: number; bytes: string } } | { dataSize: number })[] }
    ) => {
      scans.push(config.filters);
      return [...accounts.entries()]
        .filter(([, stored]) => stored.owner.equals(program))
        .filter(([, stored]) =>
          (config.filters ?? []).every((filter) => {
            if ("dataSize" in filter) {
              return stored.data.length === filter.dataSize;
            }
            const wanted = Buffer.from(utils.bytes.bs58.decode(filter.memcmp.bytes));
            return stored.data
              .subarray(filter.memcmp.offset, filter.memcmp.offset + wanted.length)
              .equals(wanted);
          })
        )
        .map(([address, stored]) => ({ pubkey: new PublicKey(address), account: asInfo(stored) }));
    },
    getSlot: async () => 400_000_000,
    getBlockTime: async () => 1_790_000_000,
    getLatestBlockhash: async () => ({
      blockhash: key().toBase58(),
      lastValidBlockHeight: 1,
    }),
  } as unknown as Connection;
  return { connection, scans };
}

const mint = key();
const seller = key();
const config = key();
const pool = key();
const baseVault = key();
const quoteVault = key();

/** SaleRules bytes an older build wrote: the current layout with version 0. */
async function versionZeroRules(): Promise<Buffer> {
  return coder.accounts.encode("SaleRules", {
    mint,
    pool,
    base_vault: baseVault,
    issuer: key(),
    cap: new BN(1_000),
    access_mode: 0,
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
    bump: 255,
    layout_version: 0,
    quote_mint: PublicKey.default,
    ends_at: new BN(0),
    reserved: Array<number>(23).fill(0),
  });
}

function chainHolding(rules: Buffer) {
  return chainWith(
    new Map<string, Stored>([
      [saleRulesAddress(mint).toBase58(), { data: rules, owner: PANGU_PROGRAM_ID }],
      [
        pool.toBase58(),
        {
          data: hookPool({ config, creator: key(), baseMint: mint, baseVault, quoteVault }),
          owner: DBC_PROGRAM_ID,
        },
      ],
      // Another mint's pool, which the scan must leave out.
      [
        key().toBase58(),
        {
          data: hookPool({ config, creator: key(), baseMint: key(), baseVault: key(), quoteVault: key() }),
          owner: DBC_PROGRAM_ID,
        },
      ],
      [config.toBase58(), { data: LIVE_CONFIG, owner: DBC_PROGRAM_ID }],
    ])
  );
}

const hookMetas: AccountMeta[] = [
  { pubkey: key(), isSigner: false, isWritable: false },
  { pubkey: saleRulesAddress(mint), isSigner: false, isWritable: true },
  { pubkey: PANGU_PROGRAM_ID, isSigner: false, isWritable: false },
];

beforeEach(() => {
  vi.mocked(quoteExactIn).mockReset().mockReturnValue({
    outputAmount: 9_000n,
    minimumAmountOut: 8_900n,
    nextSqrtPrice: 1n << 64n,
  });
  vi.mocked(hookAccounts).mockReset().mockResolvedValue(hookMetas);
});

describe("a sell against rules this package cannot read", () => {
  const cases: [string, () => Promise<Buffer>][] = [
    ["the right size with layout version 0", versionZeroRules],
    [
      "427 bytes, the size an older build's rules are on devnet",
      async () => Buffer.concat([await versionZeroRules(), Buffer.alloc(427 - 362)]),
    ],
  ];

  for (const [name, rulesOf] of cases) {
    it(`is still built when the rules are ${name}`, async () => {
      const rules = await rulesOf();
      const { connection, scans } = chainHolding(rules);

      const sell = await sellTransaction({ connection, seller, mint, amountIn: 1_000n });

      // The pool came from DBC, found by the mint it sells.
      expect(scans).toHaveLength(1);
      const swap = sell.transaction.instructions.at(-1)!;
      expect(swap.programId.equals(DBC_PROGRAM_ID)).toBe(true);
      expect(swap.keys.some((meta) => meta.pubkey.equals(pool))).toBe(true);
      // The hook's own accounts ride along, resolved for a transfer into the vault.
      for (const meta of hookMetas) {
        expect(swap.keys.some((entry) => entry.pubkey.equals(meta.pubkey))).toBe(true);
      }
      const asked = vi.mocked(hookAccounts).mock.calls[0]![0];
      expect(asked.mint.equals(mint)).toBe(true);
      expect(asked.destination.equals(baseVault)).toBe(true);
      expect(asked.amount).toBe(1_000n);
      expect(sell.expectedAmountOut).toBe(9_000n);
    });

    it(`still refuses a buy when the rules are ${name}`, async () => {
      const { connection } = chainHolding(await rulesOf());
      await expect(
        buyTransaction({ connection, buyer: seller, mint, amountIn: 1_000n })
      ).rejects.toThrow(/another build of the program/);
    });
  }

  it("refuses to guess when no pool sells the mint", async () => {
    const { connection } = chainWith(
      new Map<string, Stored>([
        [saleRulesAddress(mint).toBase58(), { data: await versionZeroRules(), owner: PANGU_PROGRAM_ID }],
      ])
    );
    await expect(
      sellTransaction({ connection, seller, mint, amountIn: 1_000n })
    ).rejects.toThrow(/no Meteora transfer hook pool sells/);
  });
});
