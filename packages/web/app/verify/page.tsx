import type { Metadata } from "next";

import { VerifyConsole, type CredentialSale } from "@/components/verify/verify-console";
import { openedSales } from "@/lib/sales";

export const metadata: Metadata = {
  title: "Verify buyers | Pangu",
  description:
    "Set up as a verifier on devnet, issue credentials to buyer wallets, revoke them, and check any wallet against any verifier.",
};

/**
 * The credential-mode sales the scripts opened. Only the mints go to the
 * browser; the verifier each sale checks is read off its rules on chain there.
 */
function credentialSales(): CredentialSale[] {
  return openedSales()
    .filter((sale) => sale.mode === "credential")
    .map((sale) => ({ symbol: sale.symbol, name: sale.name, mint: sale.mint, mode: sale.mode }));
}

export default function Verify() {
  return <VerifyConsole credentialSales={credentialSales()} />;
}
