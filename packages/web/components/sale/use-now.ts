"use client";

import { useSyncExternalStore } from "react";

const STEP_MS = 15_000;

function everyStep(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, STEP_MS);
  return () => window.clearInterval(timer);
}

// Rounded to the step so two reads in the same render agree, which React
// requires of a snapshot. Time left is shown to the minute, so 15 s is plenty.
function stepNow(): number {
  return Math.floor(Date.now() / STEP_MS) * STEP_MS;
}

/**
 * The visitor's clock, moving every 15 seconds. Null on the server and in the
 * first paint, so the server's HTML and the hydrated page never disagree about
 * how long is left.
 */
export function useNow(): number | null {
  return useSyncExternalStore(everyStep, stepNow, () => null);
}
