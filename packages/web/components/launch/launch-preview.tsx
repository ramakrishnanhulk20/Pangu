"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

import { PriceCurve } from "@/components/readout/price-curve";
import { LogoFrame } from "@/components/token-logo";
import { money, perThousand, sharePrice, shares as whole, utcMoment } from "@/components/readout/format";
import { feedWords } from "@/lib/feeds";
import { FEED_IDS, type LaunchForm, type Preview } from "@/lib/launch";
import type { SaleReadout } from "@/lib/readout";

import { Tag } from "./fields";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The frame PriceCurve lays its drawing out in, copied from
 * components/readout/price-curve.tsx so the ceiling lands on its curve. The
 * drawing is 1000 by 620 units and scales as one piece at every width.
 */
const FRAME = { width: 1000, height: 620, left: 56, right: 968, top: 74, floor: 470 } as const;

/** The fields of a readout PriceCurve draws from. Everything else about a live sale is not known yet. */
type Drawn = Pick<
  SaleReadout,
  | "name"
  | "money"
  | "graduated"
  | "priceNow"
  | "ceilingDollars"
  | "raisedShare"
  | "sold"
  | "saleSize"
  | "cap"
  | "capOfSale"
  | "holders"
  | "curve"
>;

function drawnOf(preview: Preview, name: string): Drawn {
  return {
    name: name.trim() === "" ? "this sale" : name.trim(),
    money: preview.money,
    graduated: false,
    priceNow: null,
    ceilingDollars: preview.ceiling,
    raisedShare: 0,
    sold: 0,
    saleSize: preview.curveShares,
    cap: preview.capShares,
    capOfSale: preview.capPercent / 100,
    holders: [],
    curve: preview.points.map((point) => ({ sold: point.share * preview.curveShares, price: point.price })),
  };
}

/** The value, once it has stopped changing for a moment, so the curve redraws when the typing pauses. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}


/**
 * The sale as it will open, redrawn from the form: the curve, the price the
 * first share sells at, where the ceiling bites, the cap, the end, and what a
 * buyer will meet. Every number is the plan's.
 */
