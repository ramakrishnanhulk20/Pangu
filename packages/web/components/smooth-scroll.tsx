"use client";

import Lenis from "lenis";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

// The instance lives outside React. Anything that needs it, like ScrollTrigger,
// subscribes rather than re-rendering the tree when smooth scroll starts.
let current: Lenis | null = null;
const listeners = new Set<() => void>();

function publish(next: Lenis | null) {
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The running Lenis instance, or null when smooth scroll is off. */
export function useLenis(): Lenis | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  );
}

export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Someone who asked their system to stop animating gets the browser's own
    // scroll, untouched.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const instance = new Lenis({ autoRaf: true });
    publish(instance);

    return () => {
      instance.destroy();
      publish(null);
    };
  }, []);

  return <>{children}</>;
}
