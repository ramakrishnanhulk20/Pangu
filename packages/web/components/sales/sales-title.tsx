"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The directory's poster: the title rises line by line on load, and the count
 * of sales the chain holds sits beside it like a film's running time.
 */
export function SalesTitle({ count }: { count: number | null }) {
  const still = useReducedMotion() === true;
  const rise = (delay: number) => ({
    initial: still ? false : ({ opacity: 0, y: 40 } as const),
    animate: { opacity: 1, y: 0 },
    transition: still ? { duration: 0 } : { duration: 0.9, delay, ease: EASE },
  });

  return (
    <header className="mx-auto max-w-[1500px]">
      <div>
        <motion.p
          {...rise(0)}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted"
        >
          the directory, read off the Pangu program
        </motion.p>
        <h1 className="-ml-[0.03em] mt-6 font-display text-[clamp(3rem,10vw,9rem)] font-semibold leading-[0.88] tracking-[-0.05em]">
          <span className="block overflow-hidden pb-[0.04em]">
            <motion.span {...rise(0.08)} className="block">
              Every sale
            </motion.span>
          </span>
          <span className="block overflow-hidden pb-[0.06em]">
            <motion.span {...rise(0.18)} className="block">
              on the chain
              {count !== null && (
                <sup className="ml-[0.08em] align-top font-mono text-[0.18em] font-normal tracking-[0.02em] text-accent">
                  {String(count).padStart(2, "0")}
                </sup>
              )}
            </motion.span>
          </span>
        </h1>
      </div>

      <motion.div
        {...rise(0.3)}
        className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-12 lg:ml-[0.4vw]"
      >
        <p className="max-w-[40ch] text-[16px] leading-[1.55] text-muted">
          Found by scanning the program itself, not a list anyone keeps. A sale
          launched a minute ago is already here, with its rules, its buyers and
          what it has raised.
        </p>
        <Link
          href="/launch"
          className="group inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-ink px-5 text-[14px] font-medium transition-all duration-200 hover:-translate-y-0.5 hover:border-accent hover:bg-accent hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          Launch a sale
          <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
            &rarr;
          </span>
        </Link>
      </motion.div>
    </header>
  );
}
