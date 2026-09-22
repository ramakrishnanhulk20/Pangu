"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { SmoothScroll } from "@/components/smooth-scroll";
import { WalletProviders } from "@/components/wallet-providers";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <WalletProviders>
        <SmoothScroll>{children}</SmoothScroll>
      </WalletProviders>
    </ThemeProvider>
  );
}
