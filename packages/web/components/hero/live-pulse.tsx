import { readPulse } from "@/lib/pulse";

import { PulseRow } from "./pulse-row";

/**
 * Reads devnet on the server so the first numbers are in the HTML, then hands
 * them to the client piece that keeps them moving.
 */
export async function LivePulse() {
  const pulse = await readPulse();
  return <PulseRow initial={pulse} />;
}
