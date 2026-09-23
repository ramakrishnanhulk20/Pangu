"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { readLanded } from "@/lib/break";
import { CHAIN } from "@/lib/network";
import type { Signable } from "@/lib/issuer";
import { messageOf, simulate } from "@/lib/trade";
import type { PanguErrorName } from "pangu-sdk";

/** Where one action has got to. Every state a visitor can see has words. */
export type ActionStep =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "signing"; part: number; parts: number }
  | { kind: "pending"; signature: string; part: number; parts: number }
  | { kind: "landed"; signatures: string[] }
  | { kind: "refused"; sentence: string; advice: string | null; signature: string | null }
  | { kind: "failed"; message: string; signature: string | null };

export const IDLE: ActionStep = { kind: "idle" };

export function busy(step: ActionStep): boolean {
  return step.kind === "checking" || step.kind === "signing" || step.kind === "pending";
}

/**
 * Runs one action the way every action on the sale page runs: build, simulate
 * against the chain, and only when the chain would take it, ask the wallet to
 * sign. Then wait for the chain to confirm, and say what happened with a link.
 *
 * An action of several transactions runs them in order and stops at the first
 * one the chain would refuse, before the wallet is asked for it.
 */
export function useChainAction(connection: Connection) {
  const { sendTransaction, publicKey } = useWallet();
  const { connection: walletConnection } = useConnection();
  const [step, setStep] = useState<ActionStep>(IDLE);
  const mounted = useRef(true);
  const wallet = publicKey?.toBase58() ?? null;
  const walletNow = useRef(wallet);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    walletNow.current = wallet;
  }, [wallet]);

  // A different wallet starts with a clean slate: a result belongs to the wallet that signed it.
  const [stepFor, setStepFor] = useState(wallet);
  if (stepFor !== wallet) {
    setStepFor(wallet);
    setStep(IDLE);
  }

  const run = useCallback(
    async (
      build: () => Promise<Signable[]>,
      advise: (error: PanguErrorName | null) => string | null
    ): Promise<boolean> => {
      const startedFor = walletNow.current;
      const show = (next: ActionStep) => {
        if (mounted.current && walletNow.current === startedFor) {
          setStep(next);
        }
      };
      show({ kind: "checking" });
      let parts: Signable[];
      try {
        parts = await build();
      } catch (error) {
        show({ kind: "failed", message: messageOf(error), signature: null });
        return false;
      }

      const landed: string[] = [];
      for (const [index, part] of parts.entries()) {
        show({ kind: "checking" });
        try {
          const verdict = await simulate(connection, part.transaction);
          if (!verdict.ok) {
            show({
              kind: "refused",
              sentence: verdict.sentence ?? `${CHAIN.atStart} would refuse this.`,
              advice: advise(verdict.error),
              signature: null,
            });
            return false;
          }
        } catch (error) {
          show({ kind: "failed", message: messageOf(error), signature: null });
          return false;
        }

        show({ kind: "signing", part: index + 1, parts: parts.length });
        let signature: string;
        try {
          signature = await sendTransaction(part.transaction, walletConnection, {
            signers: part.signers,
            maxRetries: 3,
          });
        } catch (error) {
          show({ kind: "failed", message: messageOf(error), signature: null });
          return false;
        }

        show({ kind: "pending", signature, part: index + 1, parts: parts.length });
        try {
          const result = await readLanded(connection, signature);
          if (result.outcome === "refused") {
            show({
              kind: "refused",
              sentence: result.sentence ?? "The program refused it.",
              advice: advise((result.errorName as PanguErrorName | null) ?? null),
              signature,
            });
            return false;
          }
          if (result.outcome !== "allowed") {
            show({
              kind: "failed",
              message:
                result.outcome === "unseen"
                  ? `${CHAIN.atStart} never saw this transaction: it was dropped or expired while the wallet was open. Nothing moved. Try again.`
                  : `${CHAIN.atStart} refused it: ${result.logLine ?? result.rpcError ?? "no reason given"}`,
              signature: result.outcome === "unseen" ? null : signature,
            });
            return false;
          }
        } catch {
          show({
            kind: "failed",
            message: `Sent, but ${CHAIN.inSentence} did not answer the read back. Open the transaction to see where it stands.`,
            signature,
          });
          return false;
        }
        landed.push(signature);
      }
      show({ kind: "landed", signatures: landed });
      return true;
    },
    [connection, sendTransaction, walletConnection]
  );

  const reset = useCallback(() => setStep(IDLE), []);

  return { step, run, reset };
}
