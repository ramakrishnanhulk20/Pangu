import type { Metadata } from "next";

import { BreakSection } from "@/components/break/break-section";

export const dynamic = "force-dynamic";

// Nothing links here and nothing indexes it. This is where the attack ledger
// gets looked at before it reaches the front page.
export const metadata: Metadata = {
  title: "Lab: try to break it",
  robots: { index: false, follow: false },
};

export default function BreakLabPage() {
  // The ledger reads its own sale from the server; every number on the
  // screen comes back off the chain.
  return <BreakSection />;
}
