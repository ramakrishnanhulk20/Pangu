"use client";

import Link from "next/link";
import { useState } from "react";

import { Reveal } from "@/components/story/reveal";
import { explorerTxOn } from "@/lib/network";

// Every figure below is copied from a file in the repository, named in the
// comment above it. Nothing here is rounded, guessed, or live.

// docs/measurements/test-counts.md, the runs of 23 September 2026: 31 Rust,
// 141 on solana-bankrun, 38 fork steps from the program's own suite on the
// SBPF v3 build, 178 sdk, 126 scripts.
const SUITES = [
  { count: "31", label: "Rust tests" },
  { count: "141", label: "unit tests" },
  { count: "38", label: "forked mainnet steps" },
  { count: "178", label: "package tests" },
  { count: "126", label: "script tests" },
];

// docs/measurements/devnet-run.md, the sixth run. The link is PBAND2's buy
// refused at the ceiling. The 16 of 19 below is that run: 9 attacks on PBAND2
// and 10 on the credential sale PVRFD, 8 refused on each, and 3 allowed as
// expected, one attested buy under the cap and two sells.
// The run was on devnet, so the link stays on devnet whatever network the app
// is built for.
const REFUSAL_LINK = explorerTxOn(
  "devnet",
  "4LXby4FwaytfNkRtj6TwyMWsm92iZFbyTEG6mvf8iwMxMdbwgKFaczDWMuexBgiqmK58UDFJ6iusQQt51vaEAYRc"
);

const REPOSITORY: string = "https://github.com/ramakrishnanhulk20/Pangu";

const LEDGER = [
  {
    figure: "16 of 19",
    title: "attacks on devnet, refused as expected",
    body: "The other three went through, as they should: a wallet the verifier had attested buying under its cap, and two sells back to the pool, because nothing in the rules can close the exit.",
    link: { href: REFUSAL_LINK, label: "the buy refused above Apple's price" },
  },
  {
    figure: "4",
    title: "forged price attempts, all refused",
    body: "A price signed by a key that is not an oracle, a price altered after signing, a real price for another stock aimed at this account, and a real price replayed once it had aged out.",
    link: null,
  },
  {
    figure: "8",
    title: "code review findings, all fixed",
    body: "The serious one: an issuer who kept the power to mint could have minted past every rule. A sale now refuses to open on a token that still has it.",
    link: null,
  },
];

/**
 * A long value in short form. The whole value sits in the title for a hover and
 * one press copies it, so nobody has to select forty characters by hand.
 */
function ShortValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);

  const copy = () => {
    // The clipboard is only offered on a secure page. Anywhere else the press
    // spells the whole value out to select by hand, instead of failing silently.
    const writing =
      typeof navigator.clipboard?.writeText === "function"
        ? navigator.clipboard.writeText(value)
        : Promise.reject(new Error("no clipboard here"));
    writing.then(
      () => setCopied(true),
      () => setCopied(false)
    );
  };

  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{label}</span>
      <span title={value} className="break-all text-paper/80">
        {copied === false ? value : `${value.slice(0, 6)}...${value.slice(-6)}`}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`copy the full ${label}`}
        className="rounded border border-paper/25 px-2 py-0.5 uppercase tracking-[0.14em] text-paper/70 transition-colors hover:border-paper hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
      >
        {copied === true ? "copied" : copied === false ? "select it by hand" : "copy"}
      </button>
    </p>
  );
}

