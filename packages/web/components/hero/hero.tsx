import { Suspense } from "react";

import { heroSaleName } from "@/lib/pulse";

import { HeroMotif } from "./hero-motif";
import { LivePulse } from "./live-pulse";
import { PulseFallback } from "./pulse-row";
import { Rise } from "./rise";
import { WatchSaleButton } from "./watch-sale-button";

const FACTS = [
  "Built on Meteora's Dynamic Bonding Curve",
  "Live on Solana devnet",
  "Price by Pyth",
];

/**
 * The poster. The title, the sentence and the action are in the first HTML the
 * browser gets; only the live numbers wait on devnet, inside their own
 * boundary, so nothing about the message is held up by a chain read.
 */
export function Hero({ readoutId }: { readoutId: string }) {
  return (
    <section data-testid="hero" className="grain relative isolate flex min-h-[calc(100svh-4rem)] flex-col overflow-hidden">
      <HeroMotif />

      <div className="relative z-10 mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-[6vw] pt-10 pb-12 sm:pt-14 sm:pb-16">
        <Rise delay={0.05}>
          <Suspense fallback={<PulseFallback />}>
            <LivePulse />
          </Suspense>
        </Rise>

        <div className="mt-16 sm:mt-auto sm:pt-16">
          <Rise delay={0.12} distance={40}>
            <h1 className="-ml-[0.02em] font-display text-[clamp(4rem,14vw,12rem)] font-semibold leading-[0.84] tracking-[-0.045em]">
              Pangu
            </h1>
          </Rise>

          <div className="mt-7 flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between sm:gap-12">
            <Rise delay={0.22}>
              <p className="max-w-[36ch] text-[17px] leading-[1.45] sm:text-[18px]">
                A fair first sale for stock tokens. The curve sets the price, the
                cap keeps it fair.
              </p>
            </Rise>

            <Rise delay={0.3} className="shrink-0">
              <WatchSaleButton target={readoutId} />
            </Rise>
          </div>

          <Rise delay={0.38}>
            <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              {FACTS.map((fact) => (
                <span key={fact} className="flex items-center gap-5">
                  {fact}
                  <span className="h-1 w-1 rounded-full bg-accent" />
                </span>
              ))}
              <span>{heroSaleName()}</span>
            </div>
          </Rise>
        </div>
      </div>
    </section>
  );
}
