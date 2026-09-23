"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import { CurveMark } from "./hero/curve-mark";
import { SiteNavMenu } from "./site-nav-menu";
import { ThemeToggle } from "./theme-toggle";

// The wallet button reads the browser's injected wallets, so rendering it on
// the server would only produce markup the client immediately replaces.
const WalletButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  { ssr: false, loading: () => <span className="h-9 w-[132px] rounded-lg bg-raised" /> }
);

const PAGES = [
  { href: "/sales", label: "Sales" },
  { href: "/launch", label: "Launch" },
  { href: "/verify", label: "Verify" },
  { href: "/docs", label: "Docs" },
] as const;

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="shrink-0 text-sm text-muted transition-colors hover:text-ink"
    >
      {label}
    </Link>
  );
}

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
        <div className="hidden items-center gap-5 md:flex">
          {PAGES.map((page) => (
            <NavLink key={page.href} {...page} />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <WalletButton />
          <SiteNavMenu pages={PAGES} />
        </div>
      </nav>
    </header>
  );
}
