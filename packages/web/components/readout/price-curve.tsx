"use client";

import { motion } from "framer-motion";
import { useId } from "react";

import type { SaleReadout } from "@/lib/readout";

import { money, shares } from "./format";

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

interface Frame {
  line: string;
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
        {`${money(frame.topPrice, readout.money)} a share`}
      </Label>

      {full && readout.sold > readout.saleSize * 0.08 && (
        <Label x={LEFT} y={frame.openY - 18} size={size}>
          {`opens at ${money(frame.openPrice, readout.money)}`}
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
            {`${money(price, readout.money)} a share`}
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
        initial={still ? false : { opacity: 0 }}
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
            initial={still ? false : { opacity: 0 }}
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
              {`the largest wallet, ${(readout.largestShare * 100).toFixed(1)}% of what has sold`}
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
 * The points come from the launch template on devnet, the same numbers the
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

  return (
    <div className="relative w-full">
      <svg
        viewBox="0 0 1000 620"
        className="hidden h-auto w-full sm:block"
        role="img"
        aria-label={`The price path of ${readout.name}, from ${money(
          frame.openPrice,
          readout.money
        )} a share to ${money(frame.topPrice, readout.money)} at graduation.`}
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
        aria-hidden="true"
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
            {`the largest wallet, ${(readout.largestShare * 100).toFixed(
              1
            )}% of what has sold`}
          </li>
        )}
      </ul>
    </div>
  );
}
