"use client";

import type { Connection } from "@solana/web3.js";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import type { IssuedCredential } from "pangu-sdk";

import { Strike } from "@/components/break/strike";
import {
  VerifyError,
  explorerAddress,
  revokeTransaction,
  shortKey,
  simulateSignSend,
  type Phase,
  type VerifierPair,
  type VerifyWallet,
} from "@/lib/verify";

import { CopyButton, Failure, Landed, PhaseLine, QUIET_BUTTON, StepHead, utcDate } from "./bits";

/** Where one row's revoke has got to. */
type RowState =
  | { kind: "running"; phase: Phase }
  | { kind: "revoked"; signature: string }
  | { kind: "failed"; message: string; detail: string | null };

/** Step 03. Everything issued under the verifier, read off devnet, with a revoke on each row. */
export function IssuedList({
  connection,
  wallet,
  pair,
  items,
  reading,
  failure,
  onReadAgain,
  onRevoked,
  issueTurn,
}: {
  connection: Connection;
  wallet: VerifyWallet | null;
  pair: VerifierPair | null;
  items: readonly IssuedCredential[] | null;
  reading: boolean;
  failure: string | null;
  onReadAgain: () => void;
  onRevoked: (wallet: string) => void;
  /** Bumped on every issue, so a wallet revoked and issued again is not shown struck through. */
  issueTurn: number;
}) {
  const still = useReducedMotion() === true;
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [rowsFor, setRowsFor] = useState(issueTurn);
  if (rowsFor !== issueTurn) {
    setRowsFor(issueTurn);
    setRows({});
  }

  const revoke = async (item: IssuedCredential) => {
    if (wallet === null || pair === null) {
      return;
    }
    const key = item.wallet.toBase58();
    const setRow = (state: RowState) => setRows((current) => ({ ...current, [key]: state }));
    setRow({ kind: "running", phase: "reading" });
    try {
      const signatures = await simulateSignSend(
        connection,
        wallet,
        [revokeTransaction(wallet.publicKey, pair, item.wallet)],
        (phase) => setRow({ kind: "running", phase })
      );
      setRow({ kind: "revoked", signature: signatures[0] as string });
      onRevoked(key);
    } catch (error) {
      setRow(
        error instanceof VerifyError
          ? { kind: "failed", message: error.message, detail: error.detail }
          : {
              kind: "failed",
              message: "Devnet did not answer. Check the connection and press again.",
              detail: error instanceof Error ? error.message : String(error),
            }
      );
    }
  };

  const valid = items?.filter((item) => item.standing === "valid").length ?? 0;
  const revokedHere = Object.entries(rows).filter(([, state]) => state.kind === "revoked");

  return (
    <div data-testid="verify-list" className={pair === null ? "opacity-50" : undefined}>
      <StepHead index="03" title="Issued credentials">
        {pair !== null && (
          <button
            type="button"
            onClick={onReadAgain}
            disabled={reading}
            className={QUIET_BUTTON}
          >
            {reading ? "reading" : "read again"}
          </button>
        )}
      </StepHead>

      {pair === null && <p className="mt-6 text-[14px] text-muted">Nothing issued yet.</p>}

      {pair !== null && reading && items === null && (
        <div className="mt-6">
          <PhaseLine phase="reading" testId="verify-list-reading" />
          <p className="mt-2 text-[13px] text-muted">
            Reading every credential under your schema, and when each was issued. A long list takes a few seconds.
          </p>
        </div>
      )}

      {pair !== null && failure !== null && (
        <div className="mt-6">
          <Failure message={failure} />
        </div>
      )}

      {pair !== null && items !== null && (
        <>
          <p data-testid="verify-list-count" className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            {items.length === 0
              ? "none issued yet"
              : `${items.length} issued, ${valid} valid, ${items.length - valid} expired`}
          </p>

          {items.length > 0 && (
            <div className="mt-4 hidden grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 border-b border-line pb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted md:grid">
              <span>wallet</span>
              <span>state</span>
              <span>expires</span>
              <span>issued</span>
              <span className="w-[92px]" />
            </div>
          )}

          <ul className="border-b border-line md:border-b-0">
            <AnimatePresence initial={false}>
              {items.map((item) => {
                const key = item.wallet.toBase58();
                const state = rows[key];
                const struck = state?.kind === "revoked";
                return (
                  <motion.li
                    key={key}
                    layout={!still}
                    data-testid="verify-row"
                    data-wallet={key}
                    data-standing={struck ? "revoked" : item.standing}
                    initial={still ? false : { opacity: 0, y: 16 }}
                    animate={{ opacity: struck ? 0.55 : 1, y: 0 }}
                    exit={still ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: still ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="group relative border-t border-line py-4 md:border-t-0 md:border-b"
                  >
                    <Strike shown={struck} tone="refused" />
                    <div className="relative grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                      <div className="col-span-2 flex items-center gap-3 md:col-span-1">
                        <a
                          href={explorerAddress(item.address)}
                          target="_blank"
                          rel="noreferrer"
                          title={key}
                          className="font-mono text-[14px] tabular-nums transition-colors hover:text-accent"
                        >
                          {shortKey(key)}
                        </a>
                        <CopyButton value={key} label="wallet" />
                      </div>
                      <Standing standing={struck ? "revoked" : item.standing} />
                      <Cell label="expires">{item.expiry === 0 ? "never" : utcDate(item.expiry)}</Cell>
                      <Cell label="issued">{item.created === null ? "not found" : utcDate(item.created)}</Cell>
                      <div className="col-span-2 flex justify-start md:col-span-1 md:justify-end">
                        {struck ? (
                          <span className="inline-flex h-9 w-[92px] items-center font-mono text-[11px] uppercase tracking-[0.14em] text-refused">
                            revoked
                          </span>
                        ) : (
                          <button
                            type="button"
                            data-testid="verify-revoke"
                            onClick={() => void revoke(item)}
                            disabled={wallet === null || !pair.canSign || state?.kind === "running"}
                            className={`${QUIET_BUTTON} w-[92px] justify-center hover:border-refused hover:text-refused`}
                          >
                            revoke
                          </button>
                        )}
                      </div>
                    </div>
                    {state?.kind === "running" && (
                      <div className="relative mt-3">
                        <PhaseLine phase={state.phase} />
                      </div>
                    )}
                    {state?.kind === "failed" && (
                      <div className="relative mt-3">
                        <Failure message={state.message} detail={state.detail} testId="verify-revoke-failure" />
                      </div>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>

          {revokedHere.length > 0 && (
            <div className="mt-5 space-y-2">
              <p className="max-w-[56ch] text-[13px] text-muted">
                Revoked on devnet. The deposit came back to your wallet, and the next buy from that
                wallet in a credential-mode sale is refused.
              </p>
              <Landed
                testId="verify-revoke-landed"
                signatures={revokedHere.map(([, state]) => (state as { signature: string }).signature)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Standing({ standing }: { standing: "valid" | "expired" | "revoked" }) {
  const tone = standing === "valid" ? "text-accent" : "text-refused";
  return (
    <div>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted md:hidden">state</span>
      <p className={`flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] ${tone}`}>
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${standing === "valid" ? "bg-accent" : "bg-refused"}`}
        />
        {standing}
      </p>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted md:hidden">{label}</span>
      <p className="text-[14px] tabular-nums">{children}</p>
    </div>
  );
}
