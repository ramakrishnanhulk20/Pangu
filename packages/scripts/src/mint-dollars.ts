/**
 * Mints the dollar token a devnet demo is priced in, and hands the whole supply
 * to the paying key.
 *
 *   npx tsx src/mint-dollars.ts
 *   npx tsx src/mint-dollars.ts --supply 1000000000000 --decimals 6
 *
 * Devnet has no dollar anybody can get in quantity, and a sale whose ceiling is
 * a dollar price can only be shown with a paying token that is one. This makes
 * that token: six decimals like every real dollar token on Solana, no freeze
 * authority, and the mint authority kept by the paying key so a demo can top a
 * wallet up. It is a demo token on devnet and nothing else.
 *
 * It prints the mint address. Put that address behind `launch --quote`.
 */

import { Keypair } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { amount, readFlags, wholeNumber } from "./arguments.js";
import { addressLink, devnet, payerKeypair, requireDevnet, sol } from "./environment.js";

/** Whole tokens minted when the command is run with no flags. */
const DEFAULT_SUPPLY = 1_000_000_000_000;

async function main(): Promise<void> {
  const flags = readFlags(process.argv.slice(2), ["supply", "decimals"]);
  const supply = amount(flags, "supply", 1, 1e16, DEFAULT_SUPPLY);
  const decimals = wholeNumber(flags, "decimals", 6, 9, 6);

  const connection = devnet();
  await requireDevnet(connection);
  const payer: Keypair = payerKeypair();
  const started = await connection.getBalance(payer.publicKey, "confirmed");

  // No freeze authority: a paying token whose issuer can freeze an account
  // could strand a buyer mid sale, and nothing in this demo needs it.
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    decimals,
    undefined,
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );

  const account = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );

  const raw = BigInt(Math.round(supply * 100)) * 10n ** BigInt(decimals) / 100n;
  const signature = await mintTo(
    connection,
    payer,
    mint,
    account.address,
    payer,
    raw,
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );

  console.log(`mint     : ${mint.toBase58()}`);
  console.log(`           ${addressLink(mint)}`);
  console.log(`decimals : ${decimals}`);
  console.log(`holder   : ${account.address.toBase58()}, owned by ${payer.publicKey.toBase58()}`);
  console.log(`minted   : ${supply} whole tokens, ${raw} raw units`);
  console.log(`signature: ${signature}`);
  console.log(
    `spent    : ${sol(started - (await connection.getBalance(payer.publicKey, "confirmed")))} SOL`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
