"use client";

import { motion, useReducedMotion } from "framer-motion";

import { shortAddress } from "@/lib/format";

export interface SaleRow {
  mint: string;
  name: string;
  symbol: string;
  status: string;
  access: string;
  cap: string;
  buyers: string;
  sold: string;
  band: string;
}

function Field({ label, value }: { label: string; value: string }) {
  if (value === "") {
    return null;
  }
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
        {label}
      </div>
      <div className="mt-1 truncate text-sm">{value}</div>
    </div>
  );
}

export function SaleRows({ rows }: { rows: SaleRow[] }) {
  const reduced = useReducedMotion();

  return (
    <ul
      data-testid="sale-board"
      className="divide-y divide-line border-y border-line"
    >
      {rows.map((row, index) => (
        <motion.li
          key={row.mint}
          data-testid="sale-row"
          initial={reduced ? false : { opacity: 0, y: 24 }}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.5, delay: Math.min(index * 0.06, 0.4), ease: [0.22, 1, 0.36, 1] }}
          className="py-5 transition-colors hover:bg-raised"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-base font-medium">{row.name}</span>
            <span className="text-xs uppercase tracking-[0.14em] text-muted">
              {row.symbol}
            </span>
            <span className="text-xs text-muted">{row.status}</span>
            <a
              href={`https://explorer.solana.com/address/${row.mint}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
            >
              {shortAddress(row.mint)}
            </a>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Field label="Access" value={row.access} />
            <Field label="Cap per wallet" value={row.cap} />
            <Field label="Buyers" value={row.buyers} />
            <Field label="Total sold" value={row.sold} />
            <Field label="Price band" value={row.band} />
          </div>
        </motion.li>
      ))}
    </ul>
  );
}
