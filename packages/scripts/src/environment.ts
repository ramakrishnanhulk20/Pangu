/**
 * What every devnet script needs before it can do anything: the network, the
 * paying key, and a link a judge can click.
 *
 * The key is read from a file whose path comes from `.env`. Key bytes never
 * live in `.env`, never reach a log line, and never enter the repository (C12
 * in docs/security/threat-model.md).
 */

import { readFileSync } from "node:fs";
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
 * The gap between two requests to the node, in milliseconds.
 *
 * The public devnet endpoint allows roughly ten calls a second per address and
 * answers the eleventh with an error the web3.js client turns into a crash. A
 * launch or an attack run makes hundreds of calls, so the starts are spaced out
 * here rather than hoping the retries cover it.
 */
const REQUEST_GAP_MS = 120;

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
      `${connection.rpcEndpoint} is not devnet: its genesis hash is ${genesis}. These scripts only run on devnet.`
    );
  }
}

/**
 * The keypair the scripts pay with, read from the path in
 * `DEVNET_PAYER_KEYPAIR`.
 *
 * Throws when the file is missing or is not a 64 byte secret key, naming the
 * path and the command that makes one. The bytes are never printed.
 */
export function payerKeypair(): Keypair {
  loadEnvFile();
  const path = process.env.DEVNET_PAYER_KEYPAIR;
  if (path === undefined || path.length === 0) {
    throw new Error(
      "DEVNET_PAYER_KEYPAIR is not set. Put the path of a devnet keypair file in .env, see .env.example."
    );
  }
  const file = resolve(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `cannot read the keypair at ${file}: ${error instanceof Error ? error.message : String(error)}. Make one with: solana-keygen new --outfile "${file}"`
    );
  }
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error(`${file} is not a 64 byte Solana keypair file`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
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
