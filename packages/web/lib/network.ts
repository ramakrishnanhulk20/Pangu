import type { PublicKey } from "@solana/web3.js";
import { dollarMints } from "pangu-sdk";

import { AAPLX_FEED, APPLE_EXCHANGE_FEED } from "./feeds";

/**
 * Every fact that differs between Solana devnet and mainnet, in one place.
 *
 * NEXT_PUBLIC_PANGU_NETWORK picks the network when the app is built: "devnet"
 * (or unset) for the demo, "mainnet" for the product. Everything else in the app
 * asks this file which endpoint, which paying tokens, which explorer and which
 * words, so switching networks is that one setting and a rebuild.
 *
 * Browser safe: no key and no server-only import. The server's own endpoint is
 * resolved in lib/solana.ts, because it may carry a key.
 */

export type NetworkName = "devnet" | "mainnet";

function chosen(): NetworkName {
  // Written out in full so Next can put the value into the browser bundle.
  const asked = (process.env.NEXT_PUBLIC_PANGU_NETWORK ?? "").trim();
  if (asked === "" || asked === "devnet") {
    return "devnet";
  }
  if (asked === "mainnet") {
    return "mainnet";
  }
  // A typo such as "mainnet-beta" must not quietly build the devnet app.
  throw new Error(
    `NEXT_PUBLIC_PANGU_NETWORK is "${asked}". Set it to devnet or mainnet, or leave it out for devnet.`
  );
}

export const NETWORK: NetworkName = chosen();

/**
 * The unit an amount of a paying token is written in: "dollars" for a listed
 * dollar, "SOL", or a stock token's own symbol such as "AAPLx".
 */
export type Money = "dollars" | "SOL" | (string & {});

export type PayingKind = "dollar" | "sol" | "stock";

/** One choice for what buyers pay in, as the launch form offers it. */
export interface PayingToken {
  /** The form's value for this choice. The devnet ones keep the ids earlier launches saved. */
  id: string;
  kind: PayingKind;
  mint: string;
  /** What the choice says. */
  label: string;
  /** How a sentence names it: "the demo dollar", "USDC". */
  called: string;
  unit: Money;
  /** One sentence under the choice. */
  about: string;
  /** Checked against the mint on chain before anything is sent. */
  decimals: number;
  /**
   * The sale token's decimals when buyers pay in this. Nine on a dollar sale
   * leaves Meteora's builder room for a three figure share price, as every
   * banded devnet sale was launched; six is the terminal launch's default and
   * what its SOL sales and the stock-token fork test used.
   */
  saleDecimals: number;
  /**
   * DBC's token badge for this mint. Meteora only takes a stock token as a
   * paying token when its badge exists, and the pool instruction has to name
   * it. Null for a token that needs none.
   */
  badge: string | null;
}

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

/** The demo dollar, minted for devnet by packages/scripts/src/mint-dollars.ts. Every banded demo sale is paid in it. */
export const DEMO_DOLLAR_MINT = "2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5";

const STOCK_ABOUT = (symbol: string, company: string) =>
  `${company}'s tokenized share, ${symbol}. Each share of this sale is priced in ${symbol}, and a sale paid in a stock token cannot carry a price ceiling, since the ceiling is a dollar price.`;

/**
 * Backed's xStocks, each read off mainnet on 23 Sep 2026: a Token-2022 mint with
 * 8 decimals, and a DBC badge at the address Meteora derives from the mint. The
 * launch page still reads every badge before it offers the stock, and leaves out
 * any whose badge is gone.
 */
const STOCKS: PayingToken[] = [
  {
    id: "aaplx",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    badge: "8VeVZe3Zxfpax2qQUp7i68FCLspLYErm2FJChc5NDuVn",
    symbol: "AAPLx",
    company: "Apple",
  },
  {
    id: "tslax",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    badge: "XhM8atXDua58KZnZFLu5vJjzaNWjXaEvpPPEVnHn1ax",
    symbol: "TSLAx",
    company: "Tesla",
  },
  {
    id: "nvdax",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    badge: "mfacWnGh1Kn5ttHMMaNZhRZbCjvGrDQyDyZgqaR9vBM",
    symbol: "NVDAx",
    company: "NVIDIA",
  },
  {
    id: "spyx",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    badge: "D2THzeQLHaDeKBzzmTNuWEWw23WPM8vVhLvUmSPEpNeL",
    symbol: "SPYx",
    company: "The S&P 500",
  },
].map(({ id, mint, badge, symbol, company }): PayingToken => ({
  id,
  kind: "stock",
  mint,
  label: symbol,
  called: symbol,
  unit: symbol,
  about: STOCK_ABOUT(symbol, company),
  decimals: 8,
  saleDecimals: 6,
  badge,
}));

