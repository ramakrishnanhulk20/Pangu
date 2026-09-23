"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";

import type { HolderRow, SaleReadout } from "@/lib/readout";

import { explorerAddress, percent, shortAddress } from "./format";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Counts up to the number devnet just gave.
 *
 * The true value is what the server rendered, so it is in the HTML from the
 * first paint. The count is written straight to the text node, so no frame of
 * it re-renders React.
 */
export function Counting({
  value,
  format,
  still,
  revealed,
  unit = "",
}: {
  value: number;
  format: (value: number) => string;
  still: boolean;
  /** The count starts when the section comes into view, and only then. */
  revealed: boolean;
  /**
   * What the number is counted in. When it changes, the count starts again
   * from zero, so a switch from a dollar sale to a SOL sale never passes
   * through dollar amounts written as SOL on its way down.
   */
  unit?: string;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const countedIn = useRef(unit);

  useEffect(() => {
    const element = node.current;
    if (still || !revealed || element === null) {
      return;
    }

    if (countedIn.current !== unit) {
      countedIn.current = unit;
      from.current = 0;
    }

    const begin = from.current;
    const start = performance.now();
    let handle = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 1100);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = begin + (value - begin) * eased;
      from.current = next;
      element.textContent = format(next);
      if (t < 1) {
        handle = window.requestAnimationFrame(step);
      }
    };

    handle = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(handle);
  }, [value, still, revealed, format, unit]);

  return <span ref={node}>{format(value)}</span>;
}

/**
 * The largest wallet's slice of the whole sale, the basis the cap is written
 * on. The readout also carries its slice of what has sold so far, which is a
 * different number and reads like a broken cap when set beside this one.
 */
export function largestOfSale(readout: SaleReadout): number {
  const largest = readout.holders[0]?.shares ?? 0;
  return readout.saleSize > 0 ? largest / readout.saleSize : 0;
}

export function Stat({
  label,
  children,
  note,
  quiet = false,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
  /** A second-rank number sits smaller, so the eye still lands on the price. */
  quiet?: boolean;
}) {
  return (
    <div className="py-5">
      <div className="font-mono text-[10px] uppercase leading-none tracking-[0.18em] text-muted">
        {label}
      </div>
      <div
        className={`mt-2.5 tabular-nums leading-none ${
          quiet ? "text-[22px]" : "font-display text-[34px] tracking-[-0.02em]"
        }`}
      >
        {children}
      </div>
      {note !== undefined && (
        <div className="mt-2 text-[13px] leading-snug text-muted">{note}</div>
      )}
    </div>
  );
}

/** A thin bar for one number against the number it is measured against. */
export function Bar({
  share,
  still,
  revealed,
  tone = "accent",
}: {
  share: number;
  still: boolean;
  revealed: boolean;
  tone?: "accent" | "line";
}) {
  const width = `${Math.min(100, Math.max(0, share * 100))}%`;

  return (
    <div className="mt-3 h-[3px] w-full bg-line">
      <motion.div
        className={`h-full ${tone === "accent" ? "bg-accent" : "bg-ink"}`}
        initial={still ? false : { width: 0 }}
        animate={{ width: revealed || still ? width : 0 }}
        transition={still ? { duration: 0 } : { duration: 1.1, ease: EASE }}
      />
    </div>
  );
}

function ExternalMark() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <path d="M4 8L8.5 3.5" />
      <path d="M4.6 3.5H8.5V7.4" />
    </svg>
  );
}

/**
 * The wallets holding this sale, biggest first, each one an account a judge
 * can open on the explorer.
 */
export function Holders({
  holders,
  still,
  revealed,
}: {
  holders: HolderRow[];
  still: boolean;
  revealed: boolean;
}) {
  if (holders.length === 0) {
    return (
      <div className="py-5 text-[13px] text-muted">
        No wallet has bought yet, so there is nothing to show here. The first buy
        opens this list.
      </div>
    );
  }

  return (
    <div className="py-5">
      <div className="font-mono text-[10px] uppercase leading-none tracking-[0.18em] text-muted">
        who holds it, biggest first
      </div>
      <ul className="mt-3.5 space-y-2">
        {holders.map((holder, index) => (
          <motion.li
            key={holder.wallet}
            initial={still ? false : { opacity: 0, y: 10 }}
            animate={
              revealed || still ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }
            }
            transition={
              still
                ? { duration: 0 }
                : { duration: 0.5, delay: 0.5 + index * 0.05, ease: EASE }
            }
            className="flex items-center gap-3"
          >
            <a
              href={explorerAddress(holder.wallet)}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-1.5 font-mono text-[12px] text-muted transition-colors hover:text-ink"
            >
              {shortAddress(holder.wallet)}
              <ExternalMark />
            </a>
            <div className="h-px flex-1 bg-line" />
            <span className="tabular-nums text-[13px] text-muted">
              {percent(holder.share)}
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
