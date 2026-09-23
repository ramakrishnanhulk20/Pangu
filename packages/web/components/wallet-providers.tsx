"use client";

import "@/lib/buffer-shim";

import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { CHAIN, GENESIS_HASH, REHEARSAL, WALLET_NETWORK, browserRpcUrl } from "@/lib/network";

export function WalletProviders({ children }: { children: ReactNode }) {
  // Phantom and Solflare are listed by hand so their entry shows even before
  // the extension announces itself. Backpack ships no adapter package: it
  // registers through the Wallet Standard and the provider picks it up on its
  // own, which is why there is no third entry here.
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({
        network: WALLET_NETWORK === "mainnet-beta" ? WalletAdapterNetwork.Mainnet : WalletAdapterNetwork.Devnet,
      }),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={browserRpcUrl()}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
          <NetworkStrip />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

type Verdict = "right" | "rehearsal" | "wrong";

/**
 * Asks the endpoint this browser signs against for its genesis hash, once per
 * load. The server checks its own endpoint the same way before every read.
 */
function useVerdict(): Verdict | null {
  const [verdict, setVerdict] = useState<Verdict | null>(REHEARSAL ? "rehearsal" : null);
  useEffect(() => {
    if (REHEARSAL) {
      return;
    }
    let alive = true;
    fetch(browserRpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }),
    })
      .then((answer) => answer.json())
      .then((body: { result?: unknown }) => {
        if (alive && typeof body.result === "string") {
          setVerdict(body.result === GENESIS_HASH ? "right" : "wrong");
        }
      })
      .catch(() => {
        // An endpoint that does not answer is not judged; the pages already
        // say when a read did not come back.
      });
    return () => {
      alive = false;
    };
  }, []);
  return verdict;
}

/**
 * A line held at the foot of every page when the chain behind the site is not
 * the one it was built for: a rehearsal on a local copy of mainnet, or an
 * endpoint on another network altogether. On the right network it is not drawn.
 */
function NetworkStrip() {
  const verdict = useVerdict();
  const still = useReducedMotion() === true;
  const shown = verdict === "rehearsal" || verdict === "wrong";
  const wrong = verdict === "wrong";

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={verdict}
          data-testid="network-strip"
          data-verdict={verdict}
          role="status"
          title={wrong ? `Built for ${CHAIN.label}, but the endpoint answers as another chain.` : `A local copy of ${CHAIN.label}; none of it is real money.`}
          initial={still ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={still ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={still ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className={`group fixed bottom-4 left-4 z-[60] max-w-[min(34rem,calc(100vw-2rem))] rounded-lg border bg-paper/85 px-3 py-2 sm:px-4 sm:py-3 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.6)] backdrop-blur-md transition-colors duration-200 sm:bottom-6 sm:left-6 ${
            wrong ? "border-refused/70 hover:border-refused" : "border-accent/60 hover:border-accent"
          }`}
        >
          <p
            className={`flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.2em] ${
              wrong ? "text-refused" : "text-accent"
            }`}
          >
            <span className="relative flex h-2 w-2" aria-hidden="true">
              {!still && (
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${
                    wrong ? "bg-refused" : "bg-accent"
                  }`}
                />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${wrong ? "bg-refused" : "bg-accent"}`} />
            </span>
            {wrong ? "wrong network" : "rehearsal"}
          </p>
          {/* On a phone the strip keeps to its one label, so it never covers a form field. */}
          <p className="mt-1.5 hidden text-[13px] leading-snug text-muted transition-colors group-hover:text-ink sm:block">
            {wrong
              ? `This site is built for ${CHAIN.label}, but its endpoint answers as another chain, so nothing here can be trusted until the site's settings name the right one.`
              : `A local copy of ${CHAIN.label} on this machine. Every sale, balance and transaction here lives only on that copy; none of it is real money.`}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
