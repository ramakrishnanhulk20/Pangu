import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { Refused, grantDemoDollars } from "@/lib/demo-dollars";

// The demo dollar key is read inside lib/demo-dollars, which only a server
// route may import. Nothing in this file is ever bundled for a browser.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { reason: "Send a JSON body holding the wallet to top up." },
      { status: 400 }
    );
  }

  const asked = (body as { wallet?: unknown } | null)?.wallet;
  if (typeof asked !== "string" || asked.trim() === "") {
    return NextResponse.json(
      { reason: "Connect a devnet wallet first, then press this again." },
      { status: 400 }
    );
  }

  let wallet: PublicKey;
  try {
    wallet = new PublicKey(asked.trim());
  } catch {
    return NextResponse.json(
      { reason: `${asked.trim().slice(0, 64)} is not a Solana address.` },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(await grantDemoDollars(wallet));
  } catch (error) {
    if (error instanceof Refused) {
      return NextResponse.json({ reason: error.message }, { status: error.status });
    }
    // The sentence a visitor gets never carries the thrown value: a failure
    // from web3.js can quote the whole transaction back. The detail stays in
    // the server's own log, one line, no stack.
    console.error(
      `demo dollars: ${error instanceof Error ? error.message : String(error)}`
    );
    return NextResponse.json(
      { reason: "Devnet did not take the mint. Wait a moment and press this again." },
      { status: 502 }
    );
  }
}
