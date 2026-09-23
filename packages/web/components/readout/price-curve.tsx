"use client";

import { motion } from "framer-motion";
import { useId } from "react";

import type { SaleReadout } from "@/lib/readout";

import { money, perThousand, sharePrice, shares } from "./format";
import { largestOfSale } from "./numbers";

// The frame the drawing is laid out in. Everything below is in these units, so
// one set of numbers serves the wide version and the phone one.
const LEFT = 56;
const RIGHT = 968;
const TOP = 74;
const FLOOR = 470;
const CAP_Y = 520;
const LARGEST_Y = 552;
const AXIS_Y = 598;

const EASE = [0.22, 1, 0.36, 1] as const;

/** The dot's halo, in frame units: a label closer than this to the dot sits under it. */
const HALO = 30;

/**
 * About how wide a label runs, in frame units. The labels are uppercase mono
 * with 0.14em of tracking, so each character takes close to 0.74 of its size.
 */
function labelWidth(text: string, size: number): number {
  return text.length * size * 0.74;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

interface Frame {
  line: string;
  /** The curve's points in frame units, left to right. */
  path: { x: number; y: number }[];
  area: string;
  dot: { x: number; y: number };
  soldX: number;
  capX: number;
  largestX: number;
  openPrice: number;
  topPrice: number;
  openY: number;
}

/**
 * Turns the read curve into the one path the section is built around.
 *
 * Across is how many shares the curve has handed out, up is what a share costs
 * there, and the top of the frame is the price at graduation. The price axis
 * starts at zero, so the steepness on screen is the steepness of the real
 * curve and not a zoomed window into it.
 */
function frameOf(readout: SaleReadout): Frame | null {
  const points = readout.curve;
  if (points.length < 2 || readout.saleSize <= 0) {
    return null;
  }

  const topPrice = points[points.length - 1].price;
  if (topPrice <= 0) {
    return null;
  }

  const across = (sold: number) =>
    LEFT + Math.min(1, Math.max(0, sold / readout.saleSize)) * (RIGHT - LEFT);
  const up = (price: number) =>
    FLOOR - Math.min(1, Math.max(0, price / topPrice)) * (FLOOR - TOP);

  const steps = points.map(
    (point) => `${across(point.sold).toFixed(2)} ${up(point.price).toFixed(2)}`
  );
  const line = `M ${steps.join(" L ")}`;

  return {
    line,
    path: points.map((point) => ({ x: across(point.sold), y: up(point.price) })),
    area: `${line} L ${RIGHT} ${FLOOR} L ${LEFT} ${FLOOR} Z`,
    dot: {
      x: across(readout.sold),
      y: up(readout.priceNow ?? points[0].price),
    },
    soldX: across(readout.sold),
    capX: across(readout.cap),
    largestX: across(readout.holders[0]?.shares ?? 0),
    openPrice: points[0].price,
    topPrice,
    openY: up(points[0].price),
  };
}

function Label({
  x,
  y,
  size,
  anchor = "start",
  tone = "var(--muted)",
  children,
}: {
  x: number;
  y: number;
  size: number;
  anchor?: "start" | "middle" | "end";
  tone?: string;
  children: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill={tone}
      fontSize={size}
      letterSpacing="0.14em"
      style={{
        fontFamily: "var(--font-plex-mono), monospace",
        textTransform: "uppercase",
      }}
    >
      {children}
    </text>
  );
}

function Drawing({
  readout,
  frame,
  revealed,
  still,
  size,
  full,
}: {
  readout: SaleReadout;
  frame: Frame;
  revealed: boolean;
  still: boolean;
  /** Label size in frame units. The phone frame is narrower, so its type is bigger. */
  size: number;
  /** The wide frame carries the labels that would land on the curve at 390px. */
  full: boolean;
}) {
  const fill = useId();
  const clip = useId();
  const drawn = still || revealed;
  const price = readout.priceNow;

  // A sale that filled leaves its dot on the graduation mark, and two labels
  // in one spot read as neither. The mark's own label carries the price there.
  const atEnd = frame.dot.x > RIGHT - (RIGHT - LEFT) * 0.04;

  // The opening price is only written where it clears the dot, its halo and
  // the two-line price label beside the dot. The frame scales as one piece, so
  // a label that clears here clears at every width.
  const opening = perThousand(frame.openPrice)
    ? `opens at ${sharePrice(frame.openPrice, readout.money)}`
    : `opens at ${money(frame.openPrice, readout.money)}`;
  // Lifted clear of the curve where the label ends, since the curve climbs
  // under the label's own length.
  const openingRight = LEFT + labelWidth(opening, size);
  const curveAtRight =
    frame.path.find((point) => point.x >= openingRight)?.y ?? frame.openY;
  const openingY = Math.min(frame.openY - 18, curveAtRight - 12);
  const openingBox: Box = {
    left: LEFT,
    right: openingRight,
    top: openingY - size,
    bottom: openingY + size * 0.3,
  };
  const halo: Box = {
    left: frame.dot.x - HALO,
    right: frame.dot.x + HALO,
    top: frame.dot.y - HALO,
    bottom: frame.dot.y + HALO,
  };
  const leftward = frame.dot.x > (LEFT + RIGHT) / 2;
  const priceWidth =
    price === null
      ? 0
      : Math.max(
          labelWidth(sharePrice(price, readout.money), size),
          labelWidth("where it finished", size)
        );
  const priceBox: Box = {
    left: leftward ? frame.dot.x - 22 - priceWidth : frame.dot.x + 22,
    right: leftward ? frame.dot.x - 22 : frame.dot.x + 22 + priceWidth,
    top: frame.dot.y - 58 - size,
    bottom: frame.dot.y - 58 + size * 1.8,
  };
  const openingClear =
    !overlaps(openingBox, halo) &&
    (price === null || atEnd || !overlaps(openingBox, priceBox));

  return (
    <>
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
        <clipPath id={clip}>
          {/* The fill under the curve reaches exactly as far as the sale has
              sold, so the shaded part is what buyers have taken. */}
          <motion.rect
            x={LEFT}
            y={TOP - 40}
            height={FLOOR - TOP + 40}
            initial={false}
            animate={{ width: Math.max(0, frame.soldX - LEFT) }}
            transition={still ? { duration: 0 } : { duration: 1.1, ease: EASE }}
          />
        </clipPath>
      </defs>

      <path
        d={frame.area}
        fill={`url(#${fill})`}
        clipPath={`url(#${clip})`}
        opacity={drawn ? 1 : 0}
        style={{ transition: still ? "none" : "opacity 900ms ease 700ms" }}
      />

      <motion.path
        d={frame.line}
        fill="none"
        stroke="var(--motif-line)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: "var(--motif-glow)" }}
        initial={still ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={still ? { duration: 0 } : { duration: 1.4, ease: EASE }}
      />

      <line
        x1={RIGHT}
        x2={RIGHT}
        y1={TOP - 10}
        y2={CAP_Y - 24}
        stroke="var(--motif-line)"
        strokeWidth={1.5}
        strokeDasharray="1 9"
        strokeLinecap="round"
        opacity={drawn ? 1 : 0}
        style={{ transition: still ? "none" : "opacity 600ms ease 900ms" }}
      />
      <Label x={RIGHT} y={TOP - 40} size={size} anchor="end">
        {readout.graduated ? "it graduated here" : "graduates here"}
      </Label>
      <Label x={RIGHT} y={TOP - 40 + size * 1.5} size={size} anchor="end">
        {sharePrice(frame.topPrice, readout.money)}
      </Label>

      {full && openingClear && (
        <Label x={LEFT} y={openingY} size={size}>
          {opening}
        </Label>
      )}

      <motion.g
        initial={still ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={still ? { duration: 0 } : { duration: 0.5, delay: 1.2 }}
      >
        <motion.circle
          r={30}
          fill="var(--accent)"
          opacity={0.14}
          initial={false}
          animate={{ cx: frame.dot.x, cy: frame.dot.y }}
          transition={still ? { duration: 0 } : { duration: 1.1, ease: EASE }}
        />
        <motion.circle
          r={11}
          fill="var(--accent)"
          initial={false}
          animate={{ cx: frame.dot.x, cy: frame.dot.y }}
          transition={still ? { duration: 0 } : { duration: 1.1, ease: EASE }}
        />
      </motion.g>

      {price !== null && !atEnd && (
        <motion.g
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: 1, x: frame.dot.x, y: frame.dot.y }}
          transition={still ? { duration: 0 } : { duration: 1.1, ease: EASE }}
        >
          <Label
            x={frame.dot.x > (LEFT + RIGHT) / 2 ? -22 : 22}
            y={-58}
            size={size}
            anchor={frame.dot.x > (LEFT + RIGHT) / 2 ? "end" : "start"}
            tone="var(--ink)"
          >
            {sharePrice(price, readout.money)}
          </Label>
          <Label
            x={frame.dot.x > (LEFT + RIGHT) / 2 ? -22 : 22}
            y={-58 + size * 1.5}
            size={size}
            anchor={frame.dot.x > (LEFT + RIGHT) / 2 ? "end" : "start"}
          >
            {readout.graduated ? "where it finished" : "the price right now"}
          </Label>
        </motion.g>
      )}

      {/* The cap, drawn as what it is: the slice of the whole sale one wallet
          may end up holding. The bar under it is the largest wallet there is. */}
      <motion.line
        x1={LEFT}
        x2={LEFT}
        y1={CAP_Y}
        y2={CAP_Y}
        stroke="var(--accent)"
        strokeWidth={7}
        strokeLinecap="round"
        // x2 is named in the starting values too. Left out, the browser logs
        // "attribute x2: Expected length, undefined" four times a load, two per
        // bar per drawing; with it, none (lab-evidence/ux-x2-check.txt).
        initial={still ? false : { opacity: 0, x2: LEFT }}
        animate={{ opacity: 1, x2: frame.capX }}
        transition={still ? { duration: 0 } : { duration: 0.9, delay: 1, ease: EASE }}
      />
      {full && (
        <Label x={frame.capX + 20} y={CAP_Y + size * 0.4} size={size}>
          {`the cap on one wallet, ${(readout.capOfSale * 100).toFixed(0)}% of the sale`}
        </Label>
      )}

      {readout.holders.length > 0 && (
        <>
          <motion.line
            x1={LEFT}
            x2={LEFT}
            y1={LARGEST_Y}
            y2={LARGEST_Y}
            stroke="var(--motif-line)"
            strokeWidth={7}
            strokeLinecap="round"
            initial={still ? false : { opacity: 0, x2: LEFT }}
            animate={{ opacity: 1, x2: Math.max(LEFT + 2, frame.largestX) }}
            transition={
              still ? { duration: 0 } : { duration: 0.9, delay: 1.1, ease: EASE }
            }
          />
          {full && (
            <Label
              x={Math.max(LEFT + 2, frame.largestX) + 20}
              y={LARGEST_Y + size * 0.4}
              size={size}
            >
              {`the largest wallet, ${(largestOfSale(readout) * 100).toFixed(1)}% of the sale`}
            </Label>
          )}
        </>
      )}

      <Label x={LEFT} y={AXIS_Y} size={size}>
        0 shares
      </Label>
      <Label x={RIGHT} y={AXIS_Y} size={size} anchor="end">
        {`${shares(readout.saleSize)} shares in this sale`}
      </Label>
    </>
  );
}

/**
 * The sale as one drawing: the real price path from the first share to
 * graduation, shaded as far as buyers have taken it, with the cap on one
 * wallet lying underneath at its true width.
 *
 * The points come from the sale's launch template on chain, the same numbers the
 * program prices a swap with. Nothing here is drawn to look like a curve.
 */
export function PriceCurve({
  readout,
  revealed,
  still,
}: {
  readout: SaleReadout;
  revealed: boolean;
  still: boolean;
}) {
  const frame = frameOf(readout);
  if (frame === null) {
    return null;
  }

  // What the drawing shows, said in words for a screen reader, at every width.
  const said = [
    `The price path of ${readout.name}, from ${sharePrice(
      frame.openPrice,
      readout.money
    )} to ${sharePrice(frame.topPrice, readout.money)} at graduation.`,
    readout.priceNow === null
      ? null
      : `${readout.graduated ? "It finished at" : "Right now it is"} ${sharePrice(
          readout.priceNow,
          readout.money
        )}.`,
    readout.ceilingDollars === null
      ? null
      : `Buys stop above ${sharePrice(readout.ceilingDollars, "dollars")}.`,
    `${shares(readout.sold)} of ${shares(readout.saleSize)} shares have sold, ${(
      readout.raisedShare * 100
    ).toFixed(0)} percent of the way to graduation.`,
  ]
    .filter((part) => part !== null)
    .join(" ");

  return (
    <div className="relative w-full">
      <svg
        viewBox="0 0 1000 620"
        className="hidden h-auto w-full sm:block"
        role="img"
        aria-label={said}
      >
        <Drawing
          readout={readout}
          frame={frame}
          revealed={revealed}
          still={still}
          size={15}
          full
        />
      </svg>

      {/* Same drawing, bigger type, and the long labels dropped: at 390px they
          would sit on top of the curve. The legend under it says the same. */}
      <svg
        viewBox="0 0 1000 620"
        className="h-auto w-full sm:hidden"
        role="img"
        aria-label={said}
      >
        <Drawing
          readout={readout}
          frame={frame}
          revealed={revealed}
          still={still}
          size={30}
          full={false}
        />
      </svg>

      <ul className="mt-3 space-y-2 sm:hidden">
        <li className="flex items-center gap-3 text-[12px] text-muted">
          <span className="h-[3px] w-7 shrink-0 rounded-full bg-accent" />
          {`the cap on one wallet, ${(readout.capOfSale * 100).toFixed(0)}% of the sale`}
        </li>
        {readout.holders.length > 0 && (
          <li className="flex items-center gap-3 text-[12px] text-muted">
            <span
              className="h-[3px] w-7 shrink-0 rounded-full"
              style={{ background: "var(--motif-line)" }}
            />
            {`the largest wallet, ${(largestOfSale(readout) * 100).toFixed(1)}% of the sale`}
          </li>
        )}
      </ul>
    </div>
  );
}
