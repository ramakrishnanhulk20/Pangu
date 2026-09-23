"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SaleChoice, SaleReadout as Readout } from "@/lib/readout";

import {
  clock,
  explorerAddress,
  money,
  perThousand,
  percent,
  shares,
  shortAddress,
  whole,
} from "./format";
import { Bar, Counting, Holders, Stat, largestOfSale } from "./numbers";
import { PriceCurve } from "./price-curve";

const POLL_MS = 15_000;
const EASE = [0.22, 1, 0.36, 1] as const;

function Dot({ tone, beating }: { tone: "accent" | "pending"; beating: boolean }) {
  const colour = tone === "accent" ? "bg-accent" : "bg-pending";
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {beating && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colour} opacity-70`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colour}`} />
    </span>
  );
}

/**
 * What a new answer does to the reading on screen.
 *
 * A failed read never wipes a good one: the numbers stay and are marked as
 * held, with the time devnet went quiet. A held reading from the server that
 * is older than the one already on screen does not replace it either, which
 * can happen when two server instances each kept their own last reading.
 */
function settle(current: Readout, next: Readout): Readout {
  const sameSale = current.mint === next.mint && current.failure === null;
  if (sameSale && next.failure !== null) {
    return { ...current, stale: true, missedAt: next.readAt };
  }
  if (sameSale && next.stale && next.readAt < current.readAt) {
    return { ...current, stale: true, missedAt: next.missedAt };
  }
  return next;
}

/**
 * Why no buy can land on this sale right now, or null when one can.
 *
 * Only a sale with a price ceiling refuses every buyer at once: the curve has
 * climbed past the ceiling, or there is no fresh stock price to set one.
 */
function everyBuyRefused(readout: Readout): string | null {
  if (readout.graduated || readout.stockName === null) {
    return null;
  }
  if (readout.priceWarning !== null) {
    return `there is no fresh ${readout.stockName} price`;
  }
  if (
    readout.priceNow !== null &&
    readout.ceilingDollars !== null &&
    readout.priceNow > readout.ceilingDollars
  ) {
    return "the curve sits above the price ceiling";
  }
  return null;
}

