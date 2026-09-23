"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { Spinner } from "@/components/break/strike";
import { explorerTx } from "@/lib/break";

import type { ActionStep } from "./use-chain-action";

const EASE = [0.22, 1, 0.36, 1] as const;

function TxLink({ signature, children }: { signature: string; children: string }) {
  return (
    <a
      href={explorerTx(signature)}
      target="_blank"
      rel="noreferrer"
      className="border-b border-line pb-0.5 text-ink transition-colors hover:border-accent hover:text-accent"
    >
      {children}
    </a>
  );
}

/**
 * One action's state in words: checking with devnet, waiting on the wallet,
 * waiting on the chain, landed with its link, or refused with the program's
 * own sentence and what to do about it.
 */
export function ActionStatus({ step, landedLine, testId }: { step: ActionStep; landedLine: string; testId?: string }) {
  const still = useReducedMotion() === true;
  if (step.kind === "idle") {
    return null;
  }

  const tone =
    step.kind === "landed"
      ? "var(--accent)"
      : step.kind === "refused" || step.kind === "failed"
        ? "var(--refused)"
        : "var(--pending)";

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={step.kind}
        data-testid={testId}
        data-step={step.kind}
        initial={still ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={still ? { duration: 0 } : { duration: 0.4, ease: EASE }}
        className="mt-5 border-l-2 pl-4 text-[14px] leading-relaxed"
        style={{ borderColor: tone }}
      >
        {step.kind === "checking" && (
          <p className="flex items-center gap-2.5 text-muted">
            <Spinner />
            Building it and asking devnet whether it would pass, before your wallet sees it.
          </p>
        )}
        {step.kind === "signing" && (
          <p className="flex items-center gap-2.5">
            <Spinner />
            {step.parts > 1
              ? `Devnet would take it. Waiting for your wallet to sign part ${step.part} of ${step.parts}.`
              : "Devnet would take it. Waiting for your wallet to sign."}
          </p>
        )}
        {step.kind === "pending" && (
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-muted">
            <Spinner />
            <span>Sent. Waiting for devnet to confirm, usually a few seconds.</span>
            <TxLink signature={step.signature}>open it</TxLink>
          </p>
        )}
        {step.kind === "landed" && (
          <p>
            <span className="font-medium">{landedLine}</span>{" "}
            {step.signatures.map((signature, place) => (
              <span key={signature} className="mr-3">
                <TxLink signature={signature}>
                  {step.signatures.length > 1 ? `transaction ${place + 1}` : "open the transaction"}
                </TxLink>
              </span>
            ))}
          </p>
        )}
        {step.kind === "refused" && (
          <div>
            <p className="font-medium">{step.sentence}</p>
            {step.advice !== null && <p className="mt-1 text-muted">{step.advice}</p>}
            {step.signature === null ? (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                refused in simulation, nothing was signed or sent
              </p>
            ) : (
              <p className="mt-1">
                <TxLink signature={step.signature}>open the refused transaction</TxLink>
              </p>
            )}
          </div>
        )}
        {step.kind === "failed" && (
          <div>
            <p>{step.message}</p>
            {step.signature !== null && (
              <p className="mt-1">
                <TxLink signature={step.signature}>open the transaction</TxLink>
              </p>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
