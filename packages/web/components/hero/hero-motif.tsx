"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";

// The whole drawing, once. Light and dark render these exact paths: only the
// token values behind --motif-line, --accent and --motif-glow change.
const CURVE =
  "M -60 890 C 280 878, 600 822, 812 664 C 1004 520, 1140 316, 1240 60";
const CAP_Y = 300;
const SHARE = { x: 1093, y: 354 };
/** The phone's tighter frame on the same drawing. */
const PHONE_VIEW = { x: 598, y: -30, width: 740, height: 930 };

/** How far above the title the phone's curve starts to fade out, in pixels. */
const FADE_PX = 32;

/**
 * The phone's curve is hidden from the title down to the foot of the hero's
 * words, so it never crosses a letter or the button. Stops are set by the
 * placing effect; until it runs they sit at the bottom and the curve shows whole.
 */
const PHONE_FADE =
  "linear-gradient(to bottom, #000 var(--fade-start, 100%), transparent var(--fade-clear, 100%), transparent var(--fade-end, 100%), #000 var(--fade-end, 100%))";

/** How far down the hero an element's box starts, ignoring any entrance still moving it. */
function depthIn(element: HTMLElement, hero: HTMLElement): number | null {
  let depth = 0;
  let at: Element | null = element;
  while (at instanceof HTMLElement && at !== hero) {
    depth += at.offsetTop;
    at = at.offsetParent;
  }
  return at === hero ? depth : null;
}

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

  // On a phone the live numbers above the title run as tall as the sale makes
  // them, so a share dot fixed in the drawing lands on whichever line of them
  // reaches it. Here the phone's drawing, curve and dot together, is slid so
  // the dot sits level with the top of the title, to its right: clear of the
  // numbers above and the sentence below, however many lines the numbers take.
  useEffect(() => {
    const element = frame.current;
    const hero = element?.parentElement;
    const title = hero?.querySelector("h1");
    if (element === null || hero === null || hero === undefined || title === null || title === undefined) {
      return;
    }

    const place = () => {
      const titleTop = depthIn(title, hero);
      if (titleTop === null) {
        return;
      }
      const width = element.clientWidth;
      const height = element.clientHeight;
      const scale = Math.max(width / PHONE_VIEW.width, height / PHONE_VIEW.height);
      const drawingTop = (height - PHONE_VIEW.height * scale) / 2;
      const dot = drawingTop + (SHARE.y - PHONE_VIEW.y) * scale;
      const shift = titleTop - dot;
      element.style.setProperty("--share-shift", `${shift.toFixed(1)}px`);

      // The fade is drawn on the slid drawing, so its stops are taken back by
      // the same slide. It runs to the foot of the block that holds the title,
      // which also holds the sentence, the button and the facts line.
      const block = words();
      const blockTop = block === null ? null : depthIn(block, hero);
      const wordsEnd =
        block === null || blockTop === null ? height : blockTop + block.offsetHeight;
      const local = (y: number) => `${(y - shift).toFixed(1)}px`;
      element.style.setProperty("--fade-start", local(titleTop - FADE_PX));
      element.style.setProperty("--fade-clear", local(titleTop));
      element.style.setProperty("--fade-end", local(wordsEnd));
    };

    // The title's column is found by what it contains, not by offsetParent:
    // the entrance's transform makes each rising wrapper an offsetParent too.
    const holding = (parent: Element): Element | undefined =>
      Array.from(parent.children).find((child) => child !== element && child.contains(title));
    const column = holding(hero);
    const words = (): HTMLElement | null => {
      const holder = column === undefined ? undefined : holding(column);
      return holder instanceof HTMLElement ? holder : null;
    };

    place();
    const watcher = new ResizeObserver(place);
    watcher.observe(hero);
    // The title moves when anything above it in its column changes height,
    // which does not always change the hero's own height.
    if (column !== undefined) {
      for (const block of Array.from(column.children)) {
        watcher.observe(block);
      }
    }
    return () => watcher.disconnect();
  }, []);

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
        className="hidden h-full w-full md:block"
      >
        <g style={rising}>
          <Drawing drawn={reduced} />
        </g>
        <Cap labelled className="hidden md:inline" />
        <Share still={reduced} labelled />
      </svg>

      {/* Same paths, a tighter frame, so the share stays on screen on a phone
          rather than being cropped off the right edge. The two mono labels are
          dropped there: at 390px they would land on the title. The curve and
          the dot are two layers so the curve can fade behind the words while
          the dot, beside the title, stays whole. */}
      <svg
        viewBox={`${PHONE_VIEW.x} ${PHONE_VIEW.y} ${PHONE_VIEW.width} ${PHONE_VIEW.height}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full md:hidden"
        style={{
          transform: "translate3d(0, var(--share-shift, 0px), 0)",
          maskImage: PHONE_FADE,
          WebkitMaskImage: PHONE_FADE,
        }}
      >
        <g style={rising}>
          <Drawing drawn={reduced} />
        </g>
      </svg>
      <svg
        viewBox={`${PHONE_VIEW.x} ${PHONE_VIEW.y} ${PHONE_VIEW.width} ${PHONE_VIEW.height}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full md:hidden"
        style={{ transform: "translate3d(0, var(--share-shift, 0px), 0)" }}
      >
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