interface Facts {
  /** The network in a heading or a description: "Solana devnet" or "Solana". */
  label: string;
  /** The network in one word, beside an address: "devnet" or "mainnet". */
  short: string;
  /** The chain inside a sentence: "reading devnet", "reading Solana". */
  inSentence: string;
  /** The same at the start of a sentence. */
  atStart: string;
  /** SOL as a visitor holds it on this network. */
  sol: string;
  /** The wallet a visitor is asked to connect, with its article. */
  wallet: string;
  /** Used when neither endpoint variable is set. */
  publicRpc: string;
  /** The explorer's query for this cluster. Mainnet is the explorer's default and needs none. */
  explorerCluster: string;
  /** The first block's hash, which names a Solana cluster for good. */
  genesisHash: string;
  /** The wallet adapter's own name for the network, as Solflare's adapter takes it. */
  walletNetwork: "devnet" | "mainnet-beta";
  /** Irys: where a launch stores its logo and description, and how long they are kept. */
  irys: { node: string; gateway: string; kept: string; words: string };
  /** Offered at launch, in this order. The first is the form's default. */
  payingTokens: PayingToken[];
  /** True when the demo dollar button and its route exist. Devnet only. */
  demoDollars: boolean;
  /** True when a visitor can ask the network for free SOL. Devnet only. */
  faucet: boolean;
  /**
   * True when the attack ledger may send a row for real. On mainnet it only
   * simulates: a refusal sent on purpose costs real money there.
   */
  ledgerSends: boolean;
}

const FACTS: Record<NetworkName, Facts> = {
  devnet: {
    label: "Solana devnet",
    short: "devnet",
    inSentence: "devnet",
    atStart: "Devnet",
    sol: "devnet SOL",
    wallet: "a devnet wallet",
    publicRpc: "https://api.devnet.solana.com",
    explorerCluster: "?cluster=devnet",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    walletNetwork: "devnet",
    irys: {
      node: "https://devnet.irys.xyz",
      gateway: "https://devnet.irys.xyz",
      kept: "about 60 days",
      words:
        "Stored through Irys, paid from your wallet. On devnet Irys keeps the files for about 60 days; the same launch on mainnet stores them on Arweave for good.",
    },
    payingTokens: [
      {
        id: "dollar",
        kind: "dollar",
        mint: DEMO_DOLLAR_MINT,
        label: "Demo dollar",
        called: "the demo dollar",
        unit: "dollars",
        about:
          "The demo dollar: a devnet dollar token this site hands out for testing. A price ceiling needs buyers paying in dollars.",
        decimals: 6,
        saleDecimals: 9,
        badge: null,
      },
      {
        id: "sol",
        kind: "sol",
        mint: WRAPPED_SOL,
        label: "Devnet SOL",
        called: "SOL",
        unit: "SOL",
        about: "Devnet SOL, free from the faucet. A sale paid in SOL cannot carry a price ceiling.",
        decimals: 9,
        saleDecimals: 6,
        badge: null,
      },
    ],
    demoDollars: true,
    faucet: true,
    ledgerSends: true,
  },
  mainnet: {
    label: "Solana",
    short: "mainnet",
    inSentence: "Solana",
    atStart: "Solana",
    sol: "SOL",
    wallet: "a wallet",
    publicRpc: "https://api.mainnet-beta.solana.com",
    explorerCluster: "",
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    walletNetwork: "mainnet-beta",
    irys: {
      node: "https://uploader.irys.xyz",
      gateway: "https://gateway.irys.xyz",
      kept: "for good",
      words: "Stored on Arweave through Irys, paid from your wallet, and kept for good.",
    },
    payingTokens: [
      {
        id: "usdc",
        kind: "dollar",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        label: "USDC",
        called: "USDC",
        unit: "dollars",
        about: "Circle's USDC. A price ceiling needs buyers paying in dollars, and USDC is the dollar the program lists on mainnet.",
        decimals: 6,
        saleDecimals: 9,
        badge: null,
      },
      ...STOCKS,
    ],
    demoDollars: false,
    faucet: false,
    ledgerSends: false,
  },
};

