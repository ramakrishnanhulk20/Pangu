import type { Metadata } from "next";

import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { CHAIN } from "@/lib/network";

export const metadata: Metadata = {
  title: "What you hold | Pangu",
  description:
    `Every Pangu sale a wallet bought into or issued, with its holding, its room under the cap and what it can do next, read off ${CHAIN.label}.`,
};

export default function PortfolioPage() {
  return <PortfolioView />;
}