export function LaunchPreview({
  preview,
  form,
  logoUrl,
}: {
  preview: Preview | null;
  form: LaunchForm;
  logoUrl: string | null;
}) {
  const still = useReducedMotion() === true;
  const shapeKey =
    preview === null
      ? "none"
      : `${preview.shape.supply}-${preview.shape.threshold}-${preview.shape.migrationPercent}-${preview.money}`;
  const settledKey = useSettled(shapeKey, 380);

  if (preview === null) {
    return (
      <div>
        <Identity form={form} logoUrl={logoUrl} still={still} />
        <div data-testid="launch-preview" className="rounded-lg border border-dashed border-line p-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">the sale, as it will open</p>
          <p className="mt-4 max-w-[36ch] text-[15px] leading-relaxed text-muted">
            The curve draws itself here once the shares, the raise and the share kept back add up to one Meteora can build.
          </p>
        </div>
      </div>
    );
  }

  const feed = feedWords(FEED_IDS[form.feed]);
  const bites = preview.ceilingShare;
  // The readout's rule: a price of a few millionths reads as a row of zeros,
  // so it is shown for 1,000 shares and the note under it says so.
  const tiny = perThousand(preview.opening);
  const opening = money(tiny ? preview.opening * 1_000 : preview.opening, preview.money);
  const facts: { label: string; value: string; tag?: string }[] = [
    { label: "the curve sells", value: `${whole(preview.curveShares)} shares` },
    { label: "it graduates at", value: sharePrice(preview.graduation, preview.money) },
    { label: "most one wallet holds", value: `${whole(preview.capShares)} shares`, tag: "OverCap" },
    {
      label: "the offering ends",
      value:
        preview.offeringDays === null
          ? "at graduation"
          : preview.endsAt === null
            ? `${preview.offeringDays} days after launch`
            : `about ${utcMoment(preview.endsAt * 1000)}`,
    },
  ];
  if (form.band && preview.money === "dollars") {
    facts.push({
      label: "the price ceiling",
      value: preview.ceiling === null ? `${form.bandPercent}% over ${feed.price}` : `${money(preview.ceiling, "dollars")} today`,
      tag: "PriceOutsideBand",
    });
    facts.push({
      label: "the ceiling bites",
      value:
        bites === null
          ? "once the price reads"
          : bites <= 0
            ? "before the first buy"
            : bites >= 1
              ? "never on this curve"
              : `${(bites * 100).toFixed(0)}% into the curve`,
    });
  }

  return (
    <div data-testid="launch-preview" className="relative">
      <Identity form={form} logoUrl={logoUrl} still={still} />
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">the sale, as it will open</p>
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          <span className="relative flex h-1.5 w-1.5">
            {!still && <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />}
            <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          redraws as you type
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="min-w-0 max-w-full">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={preview.opening.toPrecision(6)}
              data-testid="launch-opening"
              className={`break-words font-display font-semibold leading-[0.9] tracking-[-0.045em] tabular-nums ${
                opening.length > 10 ? "text-[clamp(2.1rem,4.6vw,4.25rem)]" : "text-[clamp(3rem,7vw,6.25rem)]"
              }`}
              initial={still ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={still ? undefined : { opacity: 0, y: -14 }}
              transition={still ? { duration: 0 } : { duration: 0.45, ease: EASE }}
            >
              {opening}
            </motion.p>
          </AnimatePresence>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            {tiny
              ? `what the first 1,000 shares cost: one share is under 0.0001 ${preview.money}, ${(preview.underGraduation * 100).toFixed(0)}% under where it graduates`
              : `the first share, ${(preview.underGraduation * 100).toFixed(0)}% under where it graduates`}
          </p>
        </div>
      </div>

      <div className="relative mt-4">
        <PriceCurve key={settledKey} readout={drawnOf(preview, form.name) as SaleReadout} revealed still={still} />
        {form.band && preview.ceiling !== null && bites !== null && (
          <>
            <CeilingOverlay preview={preview} still={still} size={15} label={`${form.bandPercent}% over ${feed.label}`} className="hidden sm:block" />
            <CeilingOverlay preview={preview} still={still} size={28} label={`${form.bandPercent}% over`} className="sm:hidden" />
          </>
        )}
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-line pt-6 sm:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="flex items-center gap-2 font-mono text-[10px] uppercase leading-none tracking-[0.18em] text-muted">
              {fact.label}
            </dt>
            <dd className="mt-2.5 text-[15px] leading-tight tabular-nums">
              {fact.value} {fact.tag !== undefined && <Tag>{fact.tag}</Tag>}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">what a buyer will meet</p>
        <ol data-testid="launch-rules" className="mt-4 space-y-3">
          {preview.rules.map((rule, place) => (
            <motion.li
              key={rule}
              className="grid grid-cols-[2rem_minmax(0,1fr)] text-[15px] leading-[1.5]"
              initial={still ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={still ? { duration: 0 } : { duration: 0.35, delay: place * 0.03, ease: EASE }}
            >
              <span className="pt-[3px] font-mono text-[11px] text-accent">{String(place + 1).padStart(2, "0")}</span>
              <span>{rule}</span>
            </motion.li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** The token as a wallet will list it: the logo in its circle beside the name, the symbol, and the first lines of the description. */
function Identity({ form, logoUrl, still }: { form: LaunchForm; logoUrl: string | null; still: boolean }) {
  const name = form.name.trim();
  const symbol = form.symbol.trim().toUpperCase();
  const description = form.description.trim();

  return (
    <div data-testid="launch-identity" className="mb-10 flex items-center gap-5 border-b border-line pb-7">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={logoUrl ?? "mark"}
          className="shrink-0"
          initial={still ? false : { opacity: 0, scale: 0.85, rotate: -8 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={still ? undefined : { opacity: 0, scale: 0.9 }}
          transition={still ? { duration: 0 } : { duration: 0.55, ease: EASE }}
        >
          <LogoFrame image={logoUrl} name={name === "" ? "This token" : name} size={76} />
        </motion.span>
      </AnimatePresence>
      <div className="min-w-0">
        <p
          className={`line-clamp-2 break-words font-display text-[clamp(1.7rem,2.8vw,2.4rem)] font-semibold leading-[0.95] tracking-[-0.04em] ${
            name === "" ? "text-muted/60" : ""
          }`}
        >
          {name === "" ? "Your token" : name}
        </p>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          <span className={symbol === "" ? "text-muted/60" : "text-ink"}>{symbol === "" ? "symbol" : symbol}</span>
          <span className="mx-2 text-accent">/</span>
          as a wallet lists it
        </p>
        {description !== "" && (
          <p className="mt-2.5 line-clamp-2 max-w-[54ch] text-[13px] leading-relaxed text-muted">{description}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The price ceiling laid over the curve: a dashed line at today's ceiling, and
 * the point where the curve meets it, which is where buying stops until the
 * stock moves.
 */
function CeilingOverlay({
  preview,
  still,
  label,
  size,
  className,
}: {
  preview: Preview;
  still: boolean;
  label: string;
  /** Label size in frame units: the phone frame is narrower, so its type is bigger, as in PriceCurve. */
  size: number;
  className: string;
}) {
  const ceiling = preview.ceiling ?? 0;
  const share = preview.ceilingShare ?? 0;
  const top = preview.graduation;
  const up = (price: number) =>
    FRAME.floor - Math.min(1, Math.max(0, price / top)) * (FRAME.floor - FRAME.top);
  const across = (fraction: number) =>
    FRAME.left + Math.min(1, Math.max(0, fraction)) * (FRAME.right - FRAME.left);
  const above = ceiling > top;
  const y = above ? FRAME.top - 26 : up(ceiling);
  const meets = share > 0 && share < 1;
  const x = across(share);

  return (
    <div className={`pointer-events-none absolute left-0 top-0 aspect-[1000/620] w-full ${className}`}>
      <svg viewBox={`0 0 ${FRAME.width} ${FRAME.height}`} className="h-full w-full" aria-hidden="true">
        <motion.line
          x1={FRAME.left}
          x2={FRAME.right}
          y1={y}
          y2={y}
          stroke="var(--refused)"
          strokeWidth={2}
          strokeDasharray="2 9"
          strokeLinecap="round"
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: 0.9, y1: y, y2: y }}
          transition={still ? { duration: 0 } : { duration: 0.6, ease: EASE }}
        />
        <text
          x={FRAME.left}
          y={y - size * 0.8}
          fill="var(--refused)"
          fontSize={size}
          letterSpacing="0.14em"
          style={{ fontFamily: "var(--font-plex-mono), monospace", textTransform: "uppercase" }}
        >
          {above ? `ceiling above the whole curve: ${label}` : `ceiling ${money(ceiling, "dollars")}: ${label}`}
        </text>
        {meets && (
          <>
            <motion.line
              x1={x}
              x2={x}
              y1={y}
              y2={FRAME.floor}
              stroke="var(--refused)"
              strokeWidth={1.5}
              strokeDasharray="1 7"
              strokeLinecap="round"
              initial={still ? false : { opacity: 0 }}
              animate={{ opacity: 0.8 }}
              transition={still ? { duration: 0 } : { duration: 0.5, delay: 0.3 }}
            />
            <motion.circle
              r={8}
              fill="var(--paper)"
              stroke="var(--refused)"
              strokeWidth={3}
              initial={still ? false : { scale: 0 }}
              animate={{ scale: 1, cx: x, cy: y }}
              transition={still ? { duration: 0 } : { duration: 0.5, ease: EASE }}
            />
            <text
              x={x + (share > 0.6 ? -14 : 14)}
              y={FRAME.floor - size}
              textAnchor={share > 0.6 ? "end" : "start"}
              fill="var(--refused)"
              fontSize={size}
              letterSpacing="0.14em"
              style={{ fontFamily: "var(--font-plex-mono), monospace", textTransform: "uppercase" }}
            >
              {`buying stops here, ${(share * 100).toFixed(0)}% in`}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
