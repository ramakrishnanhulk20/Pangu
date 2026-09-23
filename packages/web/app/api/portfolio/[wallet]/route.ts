import { NextResponse } from "next/server";

import { readPortfolio } from "@/lib/portfolio";

// One wallet's place in every Pangu sale, read through the server's own
// endpoint and shared for fifteen seconds per wallet. Only public data is read:
// anyone may ask about any address, the way any explorer answers.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ wallet: string }> }
) {
  const { wallet } = await params;
  const answer = await readPortfolio(wallet);
  if (!answer.ok) {
    return NextResponse.json(
      { reason: answer.reason },
      { status: answer.status, headers: { "cache-control": "no-store" } }
    );
  }
  return NextResponse.json(answer.portfolio, {
    status: answer.portfolio.failure === null ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
