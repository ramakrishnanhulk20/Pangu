import { Suspense } from "react";

import { SaleBoard } from "@/components/sale-board";
import { SaleBoardSkeleton } from "@/components/sale-board-skeleton";

// Every load reads devnet rather than serving a snapshot taken at build time.
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <h1 className="text-4xl font-medium tracking-tight">Pangu</h1>

      <p className="mt-3 text-sm text-muted">
        Live sales on Solana devnet, read straight off the chain.
      </p>

      <div className="mt-10">
        <Suspense fallback={<SaleBoardSkeleton />}>
          <SaleBoard />
        </Suspense>
      </div>
    </div>
  );
}
