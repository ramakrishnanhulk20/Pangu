"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { PANGU_PROGRAM_ID } from "pangu-sdk";

import { shortAddress } from "@/lib/format";

import { CurveMark } from "./hero/curve-mark";

const programId = PANGU_PROGRAM_ID.toBase58();
const explorer = `https://explorer.solana.com/address/${programId}?cluster=devnet`;

/**
 * The last band of every page. Not mounted here: the root layout owns where it
 * goes.
 */
export function SiteFooter() {
  const still = useReducedMotion();

  return (
    <motion.footer
      initial={still ? false : { opacity: 0, y: 18 }}
      whileInView={still ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="border-t border-line bg-paper"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-3">
          <Link
            href="/"
            className="flex w-fit items-center gap-2 text-sm font-medium tracking-tight transition-opacity hover:opacity-60"
          >
            <CurveMark className="h-5 w-5" />
            Pangu
          </Link>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            Built on Meteora DBC, price by Pyth
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <Link
            href="/docs"
            className="text-muted underline decoration-transparent underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
          >
            Docs
          </Link>
          <a
            href="https://github.com/ramakrishnanhulk20/Pangu"
            target="_blank"
            rel="noreferrer"
            className="text-muted underline decoration-transparent underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
          >
            Repository
          </a>
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            title={programId}
            className="font-mono text-xs text-muted underline decoration-transparent underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
          >
            devnet {shortAddress(programId)}
          </a>
        </nav>
      </div>
    </motion.footer>
  );
}
