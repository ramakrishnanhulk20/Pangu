import { Connection } from "@solana/web3.js";

const PUBLIC_DEVNET = "https://api.devnet.solana.com";

function configured(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== "" ? value.trim() : null;
}

/**
 * The devnet endpoint a browser talks to: the wallet connection and anything
 * else that runs on the visitor's machine. Every NEXT_PUBLIC_ value is written
 * into the bundle anyone can download, so this one is either the public
 * endpoint or a key the provider restricts to this site's origin.
 *
 * Nothing here ever talks to mainnet: the program is only deployed on devnet.
 */
export function devnetRpcUrl(): string {
  return configured(process.env.NEXT_PUBLIC_DEVNET_RPC_URL) ?? PUBLIC_DEVNET;
}

let triedRootEnv = false;

/**
 * The devnet endpoint the server reads through: DEVNET_RPC_URL when set, which
 * may carry a full key because it never leaves the server, then the browser's
 * endpoint, then the public one.
 *
 * On a developer machine DEVNET_RPC_URL lives in the repository root .env, two
 * folders above this app, which Next does not read by itself, so that file is
 * loaded the first time the variable is missing. The path is built as a plain
 * string on purpose: a browser component imports this file for devnetRpcUrl,
 * and a node:path import would break its bundle.
 */
function serverRpcUrl(): string {
  if (process.env.DEVNET_RPC_URL === undefined && !triedRootEnv) {
    triedRootEnv = true;
    try {
      process.loadEnvFile(`${process.cwd()}/../../.env`);
    } catch {
      // No root .env is what a deploy looks like, where the variable is set in
      // the project's own settings instead.
    }
  }
  return configured(process.env.DEVNET_RPC_URL) ?? devnetRpcUrl();
}

/** A connection for server reads. In a browser it falls back to the browser's endpoint. */
export function devnetConnection(): Connection {
  const url = typeof window === "undefined" ? serverRpcUrl() : devnetRpcUrl();
  return new Connection(url, "confirmed");
}
