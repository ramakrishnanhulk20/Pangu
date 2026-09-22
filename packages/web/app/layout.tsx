import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";

import { SiteNav } from "@/components/site-nav";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Pangu",
  description:
    "A fair first sale for stock tokens on Meteora's Dynamic Bonding Curve.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <Providers>
          <SiteNav />
          <main className="flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
