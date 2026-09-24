/**
 * Holds the launch's check on what a wallet handed back after signing,
 * walletChangeRefusal in lib/launch.ts, against hand-built transactions, and
 * exits non-zero on the first answer that is wrong.
 *
 *   node lab-evidence/review-fixes-signing.mjs
 *
 * The page builds a transaction, the wallet signs it and may add instructions,
 * and only then does the launch's new mint account sign the message the
 * wallet returned. The cases: the transaction unchanged; a compute budget
 * instruction added; a Lighthouse instruction added in the middle; an unknown
 * program's instruction added; one of the page's instructions changed by a
 * byte; one dropped; the fee payer swapped; and an account the page reads
 * coming back writable because the wallet's own instruction writes it. Each
 * case also goes through the real order: wallet signature first over the
 * returned message, then the mint's, and the result must verify.
 *
 * Reads nothing from any network and sends nothing. lib/launch.ts is loaded
 * through jiti so its TypeScript and its "@/" imports resolve.
 */

import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": web } });
const { walletChangeRefusal, LIGHTHOUSE_PROGRAM_ID } = await jiti.import("../lib/launch.ts");

const wallet = Keypair.generate();
const mint = Keypair.generate();
const stranger = Keypair.generate();
const someProgram = new PublicKey("4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG");
const unknownProgram = Keypair.generate().publicKey;
const readOnly = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();

/** The page's own instructions: a compute limit, an account for the mint, and a program call that reads one account. */
function pageInstructions() {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: 1_461_600,
      space: 82,
      programId: someProgram,
    }),
    new TransactionInstruction({
      programId: someProgram,
      keys: [
        { pubkey: mint.publicKey, isSigner: true, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: readOnly, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([7, 1, 2, 3, 4, 5]),
    }),
  ];
}

/** An instruction shaped like a Lighthouse assertion: its program, an account it reads, and some bytes. */
function lighthouseLike(account, writable = false) {
  return new TransactionInstruction({
    programId: LIGHTHOUSE_PROGRAM_ID,
    keys: [{ pubkey: account, isSigner: false, isWritable: writable }],
    data: Buffer.from([2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]),
  });
}

/**
 * What a wallet hands back: the page's transaction, rewritten by `change`,
 * serialized and read again as the wallet adapter does, and signed by the
 * wallet alone.
 */
function walletReturns(change, payer = wallet.publicKey) {
  const rewritten = new Transaction({ feePayer: payer, recentBlockhash: blockhash });
  rewritten.add(...change(pageInstructions()));
  const bytes = rewritten.serialize({ requireAllSignatures: false, verifySignatures: false });
  const back = Transaction.from(bytes);
  if (payer.equals(wallet.publicKey)) {
    back.partialSign(wallet);
  }
  return back;
}

let failed = 0;
let passed = 0;

function check(label, change, wanted, payer) {
  const back = walletReturns(change, payer);
  const refusal = walletChangeRefusal(pageInstructions(), back, wallet.publicKey);
  let verdict = refusal === null ? "accepted" : "refused";
  let detail = refusal ?? "";
  if (refusal === null) {
    back.partialSign(mint);
    const verified = back.verifySignatures();
    detail = verified ? "wallet then mint signatures verify over the returned message" : "signatures do NOT verify";
    if (!verified) {
      verdict = "broken";
    }
  }
  const ok = verdict === wanted;
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
  }
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}: ${verdict} (wanted ${wanted}). ${detail}`);
}

check("unchanged", (built) => built, "accepted");
check(
  "a compute unit price added in front",
  (built) => [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }), ...built],
  "accepted"
);
check(
  "a Lighthouse assertion added between the page's instructions",
  (built) => [built[0], built[1], lighthouseLike(wallet.publicKey), built[2]],
  "accepted"
);
check(
  "a Lighthouse assertion added at the end",
  (built) => [...built, lighthouseLike(mint.publicKey)],
  "accepted"
);
check(
  "a Lighthouse instruction that writes an account the page only reads",
  (built) => [...built, lighthouseLike(readOnly, true)],
  "accepted"
);
check(
  "an unknown program's instruction added",
  (built) => [
    ...built,
    new TransactionInstruction({ programId: unknownProgram, keys: [], data: Buffer.from([1]) }),
  ],
  "refused"
);
check(
  "a transfer out of the wallet added",
  (built) => [
    ...built,
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: stranger.publicKey, lamports: 1_000_000 }),
  ],
  "refused"
);
check(
  "one byte of the page's program call changed",
  (built) => {
    const changed = new TransactionInstruction({ ...built[2], data: Buffer.from([7, 1, 2, 3, 4, 6]) });
    return [built[0], built[1], changed];
  },
  "refused"
);
check(
  "the page's compute limit changed",
  (built) => [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), built[1], built[2]],
  "refused"
);
check("one of the page's instructions dropped", (built) => [built[0], built[2]], "refused");
check("two of the page's instructions swapped", (built) => [built[0], built[2], built[1]], "refused");
check("the fee payer swapped", (built) => built, "refused", stranger.publicKey);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
