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

function Cap({ labelled }: { labelled: boolean }) {
  return (
    <g>
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
        <Cap labelled />
        <Share still={reduced} labelled />
      </svg>

      {/* Same paths, a tighter frame, so the cap and the share stay on screen
          on a phone rather than being cropped off the right edge. The two mono
          labels are dropped there: at 390px they would land on the title. */}
      <svg
        viewBox="598 -30 740 930"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full sm:hidden"
      >
        <g style={rising}>
          <Drawing drawn={reduced} />
        </g>
        <Cap labelled={false} />
        <Share still={reduced} labelled={false} />
      </svg>
    </div>
  );
}
