"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

// The hero's curve and cap line, redrawn wide behind the directory. One dot per
// sale rides the curve, so the drawing counts what the ledger lists.
const CURVE = "M -40 880 C 300 866, 640 804, 880 620 C 1080 466, 1240 250, 1340 20";
const CAP_Y = 250;

type Point = { x: number; y: number };

const FIRST: readonly Point[] = [
  { x: -40, y: 880 },
  { x: 300, y: 866 },
  { x: 640, y: 804 },
  { x: 880, y: 620 },
];
const SECOND: readonly Point[] = [
  { x: 880, y: 620 },
  { x: 1080, y: 466 },
  { x: 1240, y: 250 },
  { x: 1340, y: 20 },
];

function cubic([p0, p1, p2, p3]: readonly Point[], t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0!.x + b * p1!.x + c * p2!.x + d * p3!.x,
    y: a * p0!.y + b * p1!.y + c * p2!.y + d * p3!.y,
  };
}

/**
 * Where the dot for one sale sits: spread along the curve from its low stretch
 * to just under the cap line, never above it, because no sale sits past a cap.
 */
function pointOn(place: number, of: number): Point {
  const s = of <= 1 ? 1 : 0.45 + (1.05 * place) / (of - 1);
  return s < 1 ? cubic(FIRST, s) : cubic(SECOND, s - 1);
}

export function DirectoryMotif({ count }: { count: number }) {
  const still = useReducedMotion() === true;
  const { scrollY } = useScroll();
  const drift = useTransform(scrollY, [0, 900], [0, still ? 0 : -120]);
  const dots = Math.min(count, 24);

  return (
    <motion.div
      aria-hidden="true"
      style={{ y: drift }}
      className="pointer-events-none absolute right-0 top-0 -z-10 h-[min(88svh,760px)] w-full opacity-50 sm:opacity-100 lg:w-[64vw]"
    >
      <svg
        viewBox="300 0 1040 900"
        preserveAspectRatio="xMaxYMin slice"
        className="h-full w-full"
        style={{
          filter: "var(--motif-glow)",
          maskImage: "linear-gradient(to bottom, #000 55%, transparent 96%)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 55%, transparent 96%)",
        }}
      >
        <motion.path
          d={CURVE}
          pathLength={1}
          fill="none"
          stroke="var(--motif-line)"
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
          initial={still ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={still ? { duration: 0 } : { duration: 1.8, ease: [0.65, 0, 0.35, 1] }}
        />
        <motion.line
          x1={900}
          x2={1340}
          y1={CAP_Y}
          y2={CAP_Y}
          stroke="var(--accent)"
          strokeWidth={1.2}
          strokeDasharray="3 9"
          vectorEffect="non-scaling-stroke"
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: 0.8 }}
          transition={still ? { duration: 0 } : { duration: 0.8, delay: 1.2 }}
        />
        {Array.from({ length: dots }, (_, place) => {
          const at = pointOn(place, dots);
          return (
            <motion.circle
              key={place}
              cx={at.x}
              cy={at.y}
              r={5}
              fill="var(--accent)"
              initial={still ? false : { opacity: 0, scale: 0 }}
              animate={{ opacity: 0.9, scale: 1 }}
              transition={
                still ? { duration: 0 } : { duration: 0.5, delay: 1.3 + place * 0.08, ease: [0.22, 1, 0.36, 1] }
              }
            />
          );
        })}
      </svg>
    </motion.div>
  );
}
