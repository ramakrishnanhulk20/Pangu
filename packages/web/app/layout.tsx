import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";

import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

import { Providers } from "./providers";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
});

const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-sans",
});

const label = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono",
});

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
    <html
      lang="en"
      suppressHydrationWarning
      className={`h-full antialiased ${display.variable} ${body.variable} ${label.variable}`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>
          <SiteNav />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
