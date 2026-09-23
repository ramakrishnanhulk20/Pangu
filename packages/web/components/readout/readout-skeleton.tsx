import { CHAIN } from "@/lib/network";

/**
 * Holds the shape of the section while the chain is answering.
 *
 * The heading row is the loaded section's own, word for word and class for
 * class, so nothing above the numbers moves when they land. It carries the
 * anchor id as well, so the hero's one action can carry a visitor down here
 * before the numbers have landed.
 */
export function ReadoutSkeleton({ id }: { id: string }) {
  return (
    <section
      id={id}
      aria-label={`Reading the sale from ${CHAIN.label}`}
      className="relative isolate overflow-hidden border-t border-line px-[6vw] py-20 sm:py-28"
    >
      <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            <span className="h-2 w-2 shrink-0 rounded-full bg-pending" />
            {`reading ${CHAIN.inSentence}`}
          </div>
          <h2 className="mt-5 max-w-[15ch] font-display text-[clamp(2.25rem,4.6vw,3.9rem)] font-semibold leading-[0.92] tracking-[-0.035em]">
            Watch the price find itself.
          </h2>
        </div>

        <div className="flex max-w-[38ch] flex-col gap-5">
          <p className="text-[16px] leading-[1.5] text-muted">
            Every share on this drawing came off Meteora&rsquo;s curve. The cap on one
            wallet lies under it at the width it really has.
          </p>
          <div className="flex flex-wrap gap-2" aria-hidden="true">
            <span className="h-[46px] w-40 animate-pulse rounded-lg border border-line" />
            <span className="h-[46px] w-40 animate-pulse rounded-lg border border-line" />
          </div>
        </div>
      </div>

      <div className="relative mt-12 grid gap-y-12 lg:mt-16 lg:grid-cols-12 lg:gap-x-12">
        <div className="h-[280px] animate-pulse rounded-lg bg-raised sm:h-[420px] lg:col-span-8" />
        <div className="divide-y divide-line border-t border-line lg:col-span-4">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="py-5">
              <div className="h-2 w-28 animate-pulse rounded bg-line" />
              <div className="mt-3 h-7 w-40 animate-pulse rounded bg-line" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
