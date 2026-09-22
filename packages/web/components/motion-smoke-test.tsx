"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";

import { useLenis } from "./smooth-scroll";

gsap.registerPlugin(ScrollTrigger);

const PANELS = [
  {
    label: "Panel one",
    line: "GSAP holds this section still while the page scrolls past it.",
  },
  {
    label: "Panel two",
    line: "The second panel slides in from the timeline, not from a class swap.",
  },
];

export function MotionSmokeTest() {
  const reduced = useReducedMotion();
  const lenis = useLenis();
  const section = useRef<HTMLElement>(null);
  const second = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Lenis moves the page on its own clock, so ScrollTrigger has to be told
    // when that clock ticks or the pin drifts behind the content.
    if (lenis === null) {
      return;
    }
    const update = () => ScrollTrigger.update();
    lenis.on("scroll", update);
    return () => {
      lenis.off("scroll", update);
    };
  }, [lenis]);

  useEffect(() => {
    if (reduced || section.current === null || second.current === null) {
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        second.current,
        { yPercent: 100 },
        {
          yPercent: 0,
          ease: "none",
          scrollTrigger: {
            trigger: section.current,
            start: "top top",
            end: "+=100%",
            pin: true,
            scrub: true,
          },
        }
      );
    }, section);

    return () => context.revert();
  }, [reduced]);

  return (
    <>
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 24 }}
          animate={reduced ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-lg border border-line p-6"
          data-testid="framer-mount"
        >
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
            Framer Motion
          </div>
          <p className="mt-2 text-sm">
            This block rose and faded in when the page mounted. Scroll on for the
            pinned pair.
          </p>
        </motion.div>
      </div>

      <section
        ref={section}
        data-testid="gsap-pin"
        className="relative mt-16 h-screen overflow-hidden border-y border-line"
      >
        <div className="absolute inset-0 flex items-center justify-center px-5">
          <Panel {...PANELS[0]} />
        </div>
        <div
          ref={second}
          data-testid="gsap-panel-two"
          className="absolute inset-0 flex items-center justify-center bg-raised px-5"
        >
          <Panel {...PANELS[1]} />
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 py-24 text-sm text-muted sm:px-8">
        Past the pin. Both libraries run.
      </div>
    </>
  );
}

function Panel({ label, line }: { label: string; line: string }) {
  return (
    <div className="max-w-xl">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
        {label}
      </div>
      <p className="mt-3 text-2xl tracking-tight">{line}</p>
    </div>
  );
}
