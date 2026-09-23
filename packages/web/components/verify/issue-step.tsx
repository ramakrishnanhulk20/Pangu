"use client";

import type { Connection, PublicKey } from "@solana/web3.js";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";

import { CHAIN } from "@/lib/network";
import {
  VerifyError,
  defaultExpiryDay,
  expiryOf,
  parseWallets,
  planIssue,
  shortKey,
  simulateSignSend,
  type Phase,
  type VerifierPair,
  type VerifyWallet,
} from "@/lib/verify";

import {
  FIELD_CLASS,
  Failure,
  Label,
  Landed,
  PRIMARY_BUTTON,
  PhaseLine,
  StepHead,
  utcDate,
} from "./bits";

type ExpiryMode = "never" | "date";

interface Outcome {
  signatures: string[];
  issued: number;
  alreadyHeld: PublicKey[];
}

/** Step 02. Attests every pasted wallet under the verifier, in as few transactions as fit. */
export function IssueStep({
  connection,
  wallet,
  pair,
  onIssued,
}: {
  connection: Connection;
  wallet: VerifyWallet | null;
  pair: VerifierPair | null;
  onIssued: (wallets: PublicKey[]) => void;
}) {
  const still = useReducedMotion() === true;
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ExpiryMode>("never");
  const [day, setDay] = useState("");
  const [phase, setPhase] = useState<Phase | null>(null);
  const [trouble, setTrouble] = useState<{ message: string; detail: string | null } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const pasted = useMemo(() => parseWallets(text), [text]);
  const good = pasted.filter((line) => line.key !== null);
  const bad = pasted.filter((line) => line.problem !== null);

  let expiryProblem: string | null = null;
  if (mode === "date") {
    try {
      expiryOf(day === "" ? "missing" : day);
    } catch (error) {
      expiryProblem = error instanceof Error ? error.message : String(error);
    }
  }

  const ready = pair !== null && pair.canSign && !pair.paused && wallet !== null;
  const canIssue =
    ready && good.length > 0 && bad.length === 0 && expiryProblem === null && phase === null;

  const pickMode = (next: ExpiryMode) => {
    setMode(next);
    if (next === "date" && day === "") {
      // Filled in only when asked for, so the server and the browser never
      // disagree about today.
      setDay(defaultExpiryDay());
    }
  };

  const issue = async () => {
    if (!canIssue || pair === null || wallet === null) {
      return;
    }
    setTrouble(null);
    setOutcome(null);
    setPhase("reading");
    try {
      const expiry = mode === "never" ? 0 : expiryOf(day);
      const wallets = good.map((line) => line.key as PublicKey);
      const plan = await planIssue(connection, wallet.publicKey, pair, wallets, expiry);
      const signatures = await simulateSignSend(connection, wallet, plan.transactions, setPhase);
      const issued = plan.batches.flat();
      setOutcome({ signatures, issued: issued.length, alreadyHeld: plan.alreadyHeld });
      if (issued.length > 0) {
        setText("");
        onIssued(issued);
      }
    } catch (error) {
      setTrouble(
        error instanceof VerifyError
          ? { message: error.message, detail: error.detail }
          : {
              message: `${CHAIN.atStart} did not answer. Check the connection and press again.`,
              detail: error instanceof Error ? error.message : String(error),
            }
      );
    } finally {
      setPhase(null);
    }
  };

  return (
    <div data-testid="verify-issue" className={pair === null ? "opacity-50" : undefined}>
      <StepHead index="02" title="Issue credentials" />

      {pair === null && (
        <p className="mt-6 text-[14px] text-muted">Set up as a verifier first.</p>
      )}

      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          void issue();
        }}
      >
        <fieldset disabled={pair === null} className="space-y-6">
          <div>
            <Label htmlFor="verify-wallets">buyer wallets, one per line</Label>
            <textarea
              id="verify-wallets"
              data-testid="verify-issue-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={5}
              spellCheck={false}
              placeholder="Paste wallet addresses. Commas and spaces work too."
              className={`${FIELD_CLASS} mt-2 resize-y font-mono text-[13px] leading-relaxed`}
            />
            <AnimatePresence initial={false}>
              {pasted.length > 0 && (
                <motion.ul
                  data-testid="verify-issue-lines"
                  initial={still ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={still ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={{ duration: still ? 0 : 0.25 }}
                  className="mt-3 flex flex-wrap gap-2"
                >
                  {pasted.map((line, place) => (
                    <li
                      key={`${line.text}:${place}`}
                      data-valid={line.problem === null}
                      title={line.problem ?? line.text}
                      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 font-mono text-[11px] ${
                        line.problem === null
                          ? "border-line text-ink"
                          : "border-refused/60 text-refused"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full ${line.problem === null ? "bg-accent" : "bg-refused"}`}
                      />
                      {line.text.length > 12 ? shortKey(line.text) : line.text}
                      {line.problem !== null && <span className="font-body">{line.problem}</span>}
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
            {pasted.length > 0 && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                {good.length} ready{bad.length > 0 ? `, ${bad.length} to fix first` : ""}
              </p>
            )}
          </div>

          <div>
            <Label>expires</Label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-line p-1">
                {(
                  [
                    { value: "never", label: "never" },
                    { value: "date", label: "on a date" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    data-testid={`verify-expiry-${option.value}`}
                    onClick={() => pickMode(option.value)}
                    aria-pressed={mode === option.value}
                    className={`rounded-md px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-200 ${
                      mode === option.value ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
                    } focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {mode === "date" && (
                <input
                  type="date"
                  data-testid="verify-expiry-day"
                  aria-label="expiry date"
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                  className={`${FIELD_CLASS} w-auto py-2`}
                />
              )}
            </div>
            <p className="mt-2 text-[13px] text-muted">
              {mode === "never"
                ? "The credential holds until you revoke it."
                : expiryProblem ??
                  `Runs out at the end of ${utcDate(expiryOf(day))}, UTC. After that every buy from the wallet is refused.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <button
              type="submit"
              data-testid="verify-issue-button"
              disabled={!canIssue}
              className={PRIMARY_BUTTON}
            >
              {good.length > 1 ? `Issue to ${good.length} wallets` : "Issue"}
              <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
                &rarr;
              </span>
            </button>
            {phase !== null && <PhaseLine phase={phase} testId="verify-issue-phase" />}
          </div>
        </fieldset>
      </form>

      {trouble !== null && (
        <div className="mt-5">
          <Failure message={trouble.message} detail={trouble.detail} testId="verify-issue-failure" />
        </div>
      )}

      {outcome !== null && (
        <div data-testid="verify-issue-done" className="mt-5 space-y-3">
          <p className="text-[15px]">
            {outcome.issued === 0
              ? "Nothing new to issue."
              : `${outcome.issued} ${outcome.issued === 1 ? "credential" : "credentials"} issued on ${CHAIN.inSentence}.`}
          </p>
          {outcome.alreadyHeld.length > 0 && (
            <p className="max-w-[56ch] text-[13px] text-muted">
              Left out, because they already hold one from you:{" "}
              {outcome.alreadyHeld.map((key) => shortKey(key)).join(", ")}. To change an expiry,
              revoke and issue again.
            </p>
          )}
          <Landed signatures={outcome.signatures} testId="verify-issue-landed" />
        </div>
      )}
    </div>
  );
}
