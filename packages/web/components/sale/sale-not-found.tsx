import Link from "next/link";

import { CurveMark } from "@/components/hero/curve-mark";

const LINK =
  "inline-flex h-11 items-center gap-2 rounded-lg border px-5 text-[14px] font-medium transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

/**
 * A mint the Pangu program holds no sale for, or a read devnet did not answer.
 * The two are told apart: only the second is worth trying again.
 */
export function SaleNotFound({ mint, unanswered }: { mint: string; unanswered: boolean }) {
  return (
    <section
      data-testid="sale-not-found"
      className="grain relative isolate flex min-h-[calc(100svh-4rem)] flex-col justify-end overflow-hidden px-[6vw] pb-16 pt-24 sm:pb-24"
    >
      <CurveMark className="pointer-events-none absolute -right-[12vw] top-[8%] -z-10 h-[70vmin] w-[70vmin] opacity-20" />

      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {unanswered ? "devnet did not answer" : "no sale at this address"}
      </p>
      <h1 className="-ml-[0.02em] mt-6 max-w-[13ch] font-display text-[clamp(3rem,10vw,9rem)] font-semibold leading-[0.9] tracking-[-0.045em]">
        {unanswered ? "The chain went quiet." : "No sale on this mint."}
      </h1>
      <p className="mt-8 max-w-[52ch] text-[16px] leading-relaxed text-muted">
        {unanswered
          ? "The read of every sale did not come back, so this page cannot say whether this mint has one. Reload in a moment."
          : "The Pangu program on devnet holds no rules for this mint, so there is nothing to buy here. Check the address, or pick a sale from the list."}
      </p>
      <p className="mt-3 break-all font-mono text-[12px] text-muted">{mint.slice(0, 64)}</p>

      <div className="mt-12 flex flex-wrap gap-4">
        <Link href="/sales" className={`${LINK} border-accent bg-accent text-accent-ink`}>
          Every sale on the chain
          <span aria-hidden="true">&rarr;</span>
        </Link>
        <Link href="/" className={`${LINK} border-line text-ink hover:border-ink`}>
          Back to the front page
        </Link>
      </div>
    </section>
  );
}
