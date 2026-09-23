import { Connection, type ConnectionConfig } from "@solana/web3.js";

import { CHAIN, GENESIS_HASH, NETWORK, browserRpcUrl, isLocalEndpoint } from "./network";

/**
 * The server-only variable naming this network's endpoint, which may carry a
 * key. Kept here, in a file no browser component imports, so the name never
 * reaches a client bundle either.
 */
const SERVER_RPC_VARIABLE = NETWORK === "mainnet" ? "MAINNET_RPC_URL" : "DEVNET_RPC_URL";

function configured(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== "" ? value.trim() : null;
}

let triedRootEnv = false;

/**
 * The endpoint the server reads through: DEVNET_RPC_URL or MAINNET_RPC_URL,
 * whichever names this network, when set. It may carry a full key because it
 * never leaves the server. Then the browser's endpoint, then the public one.
 *
 * On a developer machine the variable lives in the repository root .env, two
 * folders above this app, which Next does not read by itself, so that file is
 * loaded the first time the variable is missing. A variable already set in the
 * environment is never overwritten by it. The path is built as a plain string
 * so this file needs no node:path import and stays safe to bundle anywhere.
 */
function serverRpcUrl(): string {
  if (process.env[SERVER_RPC_VARIABLE] === undefined && !triedRootEnv) {
    triedRootEnv = true;
    try {
      process.loadEnvFile(`${process.cwd()}/../../.env`);
    } catch {
      // No root .env is what a deploy looks like, where the variable is set in
      // the project's own settings instead.
    }
  }
  return configured(process.env[SERVER_RPC_VARIABLE]) ?? browserRpcUrl();
}

/**
 * What the server's endpoint turned out to be, asked once per process:
 * "right" when its genesis hash is this network's, "rehearsal" when it is a
 * chain on this machine standing in for it, "wrong" otherwise.
 */
export type ChainVerdict = "right" | "rehearsal" | "wrong";

/** A read refused because the endpoint is not the network this app was built for. */
export class WrongChain extends Error {
  constructor() {
    super(`the server's endpoint is not ${CHAIN.label}, so nothing is read from it`);
    this.name = "WrongChain";
  }
}

let verdict: Promise<ChainVerdict> | null = null;

async function askGenesis(url: string): Promise<ChainVerdict> {
  const answer = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await answer.json()) as { result?: unknown };
  if (typeof body.result !== "string") {
    throw new Error(`the endpoint gave no genesis hash (status ${answer.status})`);
  }
  if (body.result === GENESIS_HASH) {
    return "right";
  }
  return isLocalEndpoint(url) ? "rehearsal" : "wrong";
}

/**
 * Checks, once per server process, that the server's endpoint is the network
 * this app was built for, by its genesis hash. A chain on this machine is let
 * through as a rehearsal. An endpoint that does not answer is asked again next
 * time rather than judged.
 *
 * Every server read goes through this, so an app built for mainnet and pointed
 * at a devnet endpoint shows no numbers at all rather than devnet's numbers
 * under mainnet's name.
 */
export function chainVerdict(): Promise<ChainVerdict> {
  if (verdict === null) {
    const asking = askGenesis(serverRpcUrl());
    verdict = asking;
    asking.then(
      (found) => {
        if (found === "wrong") {
          console.error(`chain check: the server's endpoint is not ${CHAIN.label}; every read is refused`);
        }
      },
      () => {
        if (verdict === asking) {
          verdict = null;
        }
      }
    );
  }
  return verdict;
}

/** Throws {@link WrongChain} when the server's endpoint is another network. */
export async function requireRightChain(): Promise<void> {
  if ((await chainVerdict()) === "wrong") {
    throw new WrongChain();
  }
}

// web3.js types its fetch option against its own bundled fetch declaration,
// which the platform's own fetch does not line up with by name. The call shape
// is the same one, so it is handed over as the config wants it.
const checkedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  await requireRightChain();
  return fetch(input, init);
}) as unknown as ConnectionConfig["fetch"];

/**
 * A connection for reads. On the server every call waits for the chain check
 * and is refused on the wrong network. In a browser it is the browser's own
 * endpoint.
 */
export function chainConnection(): Connection {
  if (typeof window !== "undefined") {
    return new Connection(browserRpcUrl(), "confirmed");
  }
  return new Connection(serverRpcUrl(), { commitment: "confirmed", fetch: checkedFetch });
}
