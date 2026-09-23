"use client";

import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

import { utcMoment } from "@/components/readout/format";
import { feedWords } from "@/lib/feeds";
import { accessModeLabel, shortAddress, tokenAmount } from "@/lib/format";
import { explorerAddress, explorerTx, type LaunchResult } from "@/lib/launch";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The launch landed: the new sale as the chain holds it, read back after both
 * transactions confirmed, and the way to it.
 */
export function LaunchDone({ result, name, symbol }: { result: LaunchResult; name: string; symbol: string }) {
  const still = useReducedMotion() === true;
  const [shared, setShared] = useState<"idle" | "copied" | "shown">("idle");
  const salePath = `/sale/${result.mint}`;
  const { sale } = result;

  const share = async () => {
    const url = `${window.location.origin}${salePath}`;
    try {
      await navigator.clipboard.writeText(url);
      setShared("copied");
    } catch {
      setShared("shown");
    }
  };

  const facts: { label: string; value: string }[] = [
    { label: "most one wallet holds", value: `${tokenAmount(BigInt(sale.cap), sale.baseDecimals)} shares` },
    { label: "who may buy", value: accessModeLabel(sale.accessMode) },
    {
      label: "price ceiling",
      value: sale.bandBps === null ? "none" : `${sale.bandBps / 100}% over ${feedWords(sale.priceFeedId).price}`,
    },
    { label: "the offering ends", value: sale.endsAt === null ? "at graduation" : utcMoment(sale.endsAt * 1000) },
  ];
  if (result.spentLamports !== null) {
    facts.push({
      label: result.resumed ? "this press cost" : "the launch cost",
      value: `${(result.spentLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
    });
  }

  const links: { label: string; href: string }[] = [
    { label: "the token", href: explorerAddress(result.mint) },
    { label: "the pool", href: explorerAddress(result.pool) },
    { label: "the sale's rules", href: explorerAddress(result.rules) },
  ];
  if (result.templateSignature !== null) {
    links.push({ label: "template transaction", href: explorerTx(result.templateSignature) });
  }
  if (result.saleSignature !== null) {
    links.push({ label: "sale transaction", href: explorerTx(result.saleSignature) });
  }

  return (
    <motion.div
      data-testid="launch-done"
      data-mint={result.mint}
      initial={still ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={still ? { duration: 0 } : { duration: 0.8, ease: EASE }}
      className="relative"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">live on devnet</p>
      <h2 className="-ml-[0.02em] mt-4 font-display text-[clamp(2.8rem,7vw,5.5rem)] font-semibold leading-[0.9] tracking-[-0.045em]">
        {name}
        <span className="ml-3 align-top font-mono text-[0.22em] font-normal tracking-[0.14em] text-muted">{symbol}</span>
      </h2>
      <p className="mt-5 text-[17px] leading-[1.45]">
        Your sale is open. Token{" "}
        <span
          title={result.mint}
          tabIndex={0}
          className="group relative cursor-help border-b border-dotted border-muted font-mono text-[15px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          {shortAddress(result.mint)}
          <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden whitespace-nowrap rounded-md border border-line bg-raised px-2.5 py-1.5 text-[12px] text-ink shadow-sm group-hover:block group-focus-visible:block">
            {result.mint}
          </span>
        </span>
        , read back from the chain after both transactions landed.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Link
          href={salePath}
          data-testid="launch-open-sale"
          className="group inline-flex h-12 items-center gap-3 rounded-lg bg-accent px-6 text-[15px] font-medium text-accent-ink transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          Open your sale
          <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
            &rarr;
          </span>
        </Link>
        <button
          type="button"
          onClick={() => void share()}
          className="inline-flex h-12 items-center rounded-lg border border-line px-5 text-[15px] transition-all duration-200 hover:-translate-y-0.5 hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          {shared === "copied" ? "Link copied" : "Share this link"}
        </button>
      </div>
      {shared === "shown" && (
        <p className="mt-3 break-all font-mono text-[12px] text-muted">
          {typeof window === "undefined" ? salePath : `${window.location.origin}${salePath}`}
        </p>
      )}

      <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-line pt-6 sm:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="font-mono text-[10px] uppercase leading-none tracking-[0.18em] text-muted">{fact.label}</dt>
            <dd className="mt-2.5 text-[15px] leading-tight tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="border-b border-line pb-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-accent hover:text-accent"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
