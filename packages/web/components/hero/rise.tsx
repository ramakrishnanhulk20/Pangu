import type { CSSProperties, ReactNode } from "react";

// A CSS animation rather than a script-driven one, so the hero's words are in
// the first HTML, visible and already rising before any JavaScript has loaded.
// React hoists this one style block into the head once, however many times it
// renders. Anyone who asked for still gets the words where they rest.
const RISE_CSS = `
@keyframes pangu-rise {
  from {
    opacity: 0;
    transform: translate3d(0, var(--rise-distance, 24px), 0);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.pangu-rise {
  animation: pangu-rise 0.85s cubic-bezier(0.22, 1, 0.36, 1) var(--rise-delay, 0s) both;
}
@media (prefers-reduced-motion: reduce) {
  .pangu-rise {
    animation: none;
  }
}
`;

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
  const timing = {
    "--rise-delay": `${delay}s`,
    "--rise-distance": `${distance}px`,
  } as CSSProperties;

  return (
    <>
      <style href="pangu-rise" precedence="default">
        {RISE_CSS}
      </style>
      <div className={className === undefined ? "pangu-rise" : `pangu-rise ${className}`} style={timing}>
        {children}
      </div>
    </>
  );
}
