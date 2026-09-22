"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Rises into place the first time it is scrolled into view, and once only.
 * Shared by the story, the comparison and the ledger.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  distance = 28,
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
      // The same initial on the server and in the browser: branching on reduced
      // motion here would render one thing and hydrate another.
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={
        still ? { duration: 0 } : { duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }
      }
    >
      {children}
    </motion.div>
  );
}
