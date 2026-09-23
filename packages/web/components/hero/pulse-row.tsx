"use client";

import { useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { timeUntil } from "@/components/readout/format";
import { feedWords } from "@/lib/feeds";
import type { HeroPulse, Offering } from "@/lib/pulse";

const POLL_MS = 15_000;

function money(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function whole(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/**
 * Counts up to the number devnet just gave. The true value is what the server
 * rendered, so it is in the HTML from the first paint; the count is written
 * straight to the text node afterwards, so no frame of it re-renders React.
 */
function Counting({
  value,
  format,
  still,
}: {
  value: number;
  format: (value: number) => string;
  still: boolean;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const from = useRef(0);

  useEffect(() => {
    const element = node.current;
    if (still || element === null) {
      return;
    }

    const begin = from.current;
    const start = performance.now();
    let handle = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 1100);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = begin + (value - begin) * eased;
      from.current = next;
      element.textContent = format(next);
      if (t < 1) {
        handle = window.requestAnimationFrame(step);
      }
    };

    handle = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(handle);
  }, [value, still, format]);

  return <span ref={node}>{format(value)}</span>;
}

function Cell({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase leading-none tracking-[0.18em] text-muted">
        {label}
      </div>
      <div className="mt-2 text-[17px] leading-none tabular-nums sm:text-[19px]">
        {children}
      </div>
      {note !== undefined && (
        <div className="mt-1.5 text-[12px] leading-snug text-muted">{note}</div>
      )}
    </div>
  );
}

function LiveDot({ still }: { still: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {!still && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
      )}
      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
    </span>
  );
}

/**
 * The sale the line leads with, and its offering period: the priced sale when
 * its numbers are on the line, otherwise the sale the sharing numbers came from.
 */
function shownOffering(pulse: HeroPulse): { name: string; offering: Offering } | null {
  if (pulse.priceDollars !== null || pulse.stockDollars !== null) {
    return { name: pulse.priceSaleName, offering: pulse.priceOffering };
  }
  if (pulse.buyers !== null) {
    return { name: pulse.sharedSaleName, offering: pulse.sharedOffering };
  }
  return null;
}

export function PulseFallback() {
  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
      <div className="flex items-center gap-2 pt-1">
        <LiveDot still />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          reading devnet
        </span>
      </div>
      <Cell label="on the curve now">
        <span className="text-muted">$ ---</span>
      </Cell>
      <Cell label={feedWords(null).label}>
        <span className="text-muted">$ ---</span>
      </Cell>
      <Cell label="shared out so far">
        <span className="text-muted">--- buyers</span>
      </Cell>
    </div>
  );
}

/**
 * The live line above the title. It arrives server rendered with real numbers
 * in it, then asks devnet again every fifteen seconds. No wallet is involved.
 */
export function PulseRow({ initial }: { initial: HeroPulse }) {
  const still = useReducedMotion() === true;
  const [pulse, setPulse] = useState(initial);

  useEffect(() => {
    let alive = true;

    const read = async () => {
      if (document.hidden) {
        return;
      }
      try {
        const answer = await fetch("/api/pulse", { cache: "no-store" });
        if (!answer.ok) {
          return;
        }
        const next = (await answer.json()) as HeroPulse;
        if (alive) {
          setPulse(next);
        }
      } catch {
        // A missed poll leaves the last real reading on screen rather than
        // replacing it with a guess.
      }
    };

    const timer = window.setInterval(read, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (pulse.failure !== null) {
    return (
      <p className="max-w-md text-sm text-muted">{pulse.failure}</p>
    );
  }

  // Nothing is added for a sale with no end date.
  const shown = shownOffering(pulse);
  const ending =
    shown === null || shown.offering.endsAt === null
      ? null
      : { ...shown, endsAt: shown.offering.endsAt };

  const ceilingNote =
    pulse.ceilingDollars === null
      ? null
      : `buys stop above ${money(pulse.ceilingDollars)} a share`;
  const priceNote =
    ceilingNote === null
      ? (pulse.priceWarning ?? undefined)
      : pulse.priceWarning === null
        ? ceilingNote
        : `${ceilingNote}, and there is no fresh price right now`;

  return (
    <div
      data-testid="hero-pulse"
      className="flex flex-wrap items-start gap-x-10 gap-y-5"
    >
      <div className="flex items-center gap-2 pt-1">
        <LiveDot still={still} />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          live
        </span>
      </div>

      {pulse.priceDollars !== null && (
        <Cell
          label={`${pulse.priceSaleName}, on the curve`}
          note="what one share costs right now"
        >
          <Counting value={pulse.priceDollars} format={money} still={still} />{" "}
          <span className="text-muted">a share</span>
        </Cell>
      )}

      {pulse.stockDollars !== null && (
        <Cell label={pulse.stockLabel} note={priceNote}>
          <Counting value={pulse.stockDollars} format={money} still={still} />
        </Cell>
      )}

      {pulse.buyers !== null && (
        <Cell
          label={`${pulse.sharedSaleName}, shared out so far`}
          note={`the largest wallet holds ${percent(pulse.largestShare)} of a ${percent(
            pulse.capShare
          )} cap`}
        >
          <Counting value={pulse.buyers} format={whole} still={still} />{" "}
          <span className="text-muted">buyers</span>
        </Cell>
      )}

      {ending !== null && (
        <Cell
          label={`${ending.name}, the offering`}
          note={
            ending.offering.offeringOver
              ? "the rules have lifted and the token trades freely"
              : "then every rule lifts"
          }
        >
          <span data-testid="hero-offering">
            {ending.offering.offeringOver
              ? "ended"
              : `ends in ${timeUntil(ending.endsAt * 1000, pulse.readAt, true)}`}
          </span>
        </Cell>
      )}
    </div>
  );
}
