"use client";

import { LAMPORTS_PER_SOL, type Connection } from "@solana/web3.js";
import dynamic from "next/dynamic";
import { useState } from "react";

import { tokenAmount } from "@/lib/format";
import type { Target } from "@/lib/break";

import { Spinner } from "./strike";

// The wallet button reads the browser's injected wallets, so rendering it on
// the server would only produce markup the client replaces at once.
const WalletButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  { ssr: false, loading: () => <span className="block h-9 w-[132px] rounded-lg bg-raised" /> }
);

const AIRDROP_SOL = 0.5;
const FAUCET = "https://faucet.solana.com";

export function WalletStrip({
  connection,
  wallet,
  target,
  lamports,
  payingRaw,
  onFunded,
}: {
  connection: Connection;
  wallet: string | null;
  target: Target | null;
  lamports: number | null;
  payingRaw: bigint | null;
  onFunded: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [faucetNote, setFaucetNote] = useState<string | null>(null);

  const askFaucet = async () => {
    if (wallet === null) {
      return;
    }
    setAsking(true);
    setFaucetNote(null);
    try {
      const { PublicKey } = await import("@solana/web3.js");
      const signature = await connection.requestAirdrop(
        new PublicKey(wallet),
        AIRDROP_SOL * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(signature, "confirmed");
      setFaucetNote(`${AIRDROP_SOL} devnet SOL landed.`);
      onFunded();
    } catch {
      setFaucetNote(
        "The devnet faucet turned this wallet down, which it does when an address or an address range has asked recently. Take some from faucet.solana.com instead."
      );
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="border-t border-line pt-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <WalletButton />

        {wallet !== null && (
          <button
            type="button"
            onClick={askFaucet}
            disabled={asking}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors duration-200 hover:border-ink hover:text-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            {asking && <Spinner />}
            {asking ? "asking the faucet" : `take ${AIRDROP_SOL} devnet SOL`}
          </button>
        )}

        <a
          href={FAUCET}
          target="_blank"
          rel="noreferrer"
          className="border-b border-line pb-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-accent hover:text-accent"
        >
          faucet.solana.com
        </a>
      </div>

      <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        <div>
          <dt>your devnet SOL</dt>
          <dd className="mt-1.5 text-[15px] normal-case tracking-normal text-ink tabular-nums">
            {lamports === null ? "not connected" : (lamports / LAMPORTS_PER_SOL).toFixed(4)}
          </dd>
        </div>
        {target !== null && (
          <div>
            <dt>the token this sale is priced in</dt>
            <dd className="mt-1.5 text-[15px] normal-case tracking-normal text-ink tabular-nums">
              {payingRaw === null
                ? target.payingInSol
                  ? "wrapped SOL"
                  : "not connected"
                : `${tokenAmount(payingRaw, target.quoteDecimals)}${target.payingInSol ? " wrapped SOL" : ""}`}
            </dd>
          </div>
        )}
      </dl>

      {faucetNote !== null && (
        <p className="mt-4 max-w-[52ch] text-[13px] leading-relaxed text-muted">{faucetNote}</p>
      )}

      {target !== null && !target.payingInSol && payingRaw === 0n && (
        <p className="mt-4 max-w-[52ch] text-[13px] leading-relaxed text-muted">
          This sale is priced in a token minted for the demo, not in SOL, and your
          wallet holds none of it. The rows that spend it stop at the token program
          before the sale&apos;s rules are reached, and say so. The rows that spend
          nothing still run.
        </p>
      )}
    </div>
  );
}
