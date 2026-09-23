/**
 * What every devnet script needs before it can do anything: the network, the
 * paying key, and a link a judge can click.
 *
 * The key is read from a file whose path comes from `.env`. Key bytes never
 * live in `.env`, never reach a log line, and never enter the repository (C12
 * in docs/security/threat-model.md).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

/** Devnet's own genesis hash. The one fact that says which chain answered. */
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

const DEFAULT_RPC = "https://api.devnet.solana.com";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryRoot = join(packageRoot, "..", "..");
export const scriptsRoot = packageRoot;

let loaded = false;

function loadEnvFile(): void {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    process.loadEnvFile(join(repositoryRoot, ".env"));
  } catch {
    // No .env is fine: the defaults below are a public RPC and a documented
    // key path, and a missing key is reported when it is actually needed.
  }
}

export function rpcUrl(): string {
  loadEnvFile();
  const url = process.env.DEVNET_RPC_URL;
  return url === undefined || url.length === 0 ? DEFAULT_RPC : url;
}

/**
 * The node's name as it may be printed. A keyed URL carries its API key in the
 * address itself, so the scripts name it instead of showing it.
 */
export function shownRpc(): string {
  const url = rpcUrl();
  return url === DEFAULT_RPC ? url : "the keyed devnet node from .env";
}

/**
 * The gap between two requests to the node, in milliseconds.
 *
 * The public devnet endpoint allows roughly ten calls a second per address and
 * answers the eleventh with an error the web3.js client turns into a crash. A
 * launch or an attack run makes hundreds of calls, so the starts are spaced out
 * here rather than hoping the retries cover it.
 *
 * Measured on 22 September 2026: at 120 the endpoint started answering "429
 * Connection rate limits exceeded" partway through a seeding run and kept
 * answering it for minutes, which is its own separate limit on how many calls
 * one address may hold open at once. Three a second clears both.
 */
const REQUEST_GAP_MS = 300;

let inLine: Promise<void> = Promise.resolve();

export function devnet(): Connection {
  return new Connection(rpcUrl(), {
    commitment: "confirmed",
    fetchMiddleware: (info, init, fetch) => {
      inLine = inLine.then(
        () =>
          new Promise<void>((next) => {
            setTimeout(() => {
              fetch(info, init);
              next();
            }, REQUEST_GAP_MS);
          })
      );
    },
  });
}

/**
 * Refuses to go on unless the node that answered really is devnet.
 *
 * The check is the chain's own genesis hash rather than a list of allowed URL
 * spellings, so a private RPC, a proxy or a typo cannot put a mainnet node
 * behind these scripts.
 */
export async function requireDevnet(connection: Connection): Promise<void> {
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) {
    throw new Error(
      `${connection.rpcEndpoint === DEFAULT_RPC ? DEFAULT_RPC : "The devnet node named in .env"} is not devnet: its genesis hash is ${genesis}. These scripts only run on devnet.`
    );
  }
}

/**
 * The keypair the scripts pay with, read from the path in
 * `DEVNET_PAYER_KEYPAIR`.
 *
 * Throws when the file is missing or is not a 64 byte secret key, naming the
 * path and the command that makes one. The bytes are never printed, not even
 * the fragment a JSON parser quotes back.
 */
export function payerKeypair(): Keypair {
  loadEnvFile();
  const path = process.env.DEVNET_PAYER_KEYPAIR;
  if (path === undefined || path.length === 0) {
    throw new Error(
      "DEVNET_PAYER_KEYPAIR is not set. Put the path of a devnet keypair file in .env, see .env.example."
    );
  }
  return readKeypairFile(resolve(path));
}

/**
 * A keypair out of a file in the shape `solana-keygen` writes: a JSON array of
 * 64 whole numbers from 0 to 255.
 *
 * Every refusal is one fixed sentence naming the path and the shape. Nothing
 * the parser or the key library said is passed on, because JSON.parse quotes
 * the input around the point it gave up, so a base58 secret or a trailing comma
 * would put key bytes in a log line.
 */
export function readKeypairFile(file: string): Keypair {
  const refused = new Error(
    `${file} is not a keypair file these scripts can read. It must be a JSON array of 64 whole numbers from 0 to 255, the shape solana-keygen writes. Make one with: solana-keygen new --outfile "${file}"`
  );
  if (!existsSync(file)) {
    throw new Error(
      `there is no keypair file at ${file}. Make one with: solana-keygen new --outfile "${file}"`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw refused;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    throw refused;
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  } catch {
    throw refused;
  }
}

export function addressLink(address: PublicKey | string): string {
  const text = typeof address === "string" ? address : address.toBase58();
  return `https://explorer.solana.com/address/${text}?cluster=devnet`;
}

export function transactionLink(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

/** A lamport amount as SOL, for a line a person reads. */
export function sol(lamports: number | bigint): string {
  return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(6);
}
