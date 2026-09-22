"use client";

import { useLenis } from "@/components/smooth-scroll";

/**
 * The page's one action. It carries a visitor to the live sale readout without
 * asking for a wallet, so smooth scroll has to be driven by hand: Lenis owns
 * the scroll position, and a plain anchor jump fights it.
 */
export function WatchSaleButton({ target }: { target: string }) {
  const lenis = useLenis();

  return (
    <a
      href={`#${target}`}
      onClick={(event) => {
        const element = document.getElementById(target);
        if (element === null) {
          return;
        }
        event.preventDefault();
        if (lenis !== null) {
          lenis.scrollTo(element, { offset: -80 });
        } else {
          element.scrollIntoView({ block: "start" });
        }
      }}
      className="group inline-flex h-12 items-center gap-3 rounded-lg bg-accent px-6 text-[15px] font-medium text-accent-ink transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
    >
      Watch the sale
      <span className="transition-transform duration-200 group-hover:translate-x-1">
        &darr;
      </span>
    </a>
  );
}
