import type { Metadata } from "next";

import { DirectoryMotif } from "@/components/sales/directory-motif";
import { SalesLedger } from "@/components/sales/sales-ledger";
import { SalesTitle } from "@/components/sales/sales-title";
import { readDirectory } from "@/lib/directory";

// Every load reads the chain's list of sales rather than a snapshot from build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Every sale on the chain | Pangu",
  description: "Every Pangu sale on Solana devnet, read off the program itself.",
};

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const all = (await searchParams).all === "1";
  const directory = await readDirectory(all);

  return (
    <section className="grain relative isolate overflow-hidden px-[6vw] pb-28 pt-16 sm:pt-24">
      <DirectoryMotif count={directory.sales.length} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[20%] top-[30%] -z-10 h-[520px] w-[520px] rounded-full opacity-[0.12] blur-[120px]"
        style={{ background: "var(--accent)" }}
      />

      <SalesTitle count={directory.failure === null ? directory.sales.length : null} />

      <div className="mx-auto mt-16 max-w-[1500px] sm:mt-24">
        <SalesLedger initial={directory} all={all} />
      </div>
    </section>
  );
}
