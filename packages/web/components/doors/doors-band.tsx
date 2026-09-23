"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import type { ReactNode } from "react";

import { Reveal } from "@/components/story/reveal";
import { CHAIN } from "@/lib/network";

export type DoorKey = "buy" | "launch" | "vouch" | "holdings";

interface Door {
  key: DoorKey;
  title: string;
  body: string;
  href: string;
  cue: string;
}

const LEAD: Door = {
  key: "buy",
  title: "Buy a stock token",
  body: "Pick a running sale, connect a wallet and buy on the curve. The program checks your cap and, on a sale with a ceiling, the live stock price on every buy.",
  href: "/sales",
  cue: "Every sale",
};

// Listed top to bottom. The curve behind them climbs to the right, so the top
// door sits furthest right and each one below steps back toward the lead.
const STEPS: Door[] = [
  {
    key: "launch",
    title: "Launch your sale",
    body: "Name the token, choose what buyers pay in, set the most one wallet can hold and who may buy, then open it on Meteora's curve from one form.",
    href: "/launch",
    cue: "Open the form",
  },
  {
    key: "vouch",
    title: "Vouch for buyers",
    body: "Set up as a verifier, issue a credential to each wallet you have checked, and any sale that names you lets only those wallets buy.",
    href: "/verify",
    cue: "Become a verifier",
  },
  {
    key: "holdings",
    title: "See your holdings",
    body: "Connect a wallet to see every sale it bought into or issued, what it holds, and the room it has left under each cap.",
    href: "/portfolio",
    cue: "Your portfolio",
  },
];

const INDENTS = ["sm:ml-[22%]", "sm:ml-[11%]", "sm:ml-0"];

function Cue({ label }: { label: string }) {
  return (
    <span className="mt-6 inline-flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted transition-colors group-hover:text-ink group-focus-visible:text-ink">
      <span className="relative pb-1">
        {label}
        <span className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-accent transition-transform duration-500 group-hover:scale-x-100 group-focus-visible:scale-x-100" />
      </span>
      <span
        aria-hidden="true"
        className="transition-transform duration-300 group-hover:translate-x-1.5 group-focus-visible:translate-x-1.5"
      >
        &rarr;
      </span>
    </span>
  );
}

const DOOR_LINK =
  "group relative block rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-accent";

/**
 * The site's mark drawn large behind the doors: the curve, the cap line and
 * the one wallet sitting under it. Drawn in once as the band comes into view.
 * It stretches with the grid, and at this band's proportions the two axes
 * scale within a few percent of each other, so the line keeps its shape.
 */
function DoorsCurve() {
  const still = useReducedMotion() === true;
  const draw = (delay: number, duration: number) =>
    still ? { duration: 0 } : { duration, delay, ease: [0.65, 0, 0.35, 1] as const };
  const seen = { once: true, amount: 0.3 } as const;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1000 700"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 -z-10 hidden h-[calc(100%+4rem)] w-full sm:block"
      style={{ filter: "var(--motif-glow)" }}
    >
      <motion.path
        d="M0 694 C 300 692, 440 670, 470 530 S 540 110, 585 0"
        fill="none"
        stroke="var(--motif-line)"
        strokeWidth="1.3"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={seen}
        transition={draw(0.1, 1.8)}
      />
      <motion.path
        d="M430 12 H 1000"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.1"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={seen}
        transition={draw(1.3, 0.9)}
      />
      <motion.circle
        cx="571"
        cy="40"
        r="6"
        fill="var(--accent)"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        initial={{ opacity: 0, scale: 0.3 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={seen}
        transition={still ? { duration: 0 } : { duration: 0.6, delay: 2.1, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

export function DoorsBand({ figures }: { figures: Record<DoorKey, ReactNode> }) {
  return (
    <section data-testid="doors" className="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[18%] top-[8%] -z-10 h-[520px] w-[520px] rounded-full opacity-[0.1] blur-[120px]"
        style={{ background: "var(--accent)" }}
      />

      <div className="mx-auto w-full max-w-[1500px] px-[6vw] pt-24 pb-28 sm:pt-32 sm:pb-40">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-12 sm:items-end">
          <div className="sm:col-span-8">
            <Reveal>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                Four doors
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="mt-6 font-display text-[clamp(3rem,10vw,9rem)] font-semibold leading-[0.88] tracking-[-0.05em]">
                Now it&rsquo;s <span className="text-accent">yours</span>
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.16} className="sm:col-span-4 sm:pb-3">
            <p className="max-w-[40ch] text-[17px] leading-[1.5] text-muted">
              The rules you just watched hold are the same ones behind each of
              these pages, and every count here is read off {CHAIN.inSentence} as
              the page loads.
            </p>
          </Reveal>
        </div>

        <div className="relative isolate mt-20 grid grid-cols-1 gap-16 sm:mt-24 sm:grid-cols-12 sm:gap-8">
          <DoorsCurve />

          <Reveal className="sm:col-span-6 sm:self-end sm:pb-4">
            <Link href={LEAD.href} className={DOOR_LINK} data-testid="door-buy">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">01</p>
              <div className="mt-6">{figures.buy}</div>
              <span className="mt-10 block h-px w-20 bg-accent transition-[width] duration-500 group-hover:w-40 group-focus-visible:w-40" />
              <h3 className="mt-6 font-display text-[clamp(2rem,4.2vw,3.5rem)] font-semibold leading-[0.95] tracking-[-0.04em] transition-colors group-hover:text-accent">
                {LEAD.title}
              </h3>
              <p className="mt-5 max-w-[48ch] text-[17px] leading-[1.55] text-muted">
                {LEAD.body}
              </p>
              <Cue label={LEAD.cue} />
            </Link>
          </Reveal>

          <div className="flex flex-col gap-14 sm:col-span-6 sm:gap-16">
            {STEPS.map((door, position) => (
              <Reveal key={door.key} delay={0.08 * (position + 1)} className={INDENTS[position]}>
                <Link href={door.href} className={DOOR_LINK} data-testid={`door-${door.key}`}>
                  <div className="flex items-start gap-6 sm:gap-8">
                    <p className="pt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                      0{position + 2}
                    </p>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-[clamp(1.5rem,2.6vw,2.25rem)] font-semibold leading-[1.02] tracking-[-0.03em] transition-colors group-hover:text-accent">
                        {door.title}
                      </h3>
                      <p className="mt-3 max-w-[44ch] text-base leading-[1.55] text-muted">
                        {door.body}
                      </p>
                      <div className="mt-6">{figures[door.key]}</div>
                      <Cue label={door.cue} />
                    </div>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
