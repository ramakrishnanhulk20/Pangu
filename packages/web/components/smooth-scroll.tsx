"use client";

import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

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
  const pathname = usePathname();
  const firstPath = useRef(true);

  useEffect(() => {
    // Someone who asked their system to stop animating gets the browser's own
    // scroll, untouched.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const instance = new Lenis({ autoRaf: true });
    publish(instance);

    // Pages that read the chain grow after their first paint: ledgers, holder
    // lists, the directory. Lenis measured the shorter page, so the wheel
    // stopped short of the rows that arrived later. Any change in the page's
    // height makes it measure again.
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(document.body);

    return () => {
      observer.disconnect();
      instance.destroy();
      publish(null);
    };
  }, []);

  // Lenis keeps its own scroll position, so after a client-side page change it
  // carries the old page's depth over and the next docs page opens halfway down.
  // A new page starts at its top, or at the heading its link names.
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    const hash = window.location.hash;
    const target = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (current !== null) {
      // The heading clears the sticky 64px site nav.
      current.scrollTo(target ?? 0, { immediate: true, force: true, offset: target ? -80 : 0 });
    } else if (target !== null) {
      target.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname]);

  return <>{children}</>;
}
