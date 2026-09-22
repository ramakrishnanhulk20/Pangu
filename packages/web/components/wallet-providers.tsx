"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { useMemo, type ReactNode } from "react";

import { devnetRpcUrl } from "@/lib/solana";

export function WalletProviders({ children }: { children: ReactNode }) {
  // Phantom and Solflare are listed by hand so their entry shows even before
  // the extension announces itself. Backpack ships no adapter package: it
  // registers through the Wallet Standard and the provider picks it up on its
  // own, which is why there is no third entry here.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={devnetRpcUrl()}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
