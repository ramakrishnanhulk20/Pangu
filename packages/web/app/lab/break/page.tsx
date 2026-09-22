import type { Metadata } from "next";

import { BreakSection } from "@/components/break/break-section";
import { openedSales } from "@/lib/sales";

export const dynamic = "force-dynamic";

// Nothing links here and nothing indexes it. This is where the attack ledger
// gets looked at before it reaches the front page.
export const metadata: Metadata = {
  title: "Lab: try to break it",
  robots: { index: false, follow: false },
};

export default function BreakLabPage() {
  // Only the mint, the name and the mode travel from the file the devnet
  // scripts write. Every number on the screen is read back off the chain.
  const sales = openedSales().map((sale) => ({
    mint: sale.mint,
    name: sale.name,
    symbol: sale.symbol,
    mode: sale.mode,
  }));

  return <BreakSection sales={sales} />;
}
