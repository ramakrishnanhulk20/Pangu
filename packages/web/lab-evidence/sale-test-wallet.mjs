/**
 * A Wallet Standard wallet for Playwright whose keys never enter the page.
 *
 * The page sees an ordinary injected wallet named "Pangu Test Wallet". Its
 * signTransaction hands the transaction bytes to Node through
 * page.exposeFunction, Node signs with the keypair it holds, and only the
 * signed bytes go back. The secret key is never serialised, printed or passed
 * into the browser. The wallet adapter picks it up like any Wallet Standard
 * wallet, and connects on its own because its name is put where the adapter
 * keeps the last wallet used.
 *
 * Used by sale-devnet.mjs. The launch order builds its own driver of the same
 * shape at test-wallet.mjs; this one is kept apart so two cooks never edit one
 * file.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { VersionedTransaction } = require("@solana/web3.js");

export const TEST_WALLET_NAME = "Pangu Test Wallet";

// A small square in the accent colour. The adapter wants a data URI.
const ICON =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#c8f135"/></svg>'
  ).toString("base64");

/**
 * Installs the wallet into every page of this context, signing as `keypair`.
 * Returns the list the signatures are recorded in, one entry per signing.
 */
export async function installTestWallet(context, keypair) {
  const signed = [];

  await context.exposeFunction("__panguTestWalletSign", async (base64) => {
    const transaction = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    // sign keeps every signature already on it, such as the position keys a
    // migration carries, and fills in this wallet's own slot.
    transaction.sign([keypair]);
    signed.push(Buffer.from(transaction.signatures[0]).toString("hex").slice(0, 16));
    return Buffer.from(transaction.serialize()).toString("base64");
  });

  await context.addInitScript(
    ({ address, publicKey, name, icon }) => {
      window.localStorage.setItem("walletName", JSON.stringify(name));

      const toBase64 = (bytes) => {
        let text = "";
        for (const byte of bytes) text += String.fromCharCode(byte);
        return btoa(text);
      };
      const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

      const account = Object.freeze({
        address,
        publicKey: Uint8Array.from(publicKey),
        chains: ["solana:devnet"],
        features: ["solana:signTransaction"],
      });

      const wallet = {
        version: "1.0.0",
        name,
        icon,
        chains: ["solana:devnet"],
        accounts: [account],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => ({ accounts: [account] }),
          },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: async (...inputs) => {
              const outputs = [];
              for (const input of inputs) {
                const back = await window.__panguTestWalletSign(toBase64(input.transaction));
                outputs.push({ signedTransaction: fromBase64(back) });
              }
              return outputs;
            },
          },
        },
      };

      const register = ({ register: add }) => add(wallet);
      window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", { detail: register })
      );
    },
    {
      address: keypair.publicKey.toBase58(),
      publicKey: Array.from(keypair.publicKey.toBytes()),
      name: TEST_WALLET_NAME,
      icon: ICON,
    }
  );

  return signed;
}
