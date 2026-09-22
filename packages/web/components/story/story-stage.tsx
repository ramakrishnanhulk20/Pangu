// The drawing the whole story happens on. Every piece carries a data-part, and
// globals.css decides which parts are visible at which beat, so the same SVG
// serves the scrolling version and the five still ones.

const CURVE = "M 48 552 C 220 546, 400 520, 520 462 C 640 404, 720 320, 764 196";
const FLAT = "M 764 196 L 930 190";
const TRACK = `${CURVE} L 930 190`;

const CAP_Y = 330;
const APPLE_Y = 150;

const LABEL = {
  fill: "var(--muted)",
  fontSize: 15,
  letterSpacing: "0.16em",
  style: {
    fontFamily: "var(--font-plex-mono), monospace",
    textTransform: "uppercase" as const,
  },
};

/** Labels are dropped below 640px: at that width they render smaller than the
 *  body text and read as noise. The drawing alone carries the beat there. */
const ON_WIDE = "hidden sm:block";

export function StoryStage({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 960 620"
      className={className}
      aria-hidden="true"
      fill="none"
    >
      <g data-part="base" style={{ filter: "var(--motif-glow)" }}>
        <line
          x1={40}
          x2={930}
          y1={588}
          y2={588}
          stroke="var(--motif-faint)"
          strokeWidth={2}
        />
        <path
          d={CURVE}
          stroke="var(--motif-line)"
          strokeWidth={3}
          strokeLinecap="round"
        />
      </g>

      {/* The line the dot rides. Never painted: it exists so the motion has
          somewhere to run, curve then flat, as one journey. */}
      <path data-part="track" d={TRACK} stroke="none" />

      <g data-part="cap">
        <line
          x1={40}
          x2={930}
          y1={CAP_Y}
          y2={CAP_Y}
          stroke="var(--accent)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray="3 9"
        />
        <text {...LABEL} className={ON_WIDE} x={44} y={CAP_Y - 18} textAnchor="start">
          the cap on one wallet
        </text>
      </g>

      {/* A second wallet comes up, meets the cap, and stops under it. */}
      <g data-part="over-cap">
        <path
          d="M 430 466 L 430 398"
          stroke="var(--refused)"
          strokeWidth={2}
          strokeDasharray="6 7"
        />
        <circle cx={430} cy={356} r={30} fill="var(--refused)" opacity={0.12} />
        <circle cx={430} cy={356} r={13} fill="var(--refused)" />
        <path
          d="M 424 350 L 436 362 M 436 350 L 424 362"
          stroke="var(--paper)"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      </g>

      <g data-part="unapproved">
        <circle cx={200} cy={452} r={13} fill="var(--refused)" />
        <path
          d="M 194 446 L 206 458 M 206 446 L 194 458"
          stroke="var(--paper)"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
        <text {...LABEL} className={ON_WIDE} x={200} y={494} textAnchor="middle">
          not on the list
        </text>
      </g>

      <g data-part="apple">
        <line
          x1={40}
          x2={930}
          y1={APPLE_Y}
          y2={APPLE_Y}
          stroke="var(--ink)"
          strokeWidth={2}
          strokeDasharray="14 9"
          opacity={0.55}
        />
        <text {...LABEL} className={ON_WIDE} x={44} y={APPLE_Y - 18} textAnchor="start">
          Apple, the real price
        </text>
      </g>

      <g data-part="refused-run">
        <path
          d="M 764 196 C 800 160, 820 122, 830 82"
          stroke="var(--refused)"
          strokeWidth={3}
          strokeDasharray="8 9"
          strokeLinecap="round"
        />
        <text {...LABEL} className={ON_WIDE} x={926} y={46} textAnchor="end">
          this buy is refused
        </text>
      </g>

      <g data-part="damm">
        <path
          d={FLAT}
          stroke="var(--motif-line)"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <text {...LABEL} className={ON_WIDE} x={926} y={144} textAnchor="end">
          DAMM v2, trades freely from here
        </text>
      </g>

      {/* The buyer. It is the one thing that moves, and it carries its own
          approval mark, so the mark travels with the buy rather than sitting
          somewhere on the page. */}
      <g data-part="rider">
        <circle r={30} fill="var(--accent)" opacity={0.14} />
        <circle r={13} fill="var(--accent)" />
        <path
          data-part="check"
          d="M 16 -24 l 6 7 l 12 -16"
          stroke="var(--accent)"
          strokeWidth={3.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
