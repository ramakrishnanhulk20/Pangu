"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * The cap line, drawn through a row the moment the chain refuses it.
 *
 * It is the hero's dashed cap line again, at the scale of one attack: the buy
 * runs along the row, meets the line, and stops. Refusals draw it in the cold
 * refused colour, the one row that has to work draws it in the accent.
 */
export function Strike({ shown, tone }: { shown: boolean; tone: "refused" | "pass" }) {
  const still = useReducedMotion() === true;
  const colour = tone === "refused" ? "var(--refused)" : "var(--accent)";

  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.span
        className="absolute left-0 top-1/2 h-px w-full origin-left"
        style={{
          background: `repeating-linear-gradient(to right, ${colour} 0 3px, transparent 3px 11px)`,
        }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={shown ? { scaleX: 1, opacity: 0.85 } : { scaleX: 0, opacity: 0 }}
        transition={still ? { duration: 0 } : { duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.span
        className="absolute inset-y-0 left-0 w-full"
        style={{
          background: `linear-gradient(to right, ${colour}, transparent 62%)`,
        }}
        initial={{ opacity: 0 }}
        animate={shown ? { opacity: 0.07 } : { opacity: 0 }}
        transition={still ? { duration: 0 } : { duration: 0.6, ease: "easeOut" }}
      />
    </span>
  );
}

/** Waiting on the chain. A ring that turns, and holds still when asked to. */
export function Spinner() {
  const still = useReducedMotion() === true;

  return (
    <motion.span
      aria-hidden="true"
      className="inline-block h-3 w-3 rounded-full border border-current border-t-transparent"
      animate={still ? undefined : { rotate: 360 }}
      transition={still ? undefined : { duration: 0.9, repeat: Infinity, ease: "linear" }}
    />
  );
}

/**
 * Enters by rising and fading when it first comes into view, once.
 *
 * `as="li"` makes it the list item itself, so a list built from reveals still
 * has only list items as its children.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "li";
}) {
  const still = useReducedMotion() === true;
  const Element = as === "li" ? motion.li : motion.div;

  return (
    <Element
      className={className}
      initial={still ? false : { opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={still ? { duration: 0 } : { duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Element>
  );
}
