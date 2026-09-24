import type { Metadata } from "next";

import { LaunchPage } from "@/components/launch/launch-page";
import { CHAIN } from "@/lib/network";
import { readFeedPrices } from "@/lib/price-feed";

export const metadata: Metadata = {
  title: "Launch a sale | Pangu",
  description: `Open a Pangu sale on ${CHAIN.label} from the browser: the curve, the cap, who may buy and the price ceiling.`,
};

// The preview's stock price is read from Pyth's accounts on every load, not
// frozen at build time.
export const dynamic = "force-dynamic";

export default async function Launch() {
  return <LaunchPage initialPrices={await readFeedPrices()} />;
}
