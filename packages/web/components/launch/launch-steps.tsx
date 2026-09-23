"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { Spinner } from "@/components/break/strike";
import { STEPS, explorerTx, type StepId, type StepState, type StepStatus } from "@/lib/launch";

import { Tag } from "./fields";

const WORDS: Record<StepStatus, string> = {
  waiting: "next",
  checking: "checking what is already on chain",
  pricing: "asking Irys the price",
  funding: "waiting for your wallet to pay Irys",
  crediting: "paid, waiting for Irys to credit it",
  "uploading-logo": "your wallet signs the logo, then it uploads",
  "uploading-json": "your wallet signs the description, then it uploads",
  building: "putting it together",
  simulating: "asking devnet what would happen",
  signing: "waiting for your wallet",
  sending: "sent, waiting for devnet to confirm",
  done: "on chain",
  reused: "already on chain from your last try, reused",
  failed: "stopped",
};

const BUSY: readonly StepStatus[] = [
  "checking",
  "pricing",
  "funding",
  "crediting",
  "uploading-logo",
  "uploading-json",
  "building",
  "simulating",
  "signing",
  "sending",
];

/**
 * The launch's steps in the order they run, each with where it has got to, a
 * link once it has a signature, and when one stops, what is on chain and what
 * pressing Launch again will do. The storage step shows what Irys priced it at.
 */
export function LaunchSteps({
  steps,
  storageLamports,
  withStorage,
}: {
  steps: Record<StepId, StepState>;
  storageLamports: number | null;
  /** False when the launch stores nothing on Irys, so the storage step is left out. */
  withStorage: boolean;
}) {
  const still = useReducedMotion() === true;

  return (
    <ol className="border-t border-line">
      {STEPS.filter((step) => withStorage || step.id !== "metadata").map((step, place) => {
        const state = steps[step.id];
        const busy = BUSY.includes(state.status);
        const landed = state.status === "done" || state.status === "reused";
        return (
          <li
            key={step.id}
            data-testid={`launch-step-${step.id}`}
            data-status={state.status}
            className="relative border-b border-line py-5"
          >
            <motion.span
              aria-hidden="true"
              className="absolute bottom-[-1px] left-0 h-[2px] origin-left bg-accent"
              initial={false}
              animate={{ scaleX: landed ? 1 : busy ? 0.35 : 0, opacity: landed || busy ? 1 : 0 }}
              style={{ width: "100%" }}
              transition={still ? { duration: 0 } : { duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            />
            <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3">
              <span className="pt-1 font-mono text-[11px] text-accent">{String(place + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <p className="text-[16px] font-medium">{step.title}</p>
                  <p
                    className={`flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] ${
                      state.status === "failed" ? "text-refused" : busy ? "text-pending" : landed ? "text-ink" : "text-muted"
                    }`}
                  >
                    {busy && <Spinner />}
                    {step.id === "metadata" && landed ? (state.status === "reused" ? "stored by your last try, reused" : "stored on Irys") : WORDS[state.status]}
                  </p>
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  {step.detail}
                  {step.id === "metadata" && (
                    <span data-testid="launch-step-metadata-cost">
                      {storageLamports === null
                        ? ". Irys prices it in a moment."
                        : `. About ${(storageLamports / 1e9).toFixed(6)} SOL, less whatever your Irys balance already holds.`}
                    </span>
                  )}
                </p>
                {state.signature !== null && (
                  <a
                    href={explorerTx(state.signature)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block border-b border-line pb-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-accent hover:text-accent"
                  >
                    {step.id === "metadata" ? "open the payment to Irys" : "open the transaction"}
                  </a>
                )}
                <AnimatePresence>
                  {state.failure !== null && (
                    <motion.div
                      data-testid={`launch-failure-${step.id}`}
                      className="mt-4 border-l-2 border-refused pl-4"
                      initial={still ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={still ? undefined : { opacity: 0 }}
                    >
                      <p className="text-[14px] leading-relaxed">
                        {state.failure.sentence}{" "}
                        {state.failure.tag !== null && <Tag>{state.failure.tag}</Tag>}
                      </p>
                      <p className="mt-2 text-[13px] leading-relaxed text-muted">
                        {state.failure.onChain}{" "}
                        {state.failure.onChainLink !== null && (
                          <a
                            href={state.failure.onChainLink}
                            target="_blank"
                            rel="noreferrer"
                            className="border-b border-line text-ink transition-colors hover:border-accent hover:text-accent"
                          >
                            see it on the explorer
                          </a>
                        )}
                      </p>
                      <p className="mt-2 text-[13px] font-medium leading-relaxed">{state.failure.next}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
