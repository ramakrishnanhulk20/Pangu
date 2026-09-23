"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";

// The whole drawing, once. Light and dark render these exact paths: only the
// token values behind --motif-line, --accent and --motif-glow change.
const CURVE =
  "M -60 890 C 280 878, 600 822, 812 664 C 1004 520, 1140 316, 1240 60";
const CAP_Y = 300;
const SHARE = { x: 1093, y: 354 };

function Drawing({ drawn }: { drawn: boolean }) {
  return (
    <g style={{ filter: "var(--motif-glow)" }}>
      <path
        d={CURVE}
        pathLength={1}
        fill="none"
        stroke="var(--motif-line)"
        strokeWidth={2.5}
        strokeLinecap="round"
        style={
          drawn
            ? undefined
            : {
                strokeDasharray: 1,
                strokeDashoffset: 1,
                animation:
                  "draw-curve 1.2s cubic-bezier(0.22, 1, 0.36, 1) 0.25s forwards",
              }
        }
      />
    </g>
  );
}

function Cap({ labelled, className }: { labelled: boolean; className?: string }) {
  return (
    <g className={className}>
      <line
        x1={-40}
        x2={1480}
        y1={CAP_Y}
        y2={CAP_Y}
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="0.5 10"
      />
      {labelled && (
        <text
          x={1420}
          y={CAP_Y - 18}
          textAnchor="end"
          fill="var(--muted)"
          fontSize={15}
          letterSpacing="0.16em"
          style={{
            fontFamily: "var(--font-plex-mono), monospace",
            textTransform: "uppercase",
          }}
        >
          the cap on one wallet
        </text>
      )}
    </g>
  );
}

function Share({ still, labelled }: { still: boolean; labelled: boolean }) {
  return (
    <motion.g
      initial={still ? false : { opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={
        still
          ? { duration: 0 }
          : { duration: 0.7, delay: 1.15, ease: [0.22, 1, 0.36, 1] }
      }
      style={{ transformOrigin: `${SHARE.x}px ${SHARE.y}px` }}
    >
      <circle
        cx={SHARE.x}
        cy={SHARE.y}
        r={34}
        fill="var(--accent)"
        opacity={0.12}
      />
      <circle cx={SHARE.x} cy={SHARE.y} r={14} fill="var(--accent)" />
      {labelled && (
        <text
          x={SHARE.x}
          y={SHARE.y + 56}
          textAnchor="middle"
          fill="var(--muted)"
          fontSize={15}
          letterSpacing="0.16em"
          style={{
            fontFamily: "var(--font-plex-mono), monospace",
            textTransform: "uppercase",
          }}
        >
          your share
        </text>
      )}
    </motion.g>
  );
}

/**
 * The hero's one asset. The curve rises as the page scrolls while the cap line
 * and the share dot hold still, so the curve climbs toward the cap.
 *
 * Scroll is read in a requestAnimationFrame loop and published as a CSS
 * variable, so nothing re-renders while the page moves.
 */
export function HeroMotif() {
  const reduced = useReducedMotion() ?? false;
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced || frame.current === null) {
      return;
    }
    const element = frame.current;
    let running = true;
    let last = -1;

    const tick = () => {
      if (!running) {
        return;
      }
      const span = window.innerHeight || 1;
      const progress = Math.min(1, Math.max(0, window.scrollY / span));
      if (Math.abs(progress - last) > 0.001) {
        element.style.setProperty("--hero-rise", progress.toFixed(4));
        last = progress;
      }
      window.requestAnimationFrame(tick);
    };

    window.requestAnimationFrame(tick);
    return () => {
      running = false;
    };
  }, [reduced]);

  const rising = {
    transform: "translate3d(0, calc(var(--hero-rise, 0) * -90px), 0)",
  } as const;

  return (
    <div
      ref={frame}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    >
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        className="hidden h-full w-full sm:block"
      >
        <g style={rising}>
          <Drawing drawn={reduced} />
        </g>
        <Cap labelled className="hidden md:inline" />
        <Share still={reduced} labelled />
      </svg>

      {/* Same paths, a tighter frame, so the share stays on screen on a phone
          rather than being cropped off the right edge. The two mono labels are
          dropped there: at 390px they would land on the title. */}
      <svg
        viewBox="598 -30 740 930"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full sm:hidden"
      >
        <g style={rising}>
          <Drawing drawn={reduced} />
        </g>
        <Share still={reduced} labelled={false} />
      </svg>

      {/* Under 768px the text fills the hero's height, and how tall the live
          numbers run changes with the sale, so a cap line fixed inside the
          drawing always lands on some line of it. Here the cap runs along the
          top instead, in the padding above the first line of text, over the
          curve and the share, which is where a cap sits. */}
      <div
        className="absolute inset-x-0 top-[18px] h-[3px] md:hidden"
        style={{
          backgroundImage: "radial-gradient(circle, var(--accent) 0 1px, transparent 1.4px)",
          backgroundSize: "10.5px 3px",
          filter: "var(--motif-glow)",
        }}
      />
    </div>
  );
}
