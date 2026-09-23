"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { Attack, AttackResult, Expected, Target } from "@/lib/break";
import {
  NEEDS_REAL_BUY,
  OFFERING_OVER_LINE,
  liftedByOffering,
  plainFailure,
  type FundingWords,
} from "@/lib/break";
import { tokenAmount } from "@/lib/format";
import { CHAIN, DEMO_DOLLARS_ON, FAUCET_ON, LEDGER_SENDS, explorerTx } from "@/lib/network";

import { Spinner, Strike } from "./strike";

/** What a wallet short of SOL or of the paying token is told to do on this network. */
const FUNDING: FundingWords = {
  noSol: FAUCET_ON
    ? `This wallet has no ${CHAIN.sol}: use the faucet link above.`
    : "This wallet has no SOL for the fee. Add a little SOL to it and run the row again.",
  shortToken: DEMO_DOLLARS_ON
    ? "Get demo dollars above first. This wallet does not hold enough of the token this sale is priced in, so the token program stopped the buy before the sale's rules were reached."
    : "This wallet does not hold enough of the token this sale is priced in, so the token program stopped the buy before the sale's rules were reached.",
};

/** Where one row has got to. */
export type RowStatus =
  | "idle"
  | "building"
  | "waiting"
  | "done"
  | "unavailable"
  | "stopped"
  | "unanswered";

export interface RowState {
  status: RowStatus;
  result: AttackResult | null;
  /** Why the row could not be built, in words a visitor can act on. */
  message: string | null;
  /**
   * What the program answers the transaction this row built, asked before it
   * runs. Null until the row is built.
   */
  expected: Expected | null;
  /** Raw units of the sale token that transaction moves. */
  shares: bigint | null;
  /** The signature of a transaction really sent, kept even when reading it back failed. */
  signature: string | null;
}

export const IDLE: RowState = {
  status: "idle",
  result: null,
  message: null,
  expected: null,
  shares: null,
  signature: null,
};

/** Row 01 as the rows that need shares see it, for the real buy they offer. */
export interface FirstBuy {
  /** Row 01 is being built, sent or read back right now. */
  running: boolean;
  /** The wallet holds less of the paying token than row 01 spends. */
  short: boolean;
  /** The sale refuses every buy right now, so a real buy would land only a refusal. */
  blocked: boolean;
}

/** A run the wallet changed under before it finished. It says nothing about either wallet. */
export const STOPPED: RowState = {
  ...IDLE,
  status: "stopped",
  message: "stopped: the wallet changed",
};

/** The verdict the cap line is drawn for. A transaction the chain never saw gets none. */
function verdictOf(state: RowState): "refused" | "allowed" | "unclear" | null {
  if (state.status !== "done" || state.result === null || state.result.outcome === "unseen") {
    return null;
  }
  return state.result.outcome;
}

function promiseOf(attack: Attack, state: RowState): Expected {
  return state.expected ?? { name: attack.promise, why: null };
}