function Picker({
  choices,
  chosen,
  asking,
  refusing,
  onChoose,
}: {
  choices: SaleChoice[];
  /** The sale on screen. It moves only once the new sale's reading is in. */
  chosen: string;
  /** The sale asked for and still being read, if any. */
  asking: string | null;
  /** True when the sale on screen refuses every buy right now. */
  refusing: boolean;
  onChoose: (mint: string) => void;
}) {
  if (choices.length < 2) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((choice) => {
        const active = choice.mint === chosen;
        const pending = choice.mint === asking && !active;
        return (
          <button
            key={choice.mint}
            type="button"
            onClick={() => onChoose(choice.mint)}
            aria-pressed={active}
            aria-busy={pending}
            className={`rounded-lg border px-3.5 py-2 text-left font-mono text-[10px] uppercase leading-tight tracking-[0.16em] transition-colors ${
              active
                ? "border-accent text-ink"
                : pending
                  ? "animate-pulse border-pending text-ink"
                  : "border-line text-muted hover:border-ink hover:text-ink"
            }`}
          >
            {choice.name}
            <span className="mt-1 block text-[9px] opacity-70">
              {pending
                ? "reading devnet"
                : choice.running === null
                  ? "unknown right now"
                  : !choice.running
                    ? "graduated"
                    : active && refusing
                      ? "open, every buy refused now"
                      : "open"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ExplorerLink({
  address,
  children,
}: {
  address: string;
  children: string;
}) {
  return (
    <a
      href={explorerAddress(address)}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-1.5 underline-offset-4 transition-colors hover:text-ink hover:underline"
    >
      {children}
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      >
        <path d="M4 8L8.5 3.5" />
        <path d="M4.6 3.5H8.5V7.4" />
      </svg>
    </a>
  );
}

/**
 * The sale as a living object: the real curve on the left, the numbers behind
 * it on the right, and the rule a buyer would run into first underneath.
 *
 * The first reading is server rendered, so the numbers are in the HTML before
 * any script runs, and the page asks devnet again every fifteen seconds. No
 * wallet is involved in any of it.
 */
export function SaleReadout({
  id,
  initial,
  choices,
}: {
  id: string;
  initial: Readout;
  choices: SaleChoice[];
}) {
  const still = useReducedMotion() === true;
  const frame = useRef<HTMLElement>(null);
  const revealed = useInView(frame, { once: true, margin: "-80px" });

  const [readout, setReadout] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The reading on screen, kept beside the state so an answer can be weighed
  // against it without waiting for a render.
  const shown = useRef(initial);
  // The sale the visitor last asked for. Polls follow it, and a failed switch
  // hands it back to the sale still on screen.
  const wanted = useRef(initial.mint);
  // Every request takes the next number. Only the newest one may change the
  // screen or clear the refreshing dot, so a slow older answer cannot land on
  // top of a newer one or stop the dot while the newer one is still out.
  const ticket = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(async (mint: string, name: string) => {
    ticket.current += 1;
    const mine = ticket.current;
    const newest = () => mounted.current && ticket.current === mine;

    const show = (next: Readout) => {
      shown.current = next;
      setReadout(next);
    };

    // A switch that did not land leaves the sale on screen where it was, and
    // says so in one line, rather than trading real numbers for an apology.
    const keep = () => {
      const current = shown.current;
      wanted.current = current.mint;
      setNotice(
        `Devnet did not answer at ${clock(Date.now())} for ${name}, so ${current.name} stays on screen.`
      );
    };

    setRefreshing(true);
    try {
      const answer = await fetch(`/api/readout/${mint}`, { cache: "no-store" });
      if (!answer.ok) {
        throw new Error(`readout answered ${answer.status}`);
      }
      const next = (await answer.json()) as Readout;
      if (!newest()) {
        return;
      }
      const current = shown.current;
      if (next.mint !== current.mint && next.unanswered && current.failure === null) {
        keep();
        return;
      }
      setNotice(null);
      show(settle(current, next));
    } catch {
      if (!newest()) {
        return;
      }
      const current = shown.current;
      if (mint !== current.mint && current.failure === null) {
        keep();
      } else if (current.failure === null) {
        // A missed poll leaves the last real reading on screen, marked as
        // held, rather than replacing it with a guess.
        show({ ...current, stale: true, missedAt: Date.now() });
      }
    } finally {
      if (newest()) {
        setRefreshing(false);
        setAsking(null);
      }
    }
  }, []);

  const nameOf = useCallback(
    (mint: string) =>
      choices.find((choice) => choice.mint === mint)?.name ?? "that sale",
    [choices]
  );

  const choose = useCallback(
    (mint: string) => {
      if (mint === wanted.current) {
        return;
      }
      wanted.current = mint;
      setAsking(mint === shown.current.mint ? null : mint);
      void read(mint, nameOf(mint));
    },
    [read, nameOf]
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void read(wanted.current, nameOf(wanted.current));
      }
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [read, nameOf]);

  const banded = readout.stockDollars !== null;
  const stockNote =
    readout.stockStale && readout.stockPublishedAt !== null
      ? `stale since ${clock(readout.stockPublishedAt, readout.readAt)}, so buying is paused`
      : readout.priceWarning ?? "the price the chain measures every buy against";
  // With no fresh price the program has no ceiling to hold a buy under, so the
  // last one is named as history, never shown as the live number.
  const ceilingNote =
    readout.ceilingDollars === null
      ? "the ceiling waits on a fresh Apple price"
      : `until a fresh Apple price lands. It was ${money(readout.ceilingDollars, "dollars")} on the last one`;
  const quietLine =
    notice ??
    (readout.stale && readout.missedAt !== null
      ? `Devnet did not answer at ${clock(
          readout.missedAt,
          readout.readAt
        )}, showing the reading from ${clock(readout.readAt)}.`
      : null);
  // A price of a few millionths reads as a row of zeros, so it is shown for
  // 1,000 shares and the note says so.
  const tiny = readout.priceNow !== null && perThousand(readout.priceNow);
  const priceNote = tiny
    ? readout.graduated
      ? `what 1,000 shares cost where the curve finished: one share is under 0.0001 ${readout.money}`
      : `what 1,000 shares cost right now: one share is under 0.0001 ${readout.money}`
    : readout.graduated
      ? "the price the curve finished at"
      : "what one share costs right now";
  const refusal = everyBuyRefused(readout);
  const largest = largestOfSale(readout);

  return (
    <section
      ref={frame}
      id={id}
      data-testid="readout"
      className="relative isolate overflow-hidden border-t border-line px-[6vw] py-20 sm:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full opacity-[0.16] blur-[120px]"
        style={{ background: "var(--accent)" }}
      />

      <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <motion.div
          initial={still ? false : { opacity: 0, y: 26 }}
          animate={revealed || still ? { opacity: 1, y: 0 } : undefined}
          transition={still ? { duration: 0 } : { duration: 0.8, ease: EASE }}
        >
          <div className="flex items-center gap-2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            <Dot
              tone={refreshing || readout.stale ? "pending" : "accent"}
              beating={!still && !readout.stale}
            />
            {refreshing
              ? "reading devnet"
              : readout.stale
                ? "holding the last reading"
                : "live on Solana devnet"}
          </div>
          {/* The measure sits on the heading itself, so 15ch is fifteen of its
              own characters and the line breaks once, in the skeleton too. */}
          <h2 className="mt-5 max-w-[15ch] font-display text-[clamp(2.25rem,4.6vw,3.9rem)] font-semibold leading-[0.92] tracking-[-0.035em]">
            Watch the price find itself.
          </h2>
        </motion.div>

        <motion.div
          initial={still ? false : { opacity: 0, y: 26 }}
          animate={revealed || still ? { opacity: 1, y: 0 } : undefined}
          transition={
            still ? { duration: 0 } : { duration: 0.8, delay: 0.1, ease: EASE }
          }
          className="flex max-w-[38ch] flex-col gap-5"
        >
          <p className="text-[16px] leading-[1.5] text-muted">
            Every share on this drawing came off Meteora&rsquo;s curve. The cap on one
            wallet lies under it at the width it really has.
          </p>
          <Picker
            choices={choices}
            chosen={readout.mint}
            asking={asking}
            refusing={refusal !== null}
            onChoose={choose}
          />
        </motion.div>
      </div>

      {readout.failure !== null ? (
        <p
          className="relative mt-14 max-w-[52ch] border-l-2 pl-5 text-[15px] leading-relaxed"
          style={{ borderColor: "var(--refused)" }}
        >
          {readout.failure}
        </p>
      ) : (
        <>
          <div className="relative mt-12 grid gap-y-12 lg:mt-16 lg:grid-cols-12 lg:gap-x-12">
            <motion.div
              initial={still ? false : { opacity: 0 }}
              animate={revealed || still ? { opacity: 1 } : undefined}
              transition={still ? { duration: 0 } : { duration: 0.6, ease: EASE }}
              className="lg:col-span-8 lg:-ml-[6vw]"
            >
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 lg:pl-[6vw]">
                <span className="font-display text-[19px] tracking-[-0.01em]">
                  {readout.name}
                </span>
                <span
                  data-testid="readout-status"
                  className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
                    refusal === null ? "text-muted" : "text-refused"
                  }`}
                >
                  {readout.graduated
                    ? "graduated"
                    : refusal === null
                      ? "open, taking buys"
                      : `open, but every buy is refused right now: ${refusal}`}
                </span>
                {readout.dammPool !== null && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                    <ExplorerLink address={readout.dammPool}>
                      {`trades now in pool ${shortAddress(readout.dammPool)}`}
                    </ExplorerLink>
                  </span>
                )}
              </div>

              {quietLine !== null && (
                <motion.p
                  key={quietLine}
                  initial={still ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={still ? { duration: 0 } : { duration: 0.5, ease: EASE }}
                  data-testid="readout-stale"
                  className="mt-3 flex items-center gap-2.5 text-[13px] leading-snug text-muted lg:pl-[6vw]"
                >
                  <Dot tone="pending" beating={false} />
                  {quietLine}
                </motion.p>
              )}

              <div className="mt-6">
                <PriceCurve readout={readout} revealed={revealed} still={still} />
              </div>
            </motion.div>

            <div className="divide-y divide-line border-t border-line lg:col-span-4">
              <Stat label={`${readout.name}, on the curve`} note={priceNote}>
                {readout.priceNow === null ? (
                  <span className="text-muted">not readable</span>
                ) : (
                  <Counting
                    value={tiny ? readout.priceNow * 1_000 : readout.priceNow}
                    format={(value) => money(value, readout.money)}
                    unit={`${readout.money}${tiny ? " per 1,000" : ""}`}
                    still={still}
                    revealed={revealed}
                  />
                )}
              </Stat>

              {banded && (
                <Stat label="Apple, from Pyth" quiet note={stockNote}>
                  {readout.stockDollars === null || readout.stockDollars <= 0 ? (
                    <span className="text-muted">not published yet</span>
                  ) : (
                    <Counting
                      value={readout.stockDollars}
                      format={(value) => money(value, "dollars")}
                      still={still}
                      revealed={revealed}
                    />
                  )}
                </Stat>
              )}

              {banded && readout.priceWarning !== null ? (
                <Stat label="buys stop above" quiet note={ceilingNote}>
                  <span className="text-muted">unknown right now</span>
                </Stat>
              ) : (
                readout.ceilingDollars !== null && (
                  <Stat
                    label="buys stop above"
                    quiet
                    note="the ceiling the curve price is held under"
                  >
                    <Counting
                      value={readout.ceilingDollars}
                      format={(value) => money(value, "dollars")}
                      still={still}
                      revealed={revealed}
                    />
                  </Stat>
                )
              )}

              <Stat
                label="raised so far"
                quiet
                note={
                  <>
                    {`of ${money(readout.threshold, readout.money)} before it graduates`}
                    <Bar share={readout.raisedShare} still={still} revealed={revealed} />
                  </>
                }
              >
                <Counting
                  value={readout.raised}
                  format={(value) => money(value, readout.money)}
                  unit={readout.money}
                  still={still}
                  revealed={revealed}
                />
              </Stat>

              <Stat
                label="buyers"
                quiet
                note={`${shares(readout.sold)} of ${shares(
                  readout.saleSize
                )} shares have gone out`}
              >
                <Counting
                  value={readout.buyers}
                  format={whole}
                  still={still}
                  revealed={revealed}
                />
              </Stat>

              {/* Measured on the cap's own basis, the whole sale, so the two
                  numbers can be read against each other. The share of what has
                  sold so far is the other basis, said underneath. */}
              <Stat
                label="the largest wallet, of the whole sale"
                quiet
                note={
                  <>
                    {readout.holders.length === 0
                      ? `the cap lets one wallet hold ${percent(
                          readout.capOfSale
                        )} of the sale`
                      : `against a cap of ${percent(readout.capOfSale)} of the sale`}
                    <Bar
                      share={readout.capOfSale === 0 ? 0 : largest / readout.capOfSale}
                      still={still}
                      revealed={revealed}
                    />
                    {readout.holders.length > 0 && (
                      <span className="mt-2 block font-mono text-[11px] tracking-[0.02em]">
                        {`= ${percent(readout.largestShare)} of what has sold so far`}
                      </span>
                    )}
                  </>
                }
              >
                <Counting
                  value={largest}
                  format={percent}
                  still={still}
                  revealed={revealed}
                />
              </Stat>

              <Holders
                holders={readout.holders}
                still={still}
                revealed={revealed}
              />
            </div>
          </div>

          <motion.p
            initial={still ? false : { opacity: 0, y: 20 }}
            animate={revealed || still ? { opacity: 1, y: 0 } : undefined}
            transition={
              still ? { duration: 0 } : { duration: 0.8, delay: 0.3, ease: EASE }
            }
            className="relative mt-14 max-w-[30ch] border-l-2 border-accent pl-5 font-display text-[clamp(1.35rem,2.6vw,2.15rem)] leading-[1.15] tracking-[-0.02em] sm:max-w-[34ch] lg:mt-20"
          >
            {readout.rule}
          </motion.p>
        </>
      )}
    </section>
  );
}