export function Proof() {
  return (
    <section data-testid="proof" className="relative">
      <div className="mx-auto w-full max-w-[1500px] px-[6vw] pb-16">
        <Reveal>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            Proof
          </p>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-[13ch] font-display text-[clamp(2.4rem,7vw,5.5rem)] font-semibold leading-[0.9] tracking-[-0.04em]">
            Every number here was run
          </h2>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mt-8 max-w-[52ch] text-[17px] leading-[1.5] text-muted">
            The suites, the refused transactions and the deploy itself. Each one
            traces back to a file in the repository, and each attack below landed
            on Solana devnet and was turned away by the program.
          </p>
        </Reveal>
      </div>

      <div className="bg-ink text-paper">
        <div className="mx-auto w-full max-w-[1500px] px-[6vw] py-16 sm:py-24">
          <Reveal>
            <dl className="grid grid-cols-2 border-t border-paper/15 sm:grid-cols-5">
              {SUITES.map((suite) => (
                <div
                  key={suite.label}
                  className="border-b border-paper/15 py-7 last:col-span-2 sm:col-span-1 sm:border-b-0 sm:border-r sm:pr-6 sm:last:border-r-0"
                >
                  <dd className="font-display text-[clamp(2.75rem,6vw,4.5rem)] font-semibold leading-[0.85] tracking-[-0.04em] tabular-nums">
                    {suite.count}
                  </dd>
                  <dt className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-paper/55">
                    {suite.label}
                  </dt>
                </div>
              ))}
            </dl>
          </Reveal>

          <div className="mt-6">
            {LEDGER.map((row, position) => (
              <Reveal key={row.title} delay={0.05 * position}>
                <div className="grid grid-cols-1 gap-4 border-t border-paper/15 py-10 sm:grid-cols-12 sm:gap-8">
                  <p className="font-display text-[clamp(2.5rem,5.5vw,4rem)] font-semibold leading-[0.85] tracking-[-0.04em] tabular-nums sm:col-span-5">
                    {row.figure}
                  </p>
                  <div className="sm:col-span-7">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/55">
                      {row.title}
                    </p>
                    <p className="mt-4 max-w-[56ch] text-[17px] leading-[1.55]">
                      {row.body}
                    </p>
                    {row.link !== null && (
                      <a
                        href={row.link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-5 inline-block border-b border-paper/30 pb-1 font-mono text-[11px] uppercase tracking-[0.16em] text-paper/70 transition-colors hover:border-paper hover:text-paper"
                      >
                        {row.link.label}
                      </a>
                    )}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* docs/deployments.md, the seventh deploy. */}
          <Reveal>
            <div className="grid grid-cols-1 gap-4 border-t border-paper/15 py-10 font-mono text-[11px] leading-[1.7] text-paper/55 sm:grid-cols-12 sm:gap-8">
              <p className="uppercase tracking-[0.18em] sm:col-span-5">
                Seventh devnet deploy
              </p>
              <div className="sm:col-span-7">
                <p className="text-paper">
                  slot 503286300, 24 September 2026, SBPF v3, 339,848 bytes
                </p>
                <ShortValue
                  label="sha256"
                  value="7082897943e68901f85c8c93e2581a8a3571af41491ac9f242286592f4b388f8"
                />
                <ShortValue label="program" value="4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG" />
              </div>
            </div>
          </Reveal>

          <Reveal>
            <div className="flex flex-col gap-3 border-t border-paper/15 pt-10 font-mono text-[11px] uppercase tracking-[0.16em] sm:flex-row sm:gap-10">
              <Link
                href="/docs/rubric"
                className="border-b border-paper/30 pb-1 text-paper/70 transition-colors hover:border-paper hover:text-paper"
              >
                The rubric, line by line
              </Link>
              <Link
                href="/docs/security"
                className="border-b border-paper/30 pb-1 text-paper/70 transition-colors hover:border-paper hover:text-paper"
              >
                The threat model
              </Link>
              {REPOSITORY === "" ? (
                <span className="pb-1 text-paper/40">
                  The repository, published with the submission
                </span>
              ) : (
                <a
                  href={REPOSITORY}
                  target="_blank"
                  rel="noreferrer"
                  className="border-b border-paper/30 pb-1 text-paper/70 transition-colors hover:border-paper hover:text-paper"
                >
                  The repository
                </a>
              )}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
