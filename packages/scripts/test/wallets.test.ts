// What a throwaway buyer is funded with on each kind of sale, and the sweep
// that brings its devnet SOL back even when the run dies partway.
//
// Does NOT cover: a real node. The sweep runs against a stand-in that accepts
// every transaction, so a node refusing the sweep itself is left to the devnet
// runs, where returnLeftovers retries once and then names the wallet.

import { describe, expect, it } from "vitest";
import {
  Keypair,
  SystemInstruction,
  Transaction,
  type Connection,
  type PublicKey,
} from "@solana/web3.js";
import { buyerFunding, withThrowawayWallets } from "../src/wallets.js";

const OVERHEAD = 12_000_000;

describe("funding a throwaway buyer", () => {
  it("hands a SOL sale's buyer the buy and the overhead in lamports", () => {
    expect(buyerFunding(true, 10_000_000n, OVERHEAD)).toEqual({
      lamports: 22_000_000,
      quoteTokens: 0n,
    });
  });

  it("hands a dollar sale's buyer the buy in dollars and only the overhead in SOL", () => {
    // 3,710 dollars of a six decimal token. Sent as lamports, this was 3.7 SOL
    // that the failed buy left in a wallet whose key was then thrown away.
    expect(buyerFunding(false, 3_710_000_000n, OVERHEAD)).toEqual({
      lamports: OVERHEAD,
      quoteTokens: 3_710_000_000n,
    });
  });
});

/** A node that holds a balance for each wallet and accepts every transaction sent. */
function acceptingNode() {
  const balances = new Map<string, number>();
  const sent: { from: PublicKey; to: PublicKey; lamports: bigint }[] = [];
  const blockhash = Keypair.generate().publicKey.toBase58();
  const node = {
    getBalance: async (wallet: PublicKey) => balances.get(wallet.toBase58()) ?? 0,
    getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 1_000 }),
    sendRawTransaction: async (raw: Uint8Array) => {
      const transfer = SystemInstruction.decodeTransfer(
        Transaction.from(raw).instructions[0] as never
      );
      sent.push({ from: transfer.fromPubkey, to: transfer.toPubkey, lamports: transfer.lamports });
      balances.set(transfer.fromPubkey.toBase58(), 0);
      return `signature-${sent.length}`;
    },
    confirmTransaction: async () => ({ context: { slot: 1 }, value: { err: null } }),
    getTransaction: async () => ({
      meta: { logMessages: [], fee: 5_000, computeUnitsConsumed: 150 },
    }),
  };
  return { node: node as unknown as Connection, balances, sent };
}

describe("sweeping the throwaway wallets", () => {
  const payer = Keypair.generate();

  it("brings every wallet's SOL back when the run throws partway", async () => {
    const { node, balances, sent } = acceptingNode();
    const made: Keypair[] = [];
    const run = withThrowawayWallets(node, payer, async (fresh) => {
      for (let each = 0; each < 3; each += 1) {
        const wallet = fresh();
        made.push(wallet);
        balances.set(wallet.publicKey.toBase58(), 22_000_000);
      }
      throw new Error("429 Too Many Requests");
    });

    await expect(run).rejects.toThrow("429 Too Many Requests");
    expect(sent).toHaveLength(3);
    for (const [index, wallet] of made.entries()) {
      expect(sent[index]?.from.equals(wallet.publicKey)).toBe(true);
      expect(sent[index]?.to.equals(payer.publicKey)).toBe(true);
      expect(sent[index]?.lamports).toBe(22_000_000n - 5_000n);
    }
  });

  it("sweeps after a run that finished and says how much came back", async () => {
    const { node, balances } = acceptingNode();
    const { result, returned } = await withThrowawayWallets(node, payer, async (fresh) => {
      balances.set(fresh().publicKey.toBase58(), 1_005_000);
      return "filled";
    });
    expect(result).toBe("filled");
    expect(returned).toBe(1_000_000);
  });
});
