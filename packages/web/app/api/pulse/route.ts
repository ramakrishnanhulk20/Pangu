import { NextResponse } from "next/server";

import { readPulse } from "@/lib/pulse";

// The hero paints its first numbers on the server. This is where the page
// comes back for them every fifteen seconds after that.
export const dynamic = "force-dynamic";

export async function GET() {
  const pulse = await readPulse();
  return NextResponse.json(pulse, {
    headers: { "cache-control": "no-store" },
  });
}
