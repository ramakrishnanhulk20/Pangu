"use client";

import { LAMPORTS_PER_SOL, type Connection } from "@solana/web3.js";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { tokenAmount } from "@/lib/format";
import type { Target } from "@/lib/break";
import { CHAIN, DEMO_DOLLARS_ON, FAUCET_ON, explorerTx } from "@/lib/network";

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

/** What POST /api/break/dollars answers with when it mints. */
interface Granted {
  signature: string;
  /** Raw units, as a string: JSON has no bigint. */
  amount: string;
  decimals: number;
  mint: string;
}

function reasonOf(answer: unknown): string | null {
  const reason = (answer as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" && reason !== "" ? reason : null;
}

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
  const [minting, setMinting] = useState(false);
  const [granted, setGranted] = useState<Granted | null>(null);
  const [dollarNote, setDollarNote] = useState<string | null>(null);

  // The notes and the "demo dollars landed" line belong to the wallet that
  // asked. A new wallet, or none, starts with a clean strip.
  const [shownFor, setShownFor] = useState(wallet);
  if (shownFor !== wallet) {
    setShownFor(wallet);
    setAsking(false);
    setFaucetNote(null);
    setMinting(false);
    setGranted(null);
    setDollarNote(null);
  }

  // The wallet on screen now, for an answer that arrives after a switch to check against.
  const walletNow = useRef(wallet);
  useEffect(() => {
    walletNow.current = wallet;
  }, [wallet]);

  const askFaucet = async () => {
    if (wallet === null) {
      return;
    }
    const asked = wallet;
    const stillHere = () => walletNow.current === asked;
    setAsking(true);
    setFaucetNote(null);
    try {
      const { PublicKey } = await import("@solana/web3.js");
      const signature = await connection.requestAirdrop(
        new PublicKey(asked),
        AIRDROP_SOL * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(signature, "confirmed");
      if (stillHere()) {
        setFaucetNote(`${AIRDROP_SOL} ${CHAIN.sol} landed.`);
        onFunded();
      }
    } catch {
      if (stillHere()) {
        setFaucetNote(
          `The ${CHAIN.inSentence} faucet turned this wallet down, which it does when an address or an address range has asked recently. Take some from faucet.solana.com instead.`
        );
      }
    } finally {
      if (stillHere()) {
        setAsking(false);
      }
    }
  };

  const askDollars = async () => {
    if (wallet === null) {
      return;
    }
    const asked = wallet;
    const stillHere = () => walletNow.current === asked;
    setMinting(true);
    setDollarNote(null);
    setGranted(null);
    try {
      const response = await fetch("/api/break/dollars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: asked }),
      });
      const answer: unknown = await response.json();
      if (!stillHere()) {
        return;
      }
      if (!response.ok) {
        setDollarNote(
          reasonOf(answer) ??
            "The demo dollar mint turned this down and gave no reason. Try again in a moment."
        );
        return;
      }
      setGranted(answer as Granted);
      // The balance on this strip and every row's sums are read again once the
      // grant has landed, so nothing on screen is this component's guess.
      onFunded();
    } catch {
      if (stillHere()) {
        setDollarNote(
          "This page could not reach the demo dollar mint. Check the connection and press it again."
        );
      }
    } finally {
      if (stillHere()) {
        setMinting(false);
      }
    }
  };

  const dollarsOffered = DEMO_DOLLARS_ON && target !== null && !target.payingInSol;

  return (
    <div className="border-t border-line pt-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <WalletButton />

        {wallet !== null && FAUCET_ON && (
          <button
            type="button"
            onClick={askFaucet}
            disabled={asking}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors duration-200 hover:border-ink hover:text-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            {asking && <Spinner />}
            {asking ? "asking the faucet" : `take ${AIRDROP_SOL} ${CHAIN.sol}`}
          </button>
        )}

        {FAUCET_ON && (
          <a
            href={FAUCET}
            target="_blank"
            rel="noreferrer"
            className="border-b border-line pb-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-accent hover:text-accent"
          >
            faucet.solana.com
          </a>
        )}
      </div>

      <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        <div>
          <dt>your {CHAIN.sol}</dt>
          <dd className="mt-1.5 text-[15px] normal-case tracking-normal text-ink tabular-nums">
            {lamports !== null
              ? (lamports / LAMPORTS_PER_SOL).toFixed(4)
              : wallet === null
                ? "not connected"
                : `reading ${CHAIN.inSentence}`}
          </dd>
        </div>
        {target !== null && (
          <div>
            <dt>the token this sale is priced in</dt>
            <dd className="mt-1.5 text-[15px] normal-case tracking-normal text-ink tabular-nums">
              {payingRaw === null
                ? target.payingInSol
                  ? "wrapped SOL"
                  : wallet === null
                    ? "not connected"
                    : `reading ${CHAIN.inSentence}`
                : `${tokenAmount(payingRaw, target.quoteDecimals)}${target.payingInSol ? " wrapped SOL" : ""}`}
            </dd>
            {dollarsOffered && (
              <dd className="mt-3">
                <button
                  type="button"
                  onClick={askDollars}
                  disabled={minting || wallet === null}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-accent px-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-accent transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent hover:text-accent-ink disabled:translate-y-0 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
                >
                  {minting && <Spinner />}
                  {minting ? `minting on ${CHAIN.inSentence}` : "get demo dollars"}
                </button>
              </dd>
            )}
          </div>
        )}
      </dl>

      {dollarsOffered && wallet === null && (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          connect {CHAIN.wallet} first
        </p>
      )}

      {granted !== null && (
        <p className="mt-4 max-w-[52ch] text-[13px] leading-relaxed text-muted">
          {tokenAmount(BigInt(granted.amount), granted.decimals)} demo dollars landed:
          four times what this sale&apos;s cap is worth at the price on the curve
          right now, plus what the buy above the ceiling pays. That runs 01, 02 or
          04, 03 and 08 in order.{" "}
          <a
            href={explorerTx(granted.signature)}
            target="_blank"
            rel="noreferrer"
            className="border-b border-line pb-0.5 text-ink transition-colors hover:border-accent hover:text-accent"
          >
            open the transaction
          </a>
        </p>
      )}

      {dollarNote !== null && (
        <p className="mt-4 max-w-[52ch] text-[13px] leading-relaxed text-muted">{dollarNote}</p>
      )}

      {faucetNote !== null && (
        <p className="mt-4 max-w-[52ch] text-[13px] leading-relaxed text-muted">{faucetNote}</p>
      )}

      {dollarsOffered && payingRaw === 0n && granted === null && (
        <p className="mt-4 max-w-[52ch] text-[13px] leading-relaxed text-muted">
          This sale is priced in a token minted for the demo, not in SOL, and your
          wallet holds none of it. Take some above and every row on the ledger is
          yours to run, including the buy, the send and the sell back.
        </p>
      )}
    </div>
  );
}
