"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import { CurveMark } from "./hero/curve-mark";
import { ThemeToggle } from "./theme-toggle";

// The wallet button reads the browser's injected wallets, so rendering it on
// the server would only produce markup the client immediately replaces.
const WalletButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  { ssr: false, loading: () => <span className="h-9 w-[132px] rounded-lg bg-raised" /> }
);

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-medium tracking-tight transition-opacity hover:opacity-60"
        >
          <CurveMark className="h-5 w-5" />
          Pangu
        </Link>
        <Link
          href="/docs"
          className="text-sm text-muted transition-colors hover:text-ink"
        >
          Docs
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <WalletButton />
        </div>
      </nav>
    </header>
  );
}
