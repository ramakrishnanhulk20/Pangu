"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/** Enters by rising and fading, once, on load. Still for anyone who asked for still. */
export function Rise({
  children,
  className,
  delay = 0,
  distance = 24,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  distance?: number;
}) {
  const still = useReducedMotion() === true;

  return (
    <motion.div
      className={className}
      initial={still ? false : { opacity: 0, y: distance }}
      // The animate target is set in both cases on purpose. The reduced-motion
      // answer only arrives after the first render, so an element that already
      // rendered hidden has to be told to be visible.
      animate={{ opacity: 1, y: 0 }}
      transition={
        still
          ? { duration: 0 }
          : { duration: 0.85, delay, ease: [0.22, 1, 0.36, 1] }
      }
    >
      {children}
    </motion.div>
  );
}
