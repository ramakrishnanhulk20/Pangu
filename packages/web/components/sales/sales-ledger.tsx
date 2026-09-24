"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { clock, explorerAddress, money, shortAddress } from "@/components/readout/format";
import { useNow } from "@/components/sale/use-now";
import type { Directory, DirectorySale } from "@/lib/directory";
import { CHAIN } from "@/lib/network";

import { ceilingWords, stateWords, whoMayBuy } from "./words";

const EASE = [0.22, 1, 0.36, 1] as const;

const UNREACHABLE =
  "This page could not reach its own server to read the sales. Check the connection, then press try again.";

/** The state's dot: the accent while a sale takes buys, the cold family otherwise. */
function StateDot({ sale, still }: { sale: DirectorySale; still: boolean }) {
  const live = sale.state === "running";
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {live && !still && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${
          live ? "bg-accent" : sale.state === "unknown" ? "bg-refused" : "bg-pending"
        }`}
      />
    </span>
  );
}

/** Raised against the target, as a hairline that draws itself once in view. */
function RaisedBar({ sale, still }: { sale: DirectorySale; still: boolean }) {
  if (sale.raised === null || sale.threshold === null || sale.threshold === 0) {
    return <span className="text-muted">not readable</span>;
  }
  const share = sale.raised / sale.threshold;
  return (
    <span className="block">
      <span className="tabular-nums text-ink">{money(sale.raised, sale.money)}</span>
      <span className="text-muted">{` of ${money(sale.threshold, sale.money)}`}</span>
      <span className="relative mt-2 block h-px w-full bg-line">
        <motion.span
          className="absolute inset-y-0 left-0 block origin-left bg-accent"
          style={{ width: `${Math.min(1, share) * 100}%`, height: 2, top: -0.5 }}
          initial={still ? false : { scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={still ? { duration: 0 } : { duration: 1.1, ease: EASE, delay: 0.2 }}
        />
      </span>
    </span>
  );
}

const LABEL = "font-mono text-[10px] uppercase tracking-[0.18em] text-muted";

function Row({
  sale,
  index,
  still,
  now,
}: {
  sale: DirectorySale;
  index: number;
  still: boolean;
  now: number;
}) {
  const state = stateWords(sale, now);
  const who = whoMayBuy(sale.accessMode);
  const ceiling = ceilingWords(sale);

  return (
    <motion.li
      data-testid="sales-row"
      initial={still ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={
        still ? { duration: 0 } : { duration: 0.7, delay: Math.min(index, 8) * 0.06, ease: EASE }
      }
      className="group relative border-b border-line"
    >
      {/* The whole row opens the sale. The explorer links sit above this layer. */}
      <Link
        href={`/sale/${sale.mint}`}
        aria-label={`Open ${sale.name}`}
        className="absolute inset-0 z-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px] origin-top scale-y-0 bg-accent transition-transform duration-500 ease-out group-hover:scale-y-100"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-raised opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <div className="pointer-events-none relative grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-5 px-2 py-7 sm:px-4 lg:grid-cols-[3rem_minmax(0,2.6fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_4rem_minmax(0,1fr)_2rem] lg:items-center lg:gap-x-6 lg:py-8">
        <span className="pt-1.5 font-mono text-[11px] tabular-nums text-muted lg:pt-0">
          {String(index + 1).padStart(2, "0")}
        </span>

        <div className="min-w-0">
          <p className="line-clamp-2 break-words font-display text-[clamp(1.35rem,2.2vw,1.9rem)] font-semibold leading-[1.05] tracking-[-0.025em] transition-transform duration-500 ease-out group-hover:translate-x-1.5">
            {sale.name}
          </p>
          <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            {sale.symbol === "" ? shortAddress(sale.mint) : sale.symbol}
            {sale.retired && <span className="ml-3 text-refused">retired</span>}
          </p>
        </div>

        <span
          aria-hidden="true"
          className="pt-1 text-[20px] text-muted transition-all duration-300 group-hover:translate-x-1 group-hover:text-accent lg:order-last lg:pt-0"
        >
          &rarr;
        </span>

        <dl className="col-span-3 grid grid-cols-2 gap-x-6 gap-y-5 pl-[calc(2.5rem+1rem)] text-[14px] leading-snug sm:grid-cols-3 lg:contents">
          <div>
            <dt className={`${LABEL} lg:sr-only`}>state</dt>
            <dd className="mt-1.5 lg:mt-0">
              <span className="flex items-center gap-2 font-medium">
                <StateDot sale={sale} still={still} />
                {state.word}
              </span>
              <span className="mt-1 block text-[12px] text-muted">
                {sale.state === "graduated" && sale.dammPool !== null ? (
                  <a
                    href={explorerAddress(sale.dammPool)}
                    target="_blank"
                    rel="noreferrer"
                    className="pointer-events-auto relative z-10 border-b border-line pb-px transition-colors hover:border-accent hover:text-accent"
                  >
                    {`DAMM v2 pool ${shortAddress(sale.dammPool)}`}
                  </a>
                ) : (
                  state.detail
                )}
              </span>
              {state.short !== null && (
                <span data-testid="sales-row-short" className="mt-1.5 block max-w-[34ch] text-[12px] leading-snug text-pending">
                  {state.short}
                </span>
              )}
            </dd>
          </div>

          <div>
            <dt className={`${LABEL} lg:sr-only`}>who may buy</dt>
            <dd className="mt-1.5 lg:mt-0">{who.short}</dd>
          </div>

          <div>
            <dt className={`${LABEL} lg:sr-only`}>price ceiling</dt>
            <dd className="mt-1.5 lg:mt-0">
              {ceiling === null ? <span className="text-muted">none</span> : ceiling}
            </dd>
          </div>

          <div className="col-span-2 sm:col-span-1">
            <dt className={`${LABEL} lg:sr-only`}>raised of the target</dt>
            <dd className="mt-1.5 text-[13px] lg:mt-0">
              <RaisedBar sale={sale} still={still} />
            </dd>
          </div>

          <div>
            <dt className={`${LABEL} lg:sr-only`}>buyers</dt>
            <dd className="mt-1.5 font-display text-[20px] tabular-nums lg:mt-0">{sale.buyers}</dd>
          </div>

          <div>
            <dt className={`${LABEL} lg:sr-only`}>issuer</dt>
            <dd className="mt-1.5 lg:mt-0">
              <a
                href={explorerAddress(sale.issuer)}
                target="_blank"
                rel="noreferrer"
                className="pointer-events-auto relative z-10 font-mono text-[12px] text-muted transition-colors hover:text-accent"
              >
                {shortAddress(sale.issuer)}
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </motion.li>
  );
}

/**
 * The directory as a ledger: one ruled line per sale, newest demo sale first,
 * every fact read off the chain. A row opens the sale's own page.
 */
export function SalesLedger({ initial, all }: { initial: Directory; all: boolean }) {
  const still = useReducedMotion() === true;
  const [directory, setDirectory] = useState(initial);
  const [reading, setReading] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const ticket = useRef(0);
  const now = useNow() ?? directory.readAt;

  const tryAgain = useCallback(() => {
    ticket.current += 1;
    const mine = ticket.current;
    setReading(true);
    setUnreachable(false);
    fetch(`/api/sales${all ? "?all=1" : ""}`, { cache: "no-store" })
      .then(async (answer) => (await answer.json()) as Directory)
      .then(
        (next) => {
          if (ticket.current === mine) {
            setDirectory(next);
          }
        },
        () => {
          if (ticket.current === mine) {
            setUnreachable(true);
          }
        }
      )
      .finally(() => {
        if (ticket.current === mine) {
          setReading(false);
        }
      });
  }, [all]);

  const failure = unreachable ? UNREACHABLE : directory.failure;
  const empty = failure === null && directory.sales.length === 0;

  return (
    <div data-testid="sales-ledger">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink pb-4">
        <p className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              reading || directory.stale ? "bg-pending" : failure === null ? "bg-accent" : "bg-refused"
            }`}
          />
          {reading
            ? `reading ${CHAIN.inSentence}`
            : failure !== null
              ? "no reading"
              : `${directory.sales.length} ${directory.sales.length === 1 ? "sale" : "sales"}, read ${clock(
                  directory.readAt
                )}${directory.stale ? ", the latest read went unanswered" : ""}`}
        </p>
        <button
          type="button"
          onClick={tryAgain}
          disabled={reading}
          className="inline-flex h-9 items-center rounded-lg border border-line px-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted transition-colors duration-200 hover:border-ink hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          {failure !== null || empty ? "try again" : "read again"}
        </button>
      </div>

      <div
        aria-hidden="true"
        className="hidden grid-cols-[3rem_minmax(0,2.6fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_4rem_minmax(0,1fr)_2rem] gap-x-6 border-b border-line px-4 py-3 lg:grid"
      >
        {["no.", "sale", "state", "who may buy", "ceiling", "raised of target", "buyers", "issuer", ""].map(
          (label, place) => (
            <span key={place} className={LABEL}>
              {label}
            </span>
          )
        )}
      </div>

      {failure !== null ? (
        <p
          className="mt-10 max-w-[52ch] border-l-2 pl-5 text-[16px] leading-relaxed"
          style={{ borderColor: "var(--refused)" }}
        >
          {failure}
        </p>
      ) : empty ? (
        <p className="mt-10 max-w-[52ch] border-l-2 border-line pl-5 text-[16px] leading-relaxed text-muted">
          The Pangu program holds no sale this app can read yet. Launch one, or press try again in a moment.
        </p>
      ) : (
        <ol className="relative">
          {directory.sales.map((sale, index) => (
            <Row key={sale.mint} sale={sale} index={index} still={still} now={now} />
          ))}
        </ol>
      )}

      <div className="mt-8 flex flex-col gap-2 text-[13px] leading-relaxed text-muted sm:flex-row sm:flex-wrap sm:gap-x-8">
        {!all && directory.hiddenRetired > 0 && (
          <Link
            href="/sales?all=1"
            className="w-fit border-b border-line pb-0.5 transition-colors hover:border-accent hover:text-accent"
          >
            {`${directory.hiddenRetired} retired demo ${
              directory.hiddenRetired === 1 ? "sale" : "sales"
            } hidden. Show ${directory.hiddenRetired === 1 ? "it" : "them"}`}
          </Link>
        )}
        {all && (
          <Link
            href="/sales"
            className="w-fit border-b border-line pb-0.5 transition-colors hover:border-accent hover:text-accent"
          >
            Hide the retired demo sales
          </Link>
        )}
        {directory.skipped > 0 && (
          <span>
            {`${directory.skipped} ${
              directory.skipped === 1 ? "sale was" : "sales were"
            } opened by an earlier build of the program and cannot be read here, so ${
              directory.skipped === 1 ? "it is" : "they are"
            } left out.`}
          </span>
        )}
      </div>
    </div>
  );
}
