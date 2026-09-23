// The parts of the DBC builders that need no chain: the settings a Pangu sale
// forces, the cap written as a share of the curve, and the size guard that
// stops a transaction nobody could send.
//
// Does NOT cover: anything that reads an account. The whole life of a sale,
// including every builder here, is proven against Meteora's real programs by
// fork-test/life.ts, written up in docs/measurements/sdk-fork-test.md.

import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import {
  CollectFeeMode,
  MigrationOption,
  TokenAuthorityOption,
  TokenType,
  type BuildCurveParams,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  capFromShare,
  launchTemplateTransaction,
  panguCurve,
  requireOneTransaction,
  TRANSACTION_SIZE_LIMIT,
} from "../src/dbc/index.js";
import { PanguInputError } from "../src/inputs.js";

/** Only the three fields Pangu forces matter here, so the rest stays thin. */
const curve = {
  token: { totalTokenSupply: 1_000_000_000 },
  fee: { creatorTradingFeePercentage: 50 },
  migration: { migrationFeeOption: 0 },
} as unknown as BuildCurveParams;

const NO_CHAIN = {} as Connection;

describe("the settings a Pangu sale forces", () => {
  it("puts them in when the caller leaves them out", () => {
    const forced = panguCurve(curve);
    expect(forced.token.tokenType).toBe(TokenType.Token2022);
    expect(forced.fee.collectFeeMode).toBe(CollectFeeMode.QuoteToken);
    expect(forced.migration.migrationOption).toBe(MigrationOption.MET_DAMM_V2);
    expect(forced.token.tokenAuthorityOption).toBe(
      TokenAuthorityOption.CreatorUpdateAuthority
    );
  });

  it("leaves everything else alone", () => {
    const forced = panguCurve(curve);
    expect(forced.token.totalTokenSupply).toBe(1_000_000_000);
    expect(forced.fee.creatorTradingFeePercentage).toBe(50);
  });

  it("refuses a sale token that is not Token-2022", () => {
    expect(() =>
      panguCurve({ ...curve, token: { tokenType: TokenType.SPLToken } } as unknown as BuildCurveParams)
    ).toThrow(PanguInputError);
  });

  it("refuses fees collected in the sale token", () => {
    expect(() =>
      panguCurve({
        ...curve,
        fee: { collectFeeMode: CollectFeeMode.OutputToken },
      } as unknown as BuildCurveParams)
    ).toThrow(PanguInputError);
  });

  it("refuses a token whose mint authority would stay alive", () => {
    for (const option of [
      TokenAuthorityOption.CreatorUpdateAndMintAuthority,
      TokenAuthorityOption.PartnerUpdateAndMintAuthority,
    ]) {
      expect(() =>
        panguCurve({
          ...curve,
          token: { tokenAuthorityOption: option },
        } as unknown as BuildCurveParams)
      ).toThrow(/still be minted/);
    }
  });

  it("leaves an option that drops the mint authority as the issuer set it", () => {
    const forced = panguCurve({
      ...curve,
      token: { tokenAuthorityOption: TokenAuthorityOption.Immutable },
    } as unknown as BuildCurveParams);
    expect(forced.token.tokenAuthorityOption).toBe(TokenAuthorityOption.Immutable);
  });

  it("refuses graduation anywhere but DAMM v2", () => {
    expect(() =>
      panguCurve({
        ...curve,
        migration: { migrationOption: MigrationOption.MET_DAMM },
      } as unknown as BuildCurveParams)
    ).toThrow(PanguInputError);
  });

  it("refuses a hook program that is not Pangu, before it touches the chain", async () => {
    await expect(
      launchTemplateTransaction({
        connection: NO_CHAIN,
        partner: Keypair.generate().publicKey,
        quoteMint: Keypair.generate().publicKey,
        curve,
        transferHookProgram: Keypair.generate().publicKey,
      })
    ).rejects.toThrow(PanguInputError);
  });
});

describe("the cap as a share of the curve", () => {
  it("takes its share of what the curve sells", () => {
    expect(capFromShare(1_000_000_000n, 1_000)).toBe(100_000_000n);
    expect(capFromShare(1_000_000_000n, 9_999)).toBe(999_900_000n);
  });

  it("refuses a share below one basis point", () => {
    expect(() => capFromShare(1_000_000_000n, 0)).toThrow(PanguInputError);
  });

  it("refuses a share of the whole curve or more, which the chain answers CapCoversWholeSale", () => {
    expect(() => capFromShare(1_000_000_000n, 10_000)).toThrow(/below 10000 \(100 percent\)/);
    expect(() => capFromShare(1_000_000_000n, 10_001)).toThrow(PanguInputError);
  });

  it("refuses a share that rounds down to no tokens at all", () => {
    expect(() => capFromShare(100n, 1)).toThrow(PanguInputError);
  });
});

describe("the size guard", () => {
  function transaction(instructions: number): Transaction {
    const tx = new Transaction();
    for (let index = 0; index < instructions; index += 1) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: PublicKey.default,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        })
      );
    }
    tx.feePayer = PublicKey.default;
    tx.recentBlockhash = SystemProgram.programId.toBase58();
    return tx;
  }

  it("measures a transaction that fits", () => {
    const bytes = requireOneTransaction(transaction(1), "a test");
    expect(bytes > 0 && bytes < TRANSACTION_SIZE_LIMIT).toBe(true);
  });

  it("refuses one that nobody could send", () => {
    expect(() => requireOneTransaction(transaction(40), "a test")).toThrow(
      PanguInputError
    );
  });
});
