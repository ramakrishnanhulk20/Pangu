"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SaleChoice, SaleReadout as Readout } from "@/lib/readout";

import { explorerAddress, money, percent, shares, shortAddress, whole } from "./format";
import { Bar, Counting, Holders, Stat } from "./numbers";
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

function Picker({
  choices,
  chosen,
  onChoose,
}: {
  choices: SaleChoice[];
  chosen: string;
  onChoose: (mint: string) => void;
}) {
  if (choices.length < 2) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((choice) => {
        const active = choice.mint === chosen;
        return (
          <button
            key={choice.mint}
            type="button"
            onClick={() => onChoose(choice.mint)}
            aria-pressed={active}
            className={`rounded-lg border px-3.5 py-2 text-left font-mono text-[10px] uppercase leading-tight tracking-[0.16em] transition-colors ${
              active
                ? "border-accent text-ink"
                : "border-line text-muted hover:border-ink hover:text-ink"
            }`}
          >
            {choice.name}
            <span className="mt-1 block text-[9px] opacity-70">
              {choice.running ? "still taking buys" : "graduated"}
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

  const [chosen, setChosen] = useState(initial.mint);
  const [readout, setReadout] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);

  // Which sale the visitor is looking at right now. An answer for any other
  // sale is thrown away, so a slow reading of the one they just left cannot
  // land on top of the one they asked for.
  const wanted = useRef(initial.mint);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(async (mint: string) => {
    setRefreshing(true);
    try {
      const answer = await fetch(`/api/readout/${mint}`, { cache: "no-store" });
      if (!answer.ok) {
        return;
      }
      const next = (await answer.json()) as Readout;
      if (mounted.current && wanted.current === mint) {
        setReadout(next);
      }
    } catch {
      // A missed poll leaves the last real reading on screen rather than
      // replacing it with a guess.
    } finally {
      if (mounted.current) {
        setRefreshing(false);
      }
    }
  }, []);

  const choose = useCallback(
    (mint: string) => {
      if (mint === wanted.current) {
        return;
      }
      wanted.current = mint;
      setChosen(mint);
      void read(mint);
    },
    [read]
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void read(chosen);
      }
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [chosen, read]);

  const banded = readout.stockDollars !== null;
  const priceNote = readout.graduated
    ? "the price the curve finished at"
    : "what one share costs right now";

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
          className="max-w-[15ch]"
        >
          <div className="flex items-center gap-2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            <Dot
              tone={refreshing ? "pending" : "accent"}
              beating={!still}
            />
            {refreshing ? "reading devnet" : "live on Solana devnet"}
          </div>
          <h2 className="mt-5 font-display text-[clamp(2.25rem,4.6vw,3.9rem)] font-semibold leading-[0.92] tracking-[-0.035em]">
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
          <Picker choices={choices} chosen={chosen} onChoose={choose} />
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
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                  {readout.graduated ? "graduated" : "still taking buys"}
                </span>
                {readout.dammPool !== null && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                    <ExplorerLink address={readout.dammPool}>
                      {`trades now in pool ${shortAddress(readout.dammPool)}`}
                    </ExplorerLink>
                  </span>
                )}
              </div>

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
                    value={readout.priceNow}
                    format={(value) => money(value, readout.money)}
                    still={still}
                    revealed={revealed}
                  />
                )}
              </Stat>

              {banded && (
                <Stat
                  label="Apple, from Pyth"
                  quiet
                  note={
                    readout.priceWarning ??
                    "the price the chain measures every buy against"
                  }
                >
                  <Counting
                    value={readout.stockDollars ?? 0}
                    format={(value) => money(value, "dollars")}
                    still={still}
                    revealed={revealed}
                  />
                </Stat>
              )}

              {readout.ceilingDollars !== null && (
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

              <Stat
                label="the largest wallet"
                quiet
                note={
                  <>
                    {readout.holders.length === 0
                      ? `the cap lets one wallet hold ${percent(
                          readout.capOfSale
                        )} of the sale`
                      : `of a cap worth ${percent(
                          readout.capOfSold
                        )} of everything sold so far`}
                    <Bar
                      share={
                        readout.capOfSold === 0
                          ? 0
                          : readout.largestShare / readout.capOfSold
                      }
                      still={still}
                      revealed={revealed}
                    />
                  </>
                }
              >
                <Counting
                  value={readout.largestShare}
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
