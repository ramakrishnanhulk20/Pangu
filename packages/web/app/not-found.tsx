import Link from "next/link";

import { CurveMark } from "@/components/hero/curve-mark";

const LINK =
  "inline-flex h-11 items-center gap-2 rounded-lg border px-5 text-[14px] font-medium transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

export default function NotFound() {
  return (
    <section className="grain relative isolate flex min-h-[calc(100svh-4rem)] flex-col justify-end overflow-hidden px-[6vw] pb-16 pt-24 sm:pb-24">
      <CurveMark className="pointer-events-none absolute -right-[12vw] top-[8%] -z-10 h-[70vmin] w-[70vmin] opacity-30" />

      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        404, nothing at this address
      </p>
      <h1 className="-ml-[0.02em] mt-6 max-w-[14ch] font-display text-[clamp(3rem,10vw,9rem)] font-semibold leading-[0.9] tracking-[-0.045em]">
        This page is off the curve.
      </h1>

      <div className="mt-12 flex flex-wrap gap-4">
        <Link href="/" className={`${LINK} border-accent bg-accent text-accent-ink`}>
          Back to the sale
          <span aria-hidden="true">&rarr;</span>
        </Link>
        <Link href="/docs" className={`${LINK} border-line text-ink hover:border-ink`}>
          Read the docs
        </Link>
      </div>
    </section>
  );
}
