import type { Metadata } from "next";
import { Suspense } from "react";

import { Hero } from "@/components/hero/hero";
import { MotionSmokeTest } from "@/components/motion-smoke-test";
import { Readout } from "@/components/readout/readout";
import { ReadoutSkeleton } from "@/components/readout/readout-skeleton";

export const dynamic = "force-dynamic";

// Nothing links here and nothing indexes it. This is where anything visual
// gets looked at before it reaches a real screen.
export const metadata: Metadata = {
  title: "Lab",
  robots: { index: false, follow: false },
};

const READOUT = "the-sale";

export default function LabPage() {
  return (
    <div>
      <Hero readoutId={READOUT} />

      <Suspense fallback={<ReadoutSkeleton id={READOUT} />}>
        <Readout id={READOUT} />
      </Suspense>

      <MotionSmokeTest />
    </div>
  );
}