const facts = FACTS[NETWORK];

/** The words the pages put the network in. */
export const CHAIN = {
  name: NETWORK,
  label: facts.label,
  short: facts.short,
  inSentence: facts.inSentence,
  atStart: facts.atStart,
  sol: facts.sol,
  wallet: facts.wallet,
} as const;

export const GENESIS_HASH = facts.genesisHash;
export const WALLET_NETWORK = facts.walletNetwork;
export const IRYS = facts.irys;
export const PAYING_TOKENS: readonly PayingToken[] = facts.payingTokens;
export const DEMO_DOLLARS_ON = facts.demoDollars;
export const FAUCET_ON = facts.faucet;
export const LEDGER_SENDS = facts.ledgerSends;

/** The Pyth feeds a ceiling can follow. The ids are the same on every network. */
export const FEEDS: readonly string[] = [APPLE_EXCHANGE_FEED, AAPLX_FEED];

/**
 * The dollar tokens the program on this network lets a price ceiling be set on,
 * straight from the SDK's copy of the program's own list.
 */
export const DOLLAR_MINTS: readonly string[] = dollarMints(NETWORK).map((mint) => mint.toBase58());

export function isListedDollar(mint: string | null | undefined): boolean {
  return mint !== null && mint !== undefined && DOLLAR_MINTS.includes(mint);
}

export function payingToken(id: string): PayingToken | null {
  return PAYING_TOKENS.find((token) => token.id === id) ?? null;
}

/**
 * The unit amounts of this paying token are written in. A mint this network's
 * list does not know is never called dollars: its amounts are the token's own.
 */
export function payingUnit(mint: string | null | undefined): Money {
  if (mint === WRAPPED_SOL) {
    return "SOL";
  }
  if (isListedDollar(mint)) {
    return "dollars";
  }
  return PAYING_TOKENS.find((token) => token.mint === mint)?.unit ?? "tokens";
}

function configured(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== "" ? value.trim() : null;
}

/**
 * The endpoint a browser talks to: the wallet connection and anything else that
 * runs on the visitor's machine. Every NEXT_PUBLIC_ value is written into the
 * bundle anyone can download, so this is either the public endpoint or a key
 * the provider restricts to this site's origin.
 */
export function browserRpcUrl(): string {
  // Each variable is written out in full so Next can inline it in the bundle.
  const set =
    NETWORK === "mainnet"
      ? configured(process.env.NEXT_PUBLIC_MAINNET_RPC_URL)
      : configured(process.env.NEXT_PUBLIC_DEVNET_RPC_URL);
  return set ?? facts.publicRpc;
}

/** True for the network's own public endpoint, which rate limits a burst of reads. */
export function isPublicEndpoint(url: string): boolean {
  try {
    return new URL(url).hostname === new URL(facts.publicRpc).hostname;
  } catch {
    return false;
  }
}

/**
 * True for an endpoint on this machine: the local copy of mainnet a rehearsal
 * runs against. Such a chain is never the real one, whatever its genesis says.
 */
export function isLocalEndpoint(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

/** True when the browser's endpoint is a local rehearsal chain rather than the network itself. */
export const REHEARSAL = isLocalEndpoint(browserRpcUrl());

/**
 * The explorer's query for this network. A rehearsal's transactions exist only
 * on the local chain, so its links point the explorer there; a local address
 * carries no key, so it is safe to put in a link.
 */
function clusterQuery(): string {
  return REHEARSAL
    ? `?cluster=custom&customUrl=${encodeURIComponent(browserRpcUrl())}`
    : facts.explorerCluster;
}

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${clusterQuery()}`;
}

/**
 * A transaction on a named network, whichever one this app was built for. The
 * proof section cites a run on devnet, and that link has to keep pointing there.
 */
export function explorerTxOn(network: NetworkName, signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${FACTS[network].explorerCluster}`;
}

export function explorerAddress(address: PublicKey | string): string {
  const text = typeof address === "string" ? address : address.toBase58();
  return `https://explorer.solana.com/address/${text}${clusterQuery()}`;
}
