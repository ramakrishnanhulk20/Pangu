/**
 * The awkward transactions `prove` needs: a buy with a piece taken out, a buy
 * redirected into another token account, and a call to the hook made on its
 * own.
 *
 * Every one of them starts from what pangu-sdk builds for an honest user and
 * changes exactly one thing, so an attack cannot quietly fail for some other
 * reason and be reported as a rule doing its job.
 */

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ExtensionType,
  addExtraAccountMetasForExecute,
  createExecuteInstruction,
  createInitializeAccount3Instruction,
  createInitializeImmutableOwnerInstruction,
  getAccountLen,
  getAccountTypeOfMintType,
  getExtensionTypes,
  getMint,
} from "@solana/spl-token";
import {
  DBC_PROGRAM_ID,
  PANGU_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  extraAccountListAddress,
  openBuyerRecordInstruction,
} from "pangu-sdk";

/** A token account the attack opens for itself, and the instructions that open it. */
export interface NewTokenAccount {
  account: Keypair;
  instructions: TransactionInstruction[];
}

/**
 * A second Token-2022 account for a mint, owned by `owner`.
 *
 * `ownerIsFixed` decides whether it carries the ImmutableOwner extension. That
 * one difference is what C13 turns on: an account whose owner can still be
 * handed to somebody else is not somewhere a sale may send tokens.
 */
export async function newTokenAccount(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  ownerIsFixed: boolean
): Promise<NewTokenAccount> {
  const account = Keypair.generate();
  // A token account has to carry the account side of every extension its mint
  // has, or Token-2022 refuses to initialise it. A Pangu sale token has a
  // transfer hook, so its accounts carry the transferring flag that goes with
  // one. The extensions are read off the mint rather than listed here.
  const state = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const required = getExtensionTypes(state.tlvData).map(getAccountTypeOfMintType);
  const space = getAccountLen(
    ownerIsFixed ? [...required, ExtensionType.ImmutableOwner] : required
  );
  const instructions: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: owner,
      newAccountPubkey: account.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(space),
      space,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ];
  if (ownerIsFixed) {
    instructions.push(
      createInitializeImmutableOwnerInstruction(account.publicKey, TOKEN_2022_PROGRAM_ID)
    );
  }
  instructions.push(
    createInitializeAccount3Instruction(
      account.publicKey,
      mint,
      owner,
      TOKEN_2022_PROGRAM_ID
    )
  );
  return { account, instructions };
}

/**
 * Takes the buyer record opening out of a buy.
 *
 * pangu-sdk adds it when a wallet has never bought, because a transfer hook
 * cannot create accounts. Removing it is what a buyer would be left with if
 * they tried to buy before opening a record. The instruction is recognised by
 * rebuilding it with the same function that added it, so this can never strike
 * out something else by mistake.
 */
export function withoutRecordOpening(
  transaction: Transaction,
  wallet: PublicKey,
  mint: PublicKey
): Transaction {
  const opening = openBuyerRecordInstruction({ wallet, mint }).data;
  transaction.instructions = transaction.instructions.filter(
    (instruction) =>
      !(
        instruction.programId.equals(PANGU_PROGRAM_ID) &&
        Buffer.from(instruction.data).equals(Buffer.from(opening))
      )
  );
  return transaction;
}

/**
 * Points a built buy at another token account of the same wallet.
 *
 * Only the swap instruction is touched, and only where it names the account the
 * tokens land in. The hook's own accounts are rebuilt on chain from whatever
 * account really receives, so this is a genuine second account for the same
 * owner and not a doctored account list.
 *
 * Throws when the transaction does not carry exactly one Meteora swap, rather
 * than guessing which instruction to change.
 */
export function redirectBuy(
  transaction: Transaction,
  from: PublicKey,
  to: PublicKey
): Transaction {
  const swaps = transaction.instructions.filter((instruction) =>
    instruction.programId.equals(DBC_PROGRAM_ID)
  );
  const swap = swaps[0];
  if (swaps.length !== 1 || swap === undefined) {
    throw new Error(
      `expected one Meteora swap in this transaction, found ${swaps.length}`
    );
  }
  let moved = 0;
  for (const key of swap.keys) {
    if (key.pubkey.equals(from)) {
      key.pubkey = to;
      moved += 1;
    }
  }
  if (moved === 0) {
    throw new Error(`${from.toBase58()} is not the account this buy pays out to`);
  }
  return transaction;
}

/**
 * A call straight to the hook's `execute`, outside any transfer.
 *
 * This is the shape a caller would use to try to move a buyer's counters
 * without moving tokens. The extra accounts come from the list the program
 * published, resolved by the token library itself.
 *
 * Throws when the mint has no published account list, which means it is not a
 * running Pangu sale.
 */
export async function directExecute(
  connection: Connection,
  options: {
    mint: PublicKey;
    source: PublicKey;
    destination: PublicKey;
    authority: PublicKey;
    amount: bigint;
  }
): Promise<TransactionInstruction> {
  const list = extraAccountListAddress(options.mint);
  if ((await connection.getAccountInfo(list, "confirmed")) === null) {
    throw new Error(
      `${options.mint.toBase58()} has no published Pangu account list, so it is not a running sale`
    );
  }
  const instruction = createExecuteInstruction(
    PANGU_PROGRAM_ID,
    options.source,
    options.mint,
    options.destination,
    options.authority,
    list,
    options.amount
  );
  // The token library fills the accounts in behind it and returns nothing, so
  // the instruction that comes back is the one passed in.
  await addExtraAccountMetasForExecute(
    connection,
    instruction,
    PANGU_PROGRAM_ID,
    options.source,
    options.mint,
    options.destination,
    options.authority,
    options.amount,
    "confirmed"
  );
  return instruction;
}
