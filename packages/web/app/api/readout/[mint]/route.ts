import { NextResponse } from "next/server";

import { readReadout } from "@/lib/readout";

// The readout paints its first numbers on the server. This is where it comes
// back for them every fifteen seconds, and where the sale switch reads the
// other sale. Server only: the read behind it pulls in Meteora's own SDK.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mint: string }> }
) {
  const { mint } = await params;
  const readout = await readReadout(mint);

  return NextResponse.json(readout, {
    headers: { "cache-control": "no-store" },
  });
}
