"use client";

import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";

import { useLenis } from "@/components/smooth-scroll";

import { BEATS, RIDER_STOPS } from "./beats";
import { Reveal } from "./reveal";
import { StoryStage } from "./story-stage";

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

export function HowItWorks() {
  const lenis = useLenis();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

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
    const stage = root.current;
    const pinned = panel.current;
    if (stage === null || pinned === null) {
      return;
    }
    // Anyone who asked their system to stop animating gets the still list
    // instead, which CSS has already swapped in.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const track = stage.querySelector<SVGPathElement>('[data-part="track"]');
    const rider = stage.querySelector<SVGGElement>('[data-part="rider"]');
    if (track === null || rider === null) {
      return;
    }

    const context = gsap.context(() => {
      gsap.set(rider, { motionPath: { path: track, start: 0, end: 0 } });

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: pinned,
          start: "top top",
          end: "+=420%",
          pin: true,
          anticipatePin: 1,
          scrub: 0.6,
          onUpdate: (self) => {
            // Published, never stored in React: the page moves at 60 frames a
            // second and nothing here re-renders while it does.
            stage.style.setProperty("--story-progress", self.progress.toFixed(4));
            const beat = Math.min(
              BEATS.length,
              Math.floor(self.progress * BEATS.length) + 1
            );
            if (stage.dataset.beat !== String(beat)) {
              stage.dataset.beat = String(beat);
            }
          },
        },
      });

      for (let stop = 1; stop < RIDER_STOPS.length; stop += 1) {
        timeline.to(rider, {
          motionPath: {
            path: track,
            start: RIDER_STOPS[stop - 1],
            end: RIDER_STOPS[stop],
          },
          ease: "none",
          duration: 1,
        });
      }
    }, pinned);

    return () => context.revert();
  }, []);

  return (
    <section data-testid="how-it-works" className="relative">
      <div className="mx-auto w-full max-w-[1500px] px-[6vw] pt-24 pb-12 sm:pt-32 sm:pb-16">
        <Reveal>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            How it works
          </p>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-[15ch] font-display text-[clamp(2.4rem,7vw,5.5rem)] font-semibold leading-[0.9] tracking-[-0.04em]">
            One buy, all the way to graduation
          </h2>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mt-8 max-w-[46ch] text-[17px] leading-[1.5] text-muted sm:ml-auto sm:mr-0 sm:text-right">
            Every movement of the token passes through Pangu first. Here is what
            it checks, and the moment it stops checking for good.
          </p>
        </Reveal>
      </div>

      {/* The scrolling version. */}
      <div
        ref={root}
        data-story
        data-beat="1"
        className="motion-reduce:hidden"
      >
        <div
          ref={panel}
          data-testid="story-panel"
          className="relative flex h-svh w-full flex-col justify-center overflow-hidden border-y border-line"
        >
          <div className="mx-auto grid w-full max-w-[1500px] grid-cols-1 items-center gap-6 px-[6vw] sm:grid-cols-12 sm:gap-10">
            <div className="order-1 -mx-[6vw] sm:order-none sm:col-span-7 sm:mx-0 sm:-ml-[8vw]">
              <StoryStage className="h-auto w-full" />
            </div>

            <div className="order-2 sm:order-none sm:col-span-5">
              <div className="relative min-h-[9rem] sm:min-h-[13rem]">
                {BEATS.map((beat) => (
                  <div
                    key={beat.index}
                    data-beat-index={beat.index}
                    className="absolute inset-x-0 top-0"
                  >
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                      {String(beat.index).padStart(2, "0")} of 05
                    </span>
                    <p className="mt-4 font-display text-[clamp(1.75rem,3.4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
                      {beat.sentence}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="absolute right-[2.2vw] top-1/2 hidden h-40 w-px -translate-y-1/2 bg-line sm:block">
            <div
              className="h-full w-px origin-top bg-accent"
              style={{ transform: "scaleY(var(--story-progress, 0))" }}
            />
          </div>
        </div>
      </div>

      {/* The still version, for anyone who asked their system to stop moving. */}
      <ol className="mx-auto hidden w-full max-w-[1500px] gap-16 px-[6vw] motion-reduce:grid">
        {BEATS.map((beat) => (
          <li
            key={beat.index}
            data-story
            data-beat={beat.index}
            className="grid gap-6 border-t border-line pt-8 sm:grid-cols-12 sm:items-center"
          >
            <div className="sm:col-span-7">
              <StoryStage className="h-auto w-full" />
            </div>
            <div className="sm:col-span-5">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                {String(beat.index).padStart(2, "0")} of 05
              </span>
              <p className="mt-4 font-display text-[clamp(1.6rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
                {beat.sentence}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mx-auto w-full max-w-[1500px] px-[6vw] pt-20 pb-24 sm:pt-28 sm:pb-32">
        <Reveal>
          <p className="max-w-[24ch] font-display text-[clamp(1.6rem,3.6vw,2.75rem)] font-medium leading-[1.12] tracking-[-0.025em]">
            Selling back to the pool is always allowed.{" "}
            <span className="text-muted">
              Nothing in the rules can close the exit.
            </span>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
