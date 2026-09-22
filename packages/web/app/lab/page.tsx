import type { Metadata } from "next";
import { Suspense } from "react";

import { Hero } from "@/components/hero/hero";
import { MotionSmokeTest } from "@/components/motion-smoke-test";
import { SaleBoard } from "@/components/sale-board";
import { SaleBoardSkeleton } from "@/components/sale-board-skeleton";

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

      <div id={READOUT} className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <h2 className="text-3xl font-medium tracking-tight">The sale, live</h2>
        <p className="mt-3 text-sm text-muted">
          Hidden. The same devnet read as the front page, then a check that both
          motion libraries run in this app.
        </p>

        <div className="mt-10">
          <Suspense fallback={<SaleBoardSkeleton />}>
            <SaleBoard />
          </Suspense>
        </div>
      </div>

      <MotionSmokeTest />
    </div>
  );
}
