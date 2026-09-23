import type { Metadata } from "next";
import { Suspense } from "react";

import { ReadoutSkeleton } from "@/components/readout/readout-skeleton";
import { SaleDesk } from "@/components/sale/sale-desk";
import { SaleNotFound } from "@/components/sale/sale-not-found";
import { SaleReadoutBlock } from "@/components/sale/sale-readout-block";
import { SaleTitle } from "@/components/sale/sale-title";
import { findSale } from "@/lib/directory";

// Every load reads devnet rather than a snapshot from build time.
export const dynamic = "force-dynamic";

const READOUT = "the-sale";

type Params = { params: Promise<{ mint: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { mint } = await params;
  const lookup = await findSale(mint);
  return lookup.found
    ? {
        title: `${lookup.sale.name} | Pangu`,
        description: `${lookup.sale.name}, a Pangu sale on Solana devnet, read live off the chain.`,
      }
    : { title: "No sale here | Pangu" };
}

export default async function SalePage({ params }: Params) {
  const { mint } = await params;
  const lookup = await findSale(mint);
  if (!lookup.found) {
    return <SaleNotFound mint={mint} unanswered={lookup.unanswered} />;
  }

  return (
    <div>
      <SaleTitle sale={lookup.sale} />
      <Suspense fallback={<ReadoutSkeleton id={READOUT} />}>
        <SaleReadoutBlock id={READOUT} sale={lookup.sale} />
      </Suspense>
      <SaleDesk sale={lookup.sale} terms={lookup.terms} />
    </div>
  );
}
