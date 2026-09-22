import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { dollars, getSale, priceCeiling, readPrice } from "pangu-sdk";

import { devnetConnection } from "@/lib/solana";

// Reading the price needs no key: readPrice decodes the account the Pyth
// receiver already owns on chain. Writing a fresh price is a different job,
// pangu-sdk/price, and it reads PYTH_API_KEY. Only a server route may pull in
// that entry point. The moment a client component does, the key is in the
// browser bundle. The refresh lands in its own route in a later change.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mint: string }> }
) {
  const { mint } = await params;

  let key: PublicKey;
  try {
    key = new PublicKey(mint);
  } catch {
    return NextResponse.json(
      { error: `${mint} is not a Solana address` },
      { status: 400 }
    );
  }

  const connection = devnetConnection();
  const sale = await getSale(connection, key);

  if (sale === null) {
    return NextResponse.json(
      { error: "no Pangu sale at this mint on devnet" },
      { status: 404 }
    );
  }

  if (!sale.hasBand) {
    return NextResponse.json(
      { error: "this sale has no price band, so there is no price to read" },
      { status: 409 }
    );
  }

  const reading = await readPrice(connection, sale);

  return NextResponse.json({
    mint: sale.mint.toBase58(),
    priceAccount: reading.address.toBase58(),
    priceDollars: reading.priceDollars,
    ceilingDollars: reading.usable
      ? dollars(priceCeiling({ bandBps: sale.bandBps }, reading.price))
      : null,
    bandBps: sale.bandBps,
    publishTime: reading.publishTime,
    ageSecs: reading.ageSecs,
    confBps: reading.confBps,
    fullyVerified: reading.fullyVerified,
    usable: reading.usable,
    error: reading.error,
    reason: reading.reason,
  });
}
