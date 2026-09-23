import { NextResponse } from "next/server";

import { readDirectory } from "@/lib/directory";

// Every Pangu sale on devnet, read off the chain and shared for thirty seconds.
// Server only: the read goes through the server's own endpoint, which may carry
// a key. ?all=1 adds the demo sales sales.json marks as retired.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const all = new URL(request.url).searchParams.get("all") === "1";
  const directory = await readDirectory(all);
  return NextResponse.json(directory, {
    status: directory.failure === null ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
