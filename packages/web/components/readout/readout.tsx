import { defaultChoice, readReadout, readSaleChoices } from "@/lib/readout";

import { SaleReadout } from "./sale-readout";

/**
 * Reads devnet on the server so the section's numbers are in the first HTML,
 * then hands them to the client piece that keeps them moving.
 *
 * Server only: the read behind it pulls in Meteora's own SDK to reach the
 * pool's square root price and its curve, which no browser should download.
 */
export async function Readout({ id }: { id: string }) {
  const choices = await readSaleChoices();
  const chosen = defaultChoice(choices);

  if (chosen === null) {
    return (
      <section id={id} className="border-t border-line px-[6vw] py-24">
        <p className="max-w-[46ch] text-[15px] text-muted">
          No sale has been opened on Solana devnet yet, so there is nothing true
          to show here.
        </p>
      </section>
    );
  }

  const initial = await readReadout(chosen.mint);
  return <SaleReadout id={id} initial={initial} choices={choices} />;
}
