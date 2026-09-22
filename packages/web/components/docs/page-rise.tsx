"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/** The page body arrives rather than appears. Off when the reader asked for less motion. */
export function PageRise({ children }: { children: ReactNode }) {
  const still = useReducedMotion();

  if (still) return <>{children}</>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
