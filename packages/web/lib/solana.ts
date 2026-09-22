import { Connection } from "@solana/web3.js";

const PUBLIC_DEVNET = "https://api.devnet.solana.com";

/**
 * The devnet endpoint every read in this app goes through. Nothing here ever
 * talks to mainnet: the program is only deployed on devnet.
 */
export function devnetRpcUrl(): string {
  const configured = process.env.NEXT_PUBLIC_DEVNET_RPC_URL;
  return configured !== undefined && configured !== "" ? configured : PUBLIC_DEVNET;
}

export function devnetConnection(): Connection {
  return new Connection(devnetRpcUrl(), "confirmed");
}
