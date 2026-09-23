import Link from "next/link";

const LINK =
  "inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-[14px] font-medium transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

export default function DocsNotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col justify-center px-6 py-20 sm:px-10">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        404, no page at this address
      </p>
      <h1 className="mt-5 max-w-[16ch] font-display text-[clamp(2.4rem,6vw,4.5rem)] font-semibold leading-[0.92] tracking-[-0.04em]">
        This docs page does not exist.
      </h1>
      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/docs" className={`${LINK} border-accent bg-accent text-accent-ink`}>
          Docs overview
          <span aria-hidden="true">&rarr;</span>
        </Link>
        <Link href="/" className={`${LINK} border-line text-ink hover:border-ink`}>
          Back to the sale
        </Link>
      </div>
    </div>
  );
}
