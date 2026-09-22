import record from "../../scripts/sales.json";

/**
 * The sales the devnet scripts opened. This file is the one the scripts append
 * to, so the app and the commands never disagree about which mints exist. Only
 * the mint is used as an input: every number on screen is read back off the
 * chain, never taken from here.
 */
export interface OpenedSale {
  network: string;
  name: string;
  symbol: string;
  mode: string;
  mint: string;
  pool: string;
  quoteMint: string;
  issuer: string;
  bandBps: number | null;
  feed?: string;
  openedAt: string;
}

export function openedSales(): OpenedSale[] {
  return (record as OpenedSale[]).filter((sale) => sale.network === "devnet");
}
