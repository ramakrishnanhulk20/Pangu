"use client";

import Link from "next/link";

import { Reveal } from "@/components/story/reveal";

// Every figure below is copied from a file in the repository, named in the
// comment above it. Nothing here is rounded, guessed, or live.

// docs/measurements/test-counts.md: 27 Rust, 125 mocha, 36 fork, 117 sdk,
// 49 scripts.
const SUITES = [
  { count: "27", label: "Rust tests" },
  { count: "125", label: "unit tests" },
  { count: "36", label: "forked mainnet steps" },
  { count: "117", label: "package tests" },
  { count: "49", label: "script tests" },
];

// docs/measurements/devnet-run.md. The link is the fifth run's buy refused at
// the ceiling on the demo sale. The 16 of 18 below is the fifth run: 9 attacks
// on the demo sale and 9 on the list sale, each 8 refused and 1 sell allowed.
const REFUSAL_LINK =
  "https://explorer.solana.com/tx/3FMhcSoCkFCp3PBMBjaejwEiXVmdDAREJCDaP2bYw2u2hGxanesdx5vi2cEU2ZMK1obRZhcUgWFKQ1tqMUy8sXDU?cluster=devnet";

const REPOSITORY: string = "https://github.com/ramakrishnanhulk20/Pangu";

const LEDGER = [
  {
    figure: "16 of 18",
    title: "attacks on devnet, refused as expected",
    body: "The other two were sells back to the pool, one by a holder of the open demo sale and one by a wallet whose approval had been taken away. Both went through, because nothing in the rules can close the exit.",
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

          {/* docs/measurements/devnet-run.md, "The fourth run", and
              docs/deployments.md for the date. */}
          <Reveal>
            <div className="grid grid-cols-1 gap-4 border-t border-paper/15 py-10 font-mono text-[11px] leading-[1.7] text-paper/55 sm:grid-cols-12 sm:gap-8">
              <p className="uppercase tracking-[0.18em] sm:col-span-5">
                Fourth devnet deploy
              </p>
              <div className="sm:col-span-7">
                <p className="text-paper">
                  slot 502476730, 22 September 2026, 358,248 bytes
                </p>
                <p className="mt-3 break-all">
                  sha256 a937c610ab35442df59e0ead889a98ea8acafb396f2de9f2c37355ee5a555beb
                </p>
                <p className="mt-3 break-all">
                  program 4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG
                </p>
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

      {/* The site footer, components/site-footer.tsx, mounts here on the front
          page. Nothing else goes below this section. */}
    </section>
  );
}
