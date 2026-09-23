const NUMBER = {
  large:
    "font-display text-[clamp(4.5rem,13vw,10.5rem)] font-semibold leading-[0.8] tracking-[-0.05em] tabular-nums",
  small:
    "font-display text-[clamp(2.25rem,4vw,3.25rem)] font-semibold leading-[0.85] tracking-[-0.04em] tabular-nums",
} as const;

const HOLD = {
  large: "h-[clamp(3.6rem,10.4vw,8.4rem)] w-[clamp(4rem,11vw,8rem)]",
  small: "h-[clamp(1.9rem,3.4vw,2.75rem)] w-16",
} as const;

/** One live count and what it counts. Null when the chain did not answer: no number stands in. */
export function DoorFigure({
  value,
  label,
  size,
}: {
  value: number | null;
  label: string;
  size: "large" | "small";
}) {
  return (
    <p className="flex flex-col gap-3" data-testid="door-figure">
      {value !== null && <span className={NUMBER[size]}>{value.toLocaleString("en-US")}</span>}
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
    </p>
  );
}

/** Holds the number's place while the chain is read, so nothing jumps when it lands. */
export function DoorFigureWaiting({ size }: { size: "large" | "small" }) {
  return (
    <p className="flex flex-col gap-3" aria-label="reading the chain">
      <span className={`block animate-pulse rounded-lg bg-line motion-reduce:animate-none ${HOLD[size]}`} />
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">reading the chain</span>
    </p>
  );
}
