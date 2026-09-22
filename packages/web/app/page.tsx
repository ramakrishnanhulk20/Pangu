import { Suspense } from "react";

import { Hero } from "@/components/hero/hero";
import { Readout } from "@/components/readout/readout";
import { ReadoutSkeleton } from "@/components/readout/readout-skeleton";
import { HowItWorks } from "@/components/story/how-it-works";
import { WhyNot } from "@/components/whynot/why-not";
import { Proof } from "@/components/proof/proof";

// Every load reads devnet rather than serving a snapshot taken at build time.
export const dynamic = "force-dynamic";

const READOUT = "the-sale";

export default function HomePage() {
  return (
    <div>
      <Hero readoutId={READOUT} />

      {/* The poster is in the first HTML the browser gets. Only the sale's
          numbers wait on devnet, inside their own boundary. */}
      <Suspense fallback={<ReadoutSkeleton id={READOUT} />}>
        <Readout id={READOUT} />
      </Suspense>

      <HowItWorks />
      <WhyNot />
      <Proof />
    </div>
  );
}
