"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import Link from "next/link";
import { useRef } from "react";

import { explorerAddress, shortAddress } from "@/components/readout/format";
import { ceilingWords, stateWords, whoMayBuy } from "@/components/sales/words";
import type { DirectorySale } from "@/lib/directory";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The sale's poster: its ticker set huge, its name under it, and a credits row
 * of the facts a buyer checks first. The ticker drifts up as the page scrolls.
 */
export function SaleTitle({ sale }: { sale: DirectorySale }) {
  const still = useReducedMotion() === true;
  const frame = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: frame, offset: ["start start", "end start"] });
  const drift = useTransform(scrollYProgress, [0, 1], [0, still ? 0 : -90]);
  const fade = useTransform(scrollYProgress, [0, 0.9], [1, still ? 1 : 0.25]);

  const rise = (delay: number) => ({
    initial: still ? false : ({ opacity: 0, y: 36 } as const),
    animate: { opacity: 1, y: 0 },
    transition: still ? { duration: 0 } : { duration: 0.9, delay, ease: EASE },
  });

  const state = stateWords(sale);
  const ceiling = ceilingWords(sale);
  const credits: { label: string; value: React.ReactNode }[] = [
    { label: "state", value: `${state.word}, ${state.detail}` },
    { label: "who may buy", value: whoMayBuy(sale.accessMode).short },
    { label: "price ceiling", value: ceiling ?? "none" },
    { label: "paid in", value: sale.money === "SOL" ? "SOL" : sale.demoDollar ? "demo dollars" : "dollars" },
    {
      label: "issuer",
      value: (
        <a
          href={explorerAddress(sale.issuer)}
          target="_blank"
          rel="noreferrer"
          className="font-mono transition-colors hover:text-accent"
        >
          {shortAddress(sale.issuer)}
        </a>
      ),
    },
    {
      label: "mint",
      value: (
        <a
          href={explorerAddress(sale.mint)}
          target="_blank"
          rel="noreferrer"
          className="font-mono transition-colors hover:text-accent"
        >
          {shortAddress(sale.mint)}
        </a>
      ),
    },
  ];

  return (
    <header
      ref={frame}
      data-testid="sale-title"
      className="grain relative isolate overflow-hidden px-[6vw] pb-14 pt-10 sm:pb-20 sm:pt-14"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[10%] -top-40 -z-10 h-[560px] w-[560px] rounded-full opacity-[0.14] blur-[130px]"
        style={{ background: "var(--accent)" }}
      />

      <motion.div {...rise(0)}>
        <Link
          href="/sales"
          className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-ink"
        >
          <span aria-hidden="true" className="transition-transform duration-200 group-hover:-translate-x-1">
            &larr;
          </span>
          every sale on the chain
        </Link>
      </motion.div>

      <motion.div style={{ y: drift, opacity: fade }}>
        <h1 className="-ml-[0.04em] mt-8 overflow-hidden pb-[0.05em]">
          <motion.span
            {...rise(0.08)}
            className="block break-all font-display text-[clamp(3rem,10vw,9rem)] font-semibold leading-[0.88] tracking-[-0.05em]"
          >
            {sale.symbol === "" ? shortAddress(sale.mint) : sale.symbol}
          </motion.span>
        </h1>
        <motion.p
          {...rise(0.18)}
          className="mt-4 max-w-[28ch] font-display text-[clamp(1.4rem,2.6vw,2.2rem)] leading-[1.08] tracking-[-0.02em] text-muted"
        >
          {sale.name}
          {sale.retired && (
            <span className="ml-3 align-middle font-mono text-[11px] uppercase tracking-[0.16em] text-refused">
              retired demo sale
            </span>
          )}
        </motion.p>
      </motion.div>

      <motion.dl
        {...rise(0.3)}
        className="mt-12 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-line pt-6 sm:grid-cols-3 lg:grid-cols-6"
      >
        {credits.map((credit) => (
          <div key={credit.label}>
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{credit.label}</dt>
            <dd className="mt-1.5 text-[14px] leading-snug">{credit.value}</dd>
          </div>
        ))}
      </motion.dl>
    </header>
  );
}
