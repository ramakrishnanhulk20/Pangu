"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { Attack, AttackResult, Target } from "@/lib/break";
import { expectedOf, plainFailure } from "@/lib/break";

import { Spinner, Strike } from "./strike";

/** Where one row has got to. */
export type RowStatus = "idle" | "building" | "waiting" | "done" | "unavailable";

export interface RowState {
  status: RowStatus;
  result: AttackResult | null;
  /** Why the row could not be built, in words a visitor can act on. */
  message: string | null;
}

export const IDLE: RowState = { status: "idle", result: null, message: null };

function verdictOf(state: RowState): "refused" | "allowed" | "unclear" | null {
  if (state.status !== "done" || state.result === null) {
    return null;
  }
  return state.result.outcome;
}

/**
 * What this row will meet on the sale as it stands.
 *
 * Before devnet has answered, all that can honestly be said is what the rules
 * promise. Once the sale is read, a rule the chain decides earlier can take its
 * place, and the row says which and why.
 */
function promiseOf(attack: Attack, target: Target | null) {
  return target === null ? { name: attack.promise, why: null } : expectedOf(attack, target);
}

/** True when what the chain did is what the rules promise for this row now. */
export function asExpected(attack: Attack, target: Target | null, state: RowState): boolean {
  if (state.status !== "done" || state.result === null) {
    return false;
  }
  const expected = promiseOf(attack, target);
  if (state.result.outcome === "allowed") {
    return expected.name === "it goes through";
  }
  return state.result.errorName === expected.name;
}

export function AttackRow({
  attack,
  target,
  state,
  connected,
  ready,
  onRun,
}: {
  attack: Attack;
  target: Target | null;
  state: RowState;
  connected: boolean;
  /** True once devnet has answered and the sale behind the row is known. */
  ready: boolean;
  onRun: () => void;
}) {
  const still = useReducedMotion() === true;
  const expected = promiseOf(attack, target);
  const verdict = verdictOf(state);
  const running = state.status === "building" || state.status === "waiting";
  const exit = attack.kind === "pass" && attack.id === "sell-back";

  return (
    <li
      className={`group relative ${
        exit ? "border-t-2 border-accent/60" : "border-t border-line"
      }`}
    >
      <Strike shown={verdict !== null} tone={verdict === "allowed" ? "pass" : "refused"} />

      <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-4 py-7 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:gap-x-8 sm:py-9">
        <span
          className={`font-mono text-[11px] leading-none tracking-[0.2em] ${
            exit ? "text-accent" : "text-muted"
          } pt-2 transition-colors group-hover:text-ink`}
        >
          {attack.index}
        </span>

        <div className="min-w-0">
          <h3
            className={`font-display text-[clamp(1.3rem,2.6vw,2.15rem)] leading-[1.04] tracking-[-0.025em] ${
              exit ? "text-accent" : ""
            }`}
          >
            {attack.title}
          </h3>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase leading-none tracking-[0.18em] text-muted">
            <span className={exit ? "text-accent" : "text-ink"}>{attack.invariant}</span>
            <span>{attack.gloss}</span>
            <span className="hidden sm:inline">{attack.cost}</span>
          </div>

          <p className="mt-4 max-w-[62ch] text-[13px] leading-relaxed text-muted">
            {attack.promise === "it goes through"
              ? "The rules promise this goes through."
              : `The rules promise the chain refuses this with ${attack.promise}.`}
            {expected.why !== null &&
              ` On this sale as it stands you meet ${expected.name} first, which the line above the ledger explains.`}
          </p>

          <AnimatePresence initial={false}>
            {(state.status === "done" || state.status === "unavailable" || running) && (
              <motion.div
                initial={still ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={still ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={still ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="pt-5">
                  {running && (
                    <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-pending">
                      <Spinner />
                      {state.status === "building"
                        ? "building the transaction"
                        : "waiting for the chain"}
                    </p>
                  )}

                  {state.status === "unavailable" && state.message !== null && (
                    <p className="max-w-[62ch] text-[14px] leading-relaxed text-muted">
                      {state.message}
                    </p>
                  )}

                  {state.status === "done" && state.result !== null && (
                    <Verdict attack={attack} target={target} state={state} />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="col-span-2 mt-6 sm:col-span-1 sm:mt-0 sm:pt-1">
          {connected && ready ? (
            <button
              type="button"
              onClick={onRun}
              disabled={running}
              className={`inline-flex h-11 items-center gap-2.5 rounded-lg border px-5 text-[13px] font-medium transition-all duration-200 disabled:opacity-60 ${
                exit
                  ? "border-accent bg-accent text-accent-ink hover:-translate-y-0.5"
                  : "border-line text-ink hover:-translate-y-0.5 hover:border-ink"
              } focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent`}
            >
              {running ? "running" : state.status === "done" ? "Run again" : "Run it"}
              <span className="transition-transform duration-200 group-hover:translate-x-0.5">
                &rarr;
              </span>
            </button>
          ) : (
            <span className="block max-w-[14rem] font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-muted">
              {connected ? "reading devnet" : "connect a devnet wallet to run this"}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function Verdict({
  attack,
  target,
  state,
}: {
  attack: Attack;
  target: Target | null;
  state: RowState;
}) {
  const result = state.result;
  if (result === null) {
    return null;
  }
  const matched = asExpected(attack, target, state);
  const tone =
    result.outcome === "allowed"
      ? "text-accent"
      : result.outcome === "refused"
        ? "text-refused"
        : "text-muted";

  return (
    <div>
      <p className={`font-display text-[clamp(1.5rem,3vw,2.4rem)] leading-none tracking-[-0.03em] ${tone}`}>
        {result.outcome === "allowed"
          ? "It went through"
          : (result.errorName ?? "Refused, but not by Pangu")}
      </p>

      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed">
        {result.outcome === "allowed"
          ? "The pool paid out and the sale's counters moved. This is the one row that has to work."
          : result.outcome === "refused"
            ? result.sentence
            : target === null
              ? result.logLine
              : plainFailure(result, target)}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em]">
        <span className={matched ? "text-muted" : "text-refused"}>
          {matched ? "as the rules promise" : "not what the rules promise"}
        </span>
        {result.link !== null ? (
          <a
            href={result.link}
            target="_blank"
            rel="noreferrer"
            className="border-b border-line pb-0.5 text-ink transition-colors hover:border-accent hover:text-accent"
          >
            open the transaction
          </a>
        ) : (
          <span className="text-muted">simulated, nothing was sent</span>
        )}
      </div>
    </div>
  );
}
