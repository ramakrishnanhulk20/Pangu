import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { forgetBreakTarget } from "@/lib/break-target";
import { Refused } from "@/lib/demo-dollars";
import { refreshIfStale } from "@/lib/price-refresh";
import { openedSales } from "@/lib/sales";

// The demo key and the Hermes key are read inside lib/price-refresh, which only
// a server route may import. Nothing in this file is ever bundled for a browser.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { reason: "Send a JSON body holding the sale's mint." },
      { status: 400 }
    );
  }

  const asked = (body as { mint?: unknown } | null)?.mint;
  if (typeof asked !== "string" || asked.trim() === "") {
    return NextResponse.json(
      { reason: "Name the sale's mint to bring its price up to date." },
      { status: 400 }
    );
  }

  let mint: PublicKey;
  try {
    mint = new PublicKey(asked.trim());
  } catch {
    return NextResponse.json(
      { reason: `${asked.trim().slice(0, 64)} is not a Solana address.` },
      { status: 400 }
    );
  }

  // Only the app's own banded sales. A stranger cannot point the demo key at
  // any other feed or any other account.
  const known = mint.toBase58();
  const sale = openedSales().find((entry) => entry.mint === known);
  if (sale === undefined || sale.bandBps === null) {
    return NextResponse.json(
      { reason: "This app only brings the price up to date for its own sales with a price band." },
      { status: 404 }
    );
  }

  try {
    const outcome = await refreshIfStale(mint);
    if (outcome.status === "posted") {
      // The ledger reads the sale again straight after this answer, and should
      // see the price just posted rather than the reading from before it.
      forgetBreakTarget();
    }
    return NextResponse.json(outcome, {
      status: outcome.status === "limited" ? 429 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Refused) {
      return NextResponse.json({ reason: error.message }, { status: error.status });
    }
    // A failure from web3.js or Hermes can carry the keyed RPC address, so the
    // visitor gets a sentence and the server's log gets one line, no stack.
    console.error(
      `price refresh: ${error instanceof Error ? error.message : String(error)}`
    );
    return NextResponse.json(
      { reason: "Devnet did not take the price update. Wait a minute and try again." },
      { status: 502 }
    );
  }
}
