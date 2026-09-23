// Reading the paying keypair out of its file, and what a refusal is allowed to
// say about that file. Which chain a node is, by its genesis hash, and what may
// be printed about a keyed node.
//
// Does NOT cover: loading .env or reaching devnet. Those need the machine's own
// settings and a network, and every devnet command exercises them.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Keypair, type Connection } from "@solana/web3.js";
import {
  DEVNET_GENESIS,
  MAINNET_GENESIS,
  nodeName,
  readKeypairFile,
  requireDevnet,
  requireMainnet,
  scrubNodes,
} from "../src/environment.js";

const folder = mkdtempSync(join(tmpdir(), "pangu-key-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

/** The same sixty-four bytes the real key files carry, in base58 as some wallets export them. */
function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let text = "";
  while (value > 0n) {
    text = alphabet[Number(value % 58n)] + text;
    value /= 58n;
  }
  return text;
}

/** Writes a file and returns the message the loader refused it with. */
function refusalFor(name: string, content: string): string {
  const file = join(folder, name);
  writeFileSync(file, content, "utf8");
  try {
    readKeypairFile(file);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`${name} was read as a keypair`);
}

/** True when any eight characters in a row of the file turn up in the message. */
function leaks(content: string, message: string): boolean {
  for (let start = 0; start + 8 <= content.length; start += 1) {
    if (message.includes(content.slice(start, start + 8))) {
      return true;
    }
  }
  return false;
}

describe("the paying key file", () => {
  const key = Keypair.generate();
  const numbers = JSON.stringify(Array.from(key.secretKey));

  it("reads the shape solana-keygen writes", () => {
    const file = join(folder, "good.json");
    writeFileSync(file, numbers, "utf8");
    expect(readKeypairFile(file).publicKey.equals(key.publicKey)).toBe(true);
  });

  it("never quotes a base58 secret back", () => {
    const content = base58(key.secretKey);
    const message = refusalFor("base58.json", content);
    expect(message).toContain("64 whole numbers");
    expect(leaks(content, message)).toBe(false);
  });

  it("never quotes the numbers around a trailing comma back", () => {
    const content = numbers.replace(/\]$/, ",]");
    const message = refusalFor("comma.json", content);
    expect(message).toContain(join(folder, "comma.json"));
    expect(leaks(content, message)).toBe(false);
  });

  it("refuses the wrong count and bytes out of range with the same fixed sentence", () => {
    const short = JSON.stringify(Array.from(key.secretKey.subarray(1)));
    const wide = JSON.stringify(Array.from(key.secretKey, (byte) => byte + 256));
    for (const [name, content] of [
      ["short.json", short],
      ["wide.json", wide],
    ] as const) {
      const message = refusalFor(name, content);
      expect(message).toContain("64 whole numbers from 0 to 255");
      expect(leaks(content, message)).toBe(false);
    }
  });

  it("names a missing file and nothing else", () => {
    const file = join(folder, "missing.json");
    expect(() => readKeypairFile(file)).toThrow(/no keypair file/);
  });
});

describe("which chain answered", () => {
  const node = (genesis: string): Connection =>
    ({
      rpcEndpoint: "https://keyed-node.invalid/?api-key=never-print-me",
      getGenesisHash: async () => genesis,
    }) as unknown as Connection;

  it("keeps every write command on devnet: a mainnet node is refused", async () => {
    await expect(requireDevnet(node(MAINNET_GENESIS))).rejects.toThrow(/only run on devnet/);
    await expect(requireDevnet(node(DEVNET_GENESIS))).resolves.toBeUndefined();
  });

  it("lets status read mainnet only from a node whose genesis is mainnet's", async () => {
    await expect(requireMainnet(node(DEVNET_GENESIS))).rejects.toThrow(/is not mainnet/);
    await expect(requireMainnet(node(MAINNET_GENESIS))).resolves.toBeUndefined();
  });

  it("never quotes a keyed node's address in a refusal", async () => {
    for (const check of [requireDevnet(node(MAINNET_GENESIS)), requireMainnet(node(DEVNET_GENESIS))]) {
      const message = await check.then(
        () => "",
        (error: Error) => error.message
      );
      expect(message).not.toContain("never-print-me");
      expect(message).not.toContain("keyed-node.invalid");
    }
  });
});

describe("naming a node", () => {
  it("prints the public address as it is and names anything else", () => {
    const publicUrl = "https://api.mainnet-beta.solana.com";
    expect(nodeName(publicUrl, publicUrl, "the keyed mainnet node from .env")).toBe(publicUrl);
    expect(
      nodeName("https://keyed-node.invalid/?api-key=abc", publicUrl, "the keyed mainnet node from .env")
    ).toBe("the keyed mainnet node from .env");
  });

  it("cuts the keyed mainnet address and its host out of an error message", () => {
    process.env.MAINNET_RPC_URL = "https://keyed-node.invalid/?api-key=never-print-me";
    const said = scrubNodes(
      "request to https://keyed-node.invalid/?api-key=never-print-me failed: keyed-node.invalid did not answer"
    );
    expect(said).not.toContain("never-print-me");
    expect(said).not.toContain("keyed-node.invalid");
    expect(said).toContain("the keyed mainnet node from .env");
  });
});
