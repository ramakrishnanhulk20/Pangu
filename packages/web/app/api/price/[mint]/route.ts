import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { dollars, getSale, priceCeiling, readPrice } from "pangu-sdk";

import { openedSales } from "@/lib/sales";
import { devnetConnection } from "@/lib/solana";

// Reading the price needs no key: readPrice decodes the account the Pyth
// receiver already owns on chain. Writing a fresh price is a different job,
// pangu-sdk/price, and it reads PYTH_API_KEY. Only a server route may pull in
// that entry point. The moment a client component does, the key is in the
// browser bundle. The refresh lands in its own route in a later change.

export const dynamic = "force-dynamic";

// This is what stops a stranger from spending the app's RPC budget through
// this route: only the mints the scripts opened are ever read, and each one is
// read at most once every ten seconds, however many requests ask. The answer
// is shared the way the hero's pulse reading is, including while it is still
// in flight, so a burst of requests costs the chain one reading.
const FRESH_MS = 10_000;

interface Answer {
  body: unknown;
  status: number;
}

const answers = new Map<string, { at: number; answer: Promise<Answer> }>();

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

  const known = key.toBase58();
  if (!openedSales().some((sale) => sale.mint === known)) {
    return NextResponse.json(
      { error: "no Pangu sale at this mint on devnet" },
      { status: 404 }
    );
  }

  const now = Date.now();
  let held = answers.get(known);
  if (held === undefined || now - held.at >= FRESH_MS) {
    const entry = { at: now, answer: readAnswer(key) };
    answers.set(known, entry);
    // A failed reading is shared with the requests already waiting on it, then
    // dropped, so the next request tries the chain again.
    void entry.answer.then(({ status }) => {
      if (status >= 500 && answers.get(known) === entry) {
        answers.delete(known);
      }
    });
    held = entry;
  }
  const { body, status } = await held.answer;
  return NextResponse.json(body, { status });
}

/** Every way devnet can fail this read ends as JSON a caller can act on, never a bare 500. */
async function readAnswer(key: PublicKey): Promise<Answer> {
  try {
    return await readFromChain(key);
  } catch {
    // The error itself stays on the server: a failed request can carry the
    // RPC address in its message, and a keyed address must never leave here.
    return {
      status: 502,
      body: { error: "devnet did not answer the price read, try again in a few seconds" },
    };
  }
}

async function readFromChain(key: PublicKey): Promise<Answer> {
  const connection = devnetConnection();
  const sale = await getSale(connection, key);

  if (sale === null) {
    return { body: { error: "no Pangu sale at this mint on devnet" }, status: 404 };
  }

  if (!sale.hasBand) {
    return {
      body: { error: "this sale has no price band, so there is no price to read" },
      status: 409,
    };
  }

  const reading = await readPrice(connection, sale);

  // The same rule the hero and the readout follow: the ceiling is worked out
  // from the last published price even once it has aged out, and the answer
  // says it is stale rather than dropping the number.
  return {
    status: 200,
    body: {
      mint: sale.mint.toBase58(),
      priceAccount: reading.address.toBase58(),
      priceDollars: reading.priceDollars,
      ceilingDollars:
        reading.price > 0n
          ? dollars(priceCeiling({ bandBps: sale.bandBps }, reading.price))
          : null,
      stale: reading.error === "PriceStale",
      bandBps: sale.bandBps,
      publishTime: reading.publishTime,
      ageSecs: reading.ageSecs,
      confBps: reading.confBps,
      fullyVerified: reading.fullyVerified,
      usable: reading.usable,
      error: reading.error,
      reason: reading.reason,
    },
  };
}
