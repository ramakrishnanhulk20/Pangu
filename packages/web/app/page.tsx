import { Suspense } from "react";

import { BreakSection } from "@/components/break/break-section";
import { Hero } from "@/components/hero/hero";
import { Readout } from "@/components/readout/readout";
import { ReadoutSkeleton } from "@/components/readout/readout-skeleton";
import { HowItWorks } from "@/components/story/how-it-works";
import { WhyNot } from "@/components/whynot/why-not";
import { Proof } from "@/components/proof/proof";
import { openedSales } from "@/lib/sales";

// Every load reads devnet rather than serving a snapshot taken at build time.
export const dynamic = "force-dynamic";

const READOUT = "the-sale";

export default function HomePage() {
  // Only the mint, the name and the mode travel from the file the devnet
  // scripts write. Every number on the attack ledger is read off the chain.
  const sales = openedSales().map((sale) => ({
    mint: sale.mint,
    name: sale.name,
    symbol: sale.symbol,
    mode: sale.mode,
  }));

  return (
    <div>
      <Hero readoutId={READOUT} />

      {/* The poster is in the first HTML the browser gets. Only the sale's
          numbers wait on devnet, inside their own boundary. */}
      <Suspense fallback={<ReadoutSkeleton id={READOUT} />}>
        <Readout id={READOUT} />
      </Suspense>

      <HowItWorks />
      <BreakSection sales={sales} />
      <WhyNot />
      <Proof />
    </div>
  );
}
