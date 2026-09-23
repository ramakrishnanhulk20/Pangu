"use client";

import { tokenAmount } from "@/lib/format";
import type { Target } from "@/lib/break";
import { tallyLine } from "@/lib/break";
import { CHAIN, explorerAddress } from "@/lib/network";

import { Reveal } from "./strike";

/**
 * The line at the foot of the ledger, in the same shape the prove command
 * prints, with the concentration number read off the sale's own records.
 */
export function Tally({
  target,
  counts,
}: {
  target: Target | null;
  counts: {
    run: number;
    refusedAsExpected: number;
    allowedAsExpected: number;
    off: number;
    unseen: number;
  };
}) {
  const nothingSold = target === null || target.totalNetBought === 0n;

  return (
    <Reveal className="mt-20 border-t border-line pt-10 sm:mt-28">
      <p className="font-display text-[clamp(1.6rem,4.4vw,3.4rem)] leading-[1.02] tracking-[-0.035em]">
        {counts.run === 0
          ? "Nothing run yet. Every row above is a real transaction against the real program."
          : tallyLine(counts)}
      </p>

      <p className="mt-6 max-w-[64ch] text-[15px] leading-relaxed text-muted">
        {target === null
          ? `The sale, the cap and the share every wallet holds are being read off ${CHAIN.inSentence} now.`
          : nothingSold
            ? `No wallet has bought in this sale yet, so there is no largest holder to measure. The cap stands at ${tokenAmount(target.cap, target.baseDecimals)} shares a wallet.`
            : `The largest wallet holds ${(target.largestShare * 100).toFixed(2)} percent of the ${tokenAmount(target.totalNetBought, target.baseDecimals)} shares sold so far, against a cap worth ${(target.capShare * 100).toFixed(2)} percent of them, across ${target.buyers} ${target.buyers === 1 ? "buyer" : "buyers"}.`}
      </p>

      <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
        {target !== null && (
          <a
            href={explorerAddress(target.mint)}
            target="_blank"
            rel="noreferrer"
            className="border-b border-line pb-0.5 transition-colors hover:border-accent hover:text-accent"
          >
            the sale token on the explorer
          </a>
        )}
        <span>the same run the terminal command makes</span>
      </div>
    </Reveal>
  );
}
