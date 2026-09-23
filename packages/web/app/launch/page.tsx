import type { Metadata } from "next";

import { LaunchPage } from "@/components/launch/launch-page";
import type { FeedChoice } from "@/lib/launch";
import { CHAIN } from "@/lib/network";
import { openedSales } from "@/lib/sales";

export const metadata: Metadata = {
  title: "Launch a sale | Pangu",
  description: `Open a Pangu sale on ${CHAIN.label} from the browser: the curve, the cap, who may buy and the price ceiling.`,
};

/** The Pyth feed each choice on the form follows, as the scripts record it in sales.json. */
const FEED_SYMBOLS: Record<FeedChoice, string> = {
  apple: "Equity.US.AAPL/USD",
  aaplx: "Crypto.AAPLX/USD",
};

/**
 * For each feed, the newest of the app's own banded sales on it. The price
 * route only reads sales this app opened, so the preview's stock price comes
 * through one of them: the same Pyth account every buy on that feed is checked
 * against.
 */
function feedMints(): Record<FeedChoice, string | null> {
  const banded = openedSales()
    .filter((sale) => sale.bandBps !== null)
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const newestOn = (symbol: string) => banded.find((sale) => sale.feed === symbol)?.mint ?? null;
  return { apple: newestOn(FEED_SYMBOLS.apple), aaplx: newestOn(FEED_SYMBOLS.aaplx) };
}

export default function Launch() {
  return <LaunchPage feedMints={feedMints()} />;
}
