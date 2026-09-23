import { SaleReadout } from "@/components/readout/sale-readout";
import type { DirectorySale } from "@/lib/directory";
import { readReadout } from "@/lib/readout";

/**
 * The front page's readout, for this one sale: the same component, read the
 * same way on the server, with this sale as its only choice so no picker shows.
 */
export async function SaleReadoutBlock({ id, sale }: { id: string; sale: DirectorySale }) {
  const initial = await readReadout(sale.mint);
  return (
    <SaleReadout
      id={id}
      initial={initial}
      choices={[{ mint: sale.mint, name: sale.name, running: sale.running }]}
    />
  );
}
