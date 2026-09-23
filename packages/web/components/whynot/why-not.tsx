"use client";

import { Reveal } from "@/components/story/reveal";

// Four straight answers, taken from docs/site/why-not.md. No cards: a thin
// accent rule opens each one and the column shifts right as the list goes down.
const ANSWERS = [
  {
    title: "A plain launchpad",
    lines: [
      "With no rules program in front of it, the fastest bot or the biggest wallet can take most of a sale in the first block.",
      "That is the outcome a stock token's first buyers should be protected from, and Pangu is that protection, built as a small program the token calls on every move, so no other app or wallet can skip it.",
    ],
  },
  {
    title: "Meteora Alpha Vault",
    lines: [
      "Meteora's own fairness product is a good one, but it only sits in front of Meteora's trading pools, so it cannot attach to a bonding curve at all.",
      "It also sells at one price decided in advance, while Pangu's rules run inside a live curve, which is exactly the moment first buyers need protecting.",
    ],
  },
  {
    title: "Meteora Presale Vault",
    lines: [
      "The presale vault runs a capped sale for wallets on the approved list before any market exists: a fixed price, first come, or a split in proportion, with no curve and no price discovery.",
      "Pangu's rules run inside the Meteora curve all the way to graduation, and selling back to the pool is always allowed.",
    ],
  },
  {
    title: "A fixed price",
    lines: [
      "Naming a number and selling at it until it runs out throws away the one thing a bonding curve is good at: finding out what buyers will actually pay.",
      "It also leaves nothing to measure a runaway price against, which is the live number Pangu's optional ceiling checks on every buy.",
    ],
  },
];

// Each answer steps further right than the one above it.
const INDENTS = ["sm:pl-0", "sm:pl-8", "sm:pl-16", "sm:pl-24"];

export function WhyNot() {
  return (
    <section
      data-testid="why-not"
      className="mx-auto w-full max-w-[1500px] px-[6vw] pt-8 pb-28 sm:pb-36"
    >
      <div className="grid grid-cols-1 gap-12 sm:grid-cols-12 sm:gap-8">
        <div className="sm:col-span-5 sm:sticky sm:top-28 sm:self-start">
          <Reveal>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              Why not
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 max-w-[12ch] font-display text-[clamp(2.4rem,6vw,4.75rem)] font-semibold leading-[0.92] tracking-[-0.04em]">
              Why not the tools that already exist
            </h2>
          </Reveal>
        </div>

        <div className="sm:col-span-7">
          {ANSWERS.map((answer, position) => (
            <Reveal
              key={answer.title}
              delay={0.05 * position}
              className={`${position === 0 ? "" : "mt-16 sm:mt-20 "}${INDENTS[position]}`}
            >
              <div className="group">
                <span className="block h-px w-16 bg-accent transition-[width] duration-500 group-hover:w-28" />
                <h3 className="mt-6 font-display text-[clamp(1.5rem,2.6vw,2.25rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
                  {answer.title}
                </h3>
                <p className="mt-4 max-w-[58ch] text-[17px] leading-[1.55] text-muted">
                  {answer.lines[0]}{" "}
                  <span className="text-ink">{answer.lines[1]}</span>
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
