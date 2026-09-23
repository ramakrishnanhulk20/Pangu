import { NextResponse } from "next/server";

import { readBreakTarget } from "@/lib/break-target";

// The attack ledger's sale, read on the server so a visitor with no wallet sees
// the facts at once. The ledger asks again every fifteen seconds.
export const dynamic = "force-dynamic";

export async function GET() {
  const reading = await readBreakTarget();
  return NextResponse.json(reading, {
    headers: { "cache-control": "no-store" },
  });
}