/** True when what the chain did is what the program was asked it would do for this exact transaction. */
export function asExpected(attack: Attack, state: RowState): boolean {
  if (state.status !== "done" || state.result === null || state.result.outcome === "unseen") {
    return false;
  }
  const expected = promiseOf(attack, state);
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
  payingShort,
  onRun,
  realBuy,
  firstBuy,
  onRealBuy,
}: {
  attack: Attack;
  target: Target | null;
  state: RowState;
  connected: boolean;
  /** True once the chain has answered and the sale behind the row is known. */
  ready: boolean;
  /** True when this row spends more of the paying token than the wallet holds. */
  payingShort: boolean;
  onRun: () => void;
  /** True when this row needs shares from a real buy and the wallet holds none. */
  realBuy: boolean;
  firstBuy: FirstBuy;
  /** Sends row 01 for real, whatever the simulate toggle says. */
  onRealBuy: () => void;
}) {
  const still = useReducedMotion() === true;
  const expected = promiseOf(attack, state);
  const verdict = verdictOf(state);
  const running = state.status === "building" || state.status === "waiting";
  const exit = attack.kind === "pass" && attack.id === "sell-back";
  const lifted = target !== null && target.offeringOver && liftedByOffering(attack);
  const gatedMessage = state.status === "unavailable" && state.message === NEEDS_REAL_BUY;
  const offerRealBuy = connected && ready && !running && (realBuy || gatedMessage);

  // The list item is the Reveal around this row, so the row itself is a plain block.
  return (
    <div
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
            <span className={exit ? "text-accent" : "text-ink"}>{attack.gloss}</span>
            <span className="hidden sm:inline">{attack.cost}</span>
            {state.shares !== null && target !== null && (
              <span className="text-ink">
                {tokenAmount(state.shares, target.baseDecimals)} shares
              </span>
            )}
          </div>

          <p className="mt-4 max-w-[62ch] text-[14px] leading-relaxed">
            {lifted
              ? OFFERING_OVER_LINE
              : attack.kind === "pass"
                ? `The program lets this through: ${attack.plain}.`
                : `The program refuses this: ${attack.plain}.`}{" "}
            <Tags
              names={[
                lifted || attack.promise === "it goes through" ? null : attack.promise,
                `rule ${attack.invariant}`,
              ]}
            />
          </p>

          {state.expected !== null && expected.why !== null && (
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-muted">
              {`This exact transaction meets another rule first: ${expected.why}`}{" "}
              <Tags names={[expected.name === "it goes through" ? null : expected.name]} />
            </p>
          )}

          {payingShort && (
            <p className="mt-3 font-mono text-[10px] uppercase leading-none tracking-[0.16em] text-accent">
              {DEMO_DOLLARS_ON ? "get demo dollars above first" : "not enough of the paying token"}
            </p>
          )}

          {offerRealBuy &&
            (LEDGER_SENDS ? (
              <RealBuyOffer firstBuy={firstBuy} onRealBuy={onRealBuy} />
            ) : (
              <SharesFirst mint={target?.mint.toBase58() ?? null} />
            ))}

          <AnimatePresence initial={false}>
            {(state.status === "done" ||
              state.status === "unavailable" ||
              state.status === "stopped" ||
              state.status === "unanswered" ||
              running) && (
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
                        ? "sizing the buy in shares and asking the program"
                        : state.signature !== null
                          ? "sent, reading it back from the chain"
                          : "waiting for the chain"}
                    </p>
                  )}

                  {state.status === "unavailable" && state.message !== null && !gatedMessage && (
                    <p className="max-w-[62ch] text-[14px] leading-relaxed text-muted">
                      {state.message}
                    </p>
                  )}

                  {state.status === "unanswered" && state.signature !== null && (
                    <div>
                      <p className="max-w-[62ch] text-[14px] leading-relaxed">
                        Sent, the chain has not answered yet; open the link or press Run to
                        read it again.
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                        <span className="text-muted">not counted until it is read</span>
                        <a
                          href={explorerTx(state.signature)}
                          target="_blank"
                          rel="noreferrer"
                          className="border-b border-line pb-0.5 text-ink transition-colors hover:border-accent hover:text-accent"
                        >
                          open the transaction
                        </a>
                      </div>
                    </div>
                  )}

                  {state.status === "stopped" && (
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                      {state.message}
                      <span className="mt-2 block normal-case tracking-normal">
                        Not counted. Press Run to try it from the wallet connected now.
                      </span>
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
          {connected && ready && realBuy && !running ? (
            <span className="block max-w-[14rem] font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-muted">
              needs a real buy first
            </span>
          ) : connected && ready ? (
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
              {running
                ? "running"
                : state.status === "done" || state.status === "unanswered"
                  ? "Run again"
                  : "Run it"}
              <span className="transition-transform duration-200 group-hover:translate-x-0.5">
                &rarr;
              </span>
            </button>
          ) : (
            <span className="block max-w-[14rem] font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-muted">
              {connected ? `reading ${CHAIN.inSentence}` : `connect ${CHAIN.wallet} to run this`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * What a row that needs shares offers a wallet holding none: row 01, sent for
 * real. Row 01 is the one row meant to go through, so asking the wallet to sign
 * it keeps the page's promise never to ask for a signature on something meant
 * to fail. Its pending, landed and failed states show on row 01 itself.
 */
function RealBuyOffer({ firstBuy, onRealBuy }: { firstBuy: FirstBuy; onRealBuy: () => void }) {
  const still = useReducedMotion() === true;
  const held = firstBuy.running || firstBuy.short || firstBuy.blocked;

  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={still ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="mt-5 max-w-[62ch] border-l-2 border-accent/60 pl-4"
    >
      <p className="text-[14px] leading-relaxed">{NEEDS_REAL_BUY}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          onClick={onRealBuy}
          disabled={held}
          className="group/buy inline-flex h-11 items-center gap-2.5 rounded-lg border border-accent bg-accent px-5 text-[13px] font-medium text-accent-ink transition-all duration-200 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          {firstBuy.running ? "buying for real" : "Buy under the cap for real"}
          <span className="transition-transform duration-200 group-hover/buy:translate-x-0.5">
            &rarr;
          </span>
        </button>
        {firstBuy.running ? (
          <span className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-pending">
            <Spinner />
            watch row 01
          </span>
        ) : firstBuy.blocked ? (
          <span className="max-w-[36ch] text-[13px] leading-relaxed text-muted">
            No buy can land on this sale right now, so this waits: see the line under the
            sale&rsquo;s facts.
          </span>
        ) : firstBuy.short ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
            get demo dollars above first
          </span>
        ) : (
          <span className="max-w-[36ch] text-[13px] leading-relaxed text-muted">
            Your wallet signs row 01 and it lands on {CHAIN.inSentence}.
          </span>
        )}
      </div>
    </motion.div>
  );
}

/**
 * What a row that needs shares says where the ledger only simulates. Row 01
 * cannot be sent from here, so the shares come from an ordinary buy on the
 * sale's own page.
 */
function SharesFirst({ mint }: { mint: string | null }) {
  const still = useReducedMotion() === true;
  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={still ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="mt-5 max-w-[62ch] border-l-2 border-accent/60 pl-4"
    >
      <p className="text-[14px] leading-relaxed">{NEEDS_REAL_BUY}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        The ledger only simulates here, so buy some shares on the sale&rsquo;s own page, then run this row.
      </p>
      {mint !== null && (
        <a
          href={`/sale/${mint}`}
          className="group/buy mt-4 inline-flex h-11 items-center gap-2.5 rounded-lg border border-accent px-5 text-[13px] font-medium text-accent transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          Buy on the sale page
          <span className="transition-transform duration-200 group-hover/buy:translate-x-0.5">&rarr;</span>
        </a>
      )}
    </motion.div>
  );
}

/**
 * The program's own names, small and set apart, after the plain sentence they
 * belong to. A reader who wants the code can find it; nobody has to read it.
 */
export function Tags({ names }: { names: readonly (string | null)[] }) {
  const shown = names.filter((name): name is string => name !== null && name !== "");
  if (shown.length === 0) {
    return null;
  }
  return (
    <span className="inline-flex flex-wrap gap-1.5 align-middle">
      {shown.map((name) => (
        <span
          key={name}
          className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.04em] text-muted"
        >
          {name}
        </span>
      ))}
    </span>
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
  const matched = asExpected(attack, state);
  const seen = result.outcome !== "unseen";
  const failure = result.outcome === "unclear" ? plainFailure(result, target, attack, FUNDING) : null;
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
          : result.outcome === "unseen"
            ? "Not seen"
            : result.errorName !== null
              ? "Refused by the program"
              : "Refused, but not by the sale's rules"}
      </p>

      {failure === null ? (
        <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed">
          {result.outcome === "allowed"
            ? target !== null && target.offeringOver
              ? "The offering is over, so the program let it through without checking a rule, and no counter moved."
              : "The pool paid out and the sale's counters moved. This is the one row that has to work."
            : result.sentence}{" "}
          <Tags names={[result.errorName]} />
        </p>
      ) : (
        <>
          {failure.sentence !== null && (
            <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed">{failure.sentence}</p>
          )}
          {failure.raw !== null && (
            <p className="mt-3 max-w-[62ch] break-words font-mono text-[12px] leading-relaxed text-muted">
              {failure.raw}
            </p>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em]">
        <span className={!seen || matched ? "text-muted" : "text-refused"}>
          {!seen
            ? "not counted either way"
            : matched
              ? "as the program said it would"
              : "not what the program said it would do"}
        </span>
        {!seen ? (
          <span className="text-muted">the chain has no record of it</span>
        ) : result.signature !== null ? (
          <a
            href={explorerTx(result.signature)}
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

      {attack.id === "honest-buy" && seen && result.signature === null && (
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          {LEDGER_SENDS
            ? "Simulated only, nothing landed. Rows 03, 06 and 09 need a real buy."
            : "Simulated only, nothing landed. Rows 03, 06 and 09 need shares bought on the sale's own page."}
        </p>
      )}
    </div>
  );
}
