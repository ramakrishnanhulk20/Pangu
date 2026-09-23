"use client";

import { motion } from "framer-motion";
import Link from "next/link";

import { money, shortAddress } from "@/components/readout/format";
import { whoMayBuy } from "@/components/sales/words";
import type { Issued } from "@/lib/portfolio";

import { LABEL, SaleMark } from "./holdings-ledger";
import { stateLine } from "./words";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Raised against the target, as a hairline that draws itself once in view. */
function Raised({ sale, still }: { sale: Issued; still: boolean }) {
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
          className="absolute left-0 block origin-left bg-accent"
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

function Row({ sale, index, still }: { sale: Issued; index: number; still: boolean }) {
  const state = stateLine(sale);

  return (
    <motion.li
      data-testid="portfolio-issued-row"
      data-mint={sale.mint}
      initial={still ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={still ? { duration: 0 } : { duration: 0.7, delay: Math.min(index, 8) * 0.06, ease: EASE }}
      className="group relative border-b border-line"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px] origin-top scale-y-0 bg-accent transition-transform duration-500 ease-out group-hover:scale-y-100"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-raised opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-6 px-2 py-7 sm:px-4 lg:grid-cols-[3rem_minmax(0,2.4fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_5rem_minmax(0,1.5fr)_minmax(0,1.3fr)] lg:items-center lg:gap-x-6 lg:py-8">
        <span className="pt-2.5 font-mono text-[11px] tabular-nums text-muted lg:pt-0">
          {String(index + 1).padStart(2, "0")}
        </span>

        <div className="flex min-w-0 gap-3.5">
          <SaleMark uri={sale.uri} name={sale.name} />
          <div className="min-w-0">
            <Link
              href={`/sale/${sale.mint}`}
              className="line-clamp-2 break-words font-display text-[clamp(1.35rem,2.1vw,1.8rem)] font-semibold leading-[1.05] tracking-[-0.025em] transition-colors duration-300 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              {sale.name}
            </Link>
            <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              {sale.symbol === "" ? shortAddress(sale.mint) : sale.symbol}
              {sale.retired && <span className="ml-3 text-refused">retired</span>}
            </p>
          </div>
        </div>

        <dl className="col-span-2 grid grid-cols-2 gap-x-6 gap-y-6 pl-[calc(2.5rem+1rem)] text-[14px] leading-snug sm:grid-cols-3 lg:contents">
          <div>
            <dt className={`${LABEL} lg:sr-only`}>state</dt>
            <dd className="mt-1.5 lg:mt-0">
              <span className="block font-medium">{state.word}</span>
              <span className="mt-1 block text-[12px] text-muted">{state.detail}</span>
            </dd>
          </div>

          <div>
            <dt className={`${LABEL} lg:sr-only`}>who may buy</dt>
            <dd className="mt-1.5 lg:mt-0">{whoMayBuy(sale.accessMode).short}</dd>
          </div>

          <div>
            <dt className={`${LABEL} lg:sr-only`}>buyers</dt>
            <dd className="mt-1.5 font-display text-[22px] tabular-nums lg:mt-0" data-testid="portfolio-issued-buyers">
              {sale.buyers}
            </dd>
          </div>

          <div className="col-span-2 sm:col-span-2 lg:col-span-1">
            <dt className={`${LABEL} lg:sr-only`}>raised of the target</dt>
            <dd className="mt-1.5 text-[13px] lg:mt-0">
              <Raised sale={sale} still={still} />
            </dd>
          </div>

          <div className="col-span-2 sm:col-span-1 lg:col-span-1">
            <dt className="sr-only">issuer controls</dt>
            <dd>
              <Link
                href={`/sale/${sale.mint}#trade`}
                data-testid="portfolio-issuer-controls"
                className="group/action inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink px-3.5 text-[13px] font-medium transition-all duration-200 hover:-translate-y-0.5 hover:border-accent hover:bg-accent hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              >
                Issuer controls
                <span aria-hidden="true" className="transition-transform duration-200 group-hover/action:translate-x-0.5">
                  &rarr;
                </span>
              </Link>
            </dd>
          </div>
        </dl>
      </div>
    </motion.li>
  );
}

const HEADINGS = ["no.", "sale", "state", "who may buy", "buyers", "raised of target", ""];

/** The sales this wallet opened as issuer, each a click from its controls. */
export function IssuedLedger({ issued, still }: { issued: Issued[]; still: boolean }) {
  return (
    <div data-testid="portfolio-issued">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[3rem_minmax(0,2.4fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_5rem_minmax(0,1.5fr)_minmax(0,1.3fr)] gap-x-6 border-b border-line px-4 py-3 lg:grid"
      >
        {HEADINGS.map((label, place) => (
          <span key={place} className={LABEL}>
            {label}
          </span>
        ))}
      </div>
      <ol className="relative">
        {issued.map((sale, index) => (
          <Row key={sale.mint} sale={sale} index={index} still={still} />
        ))}
      </ol>
    </div>
  );
}
