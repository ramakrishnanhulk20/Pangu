import { Buffer } from "buffer";
import type { AccountInfo, AccountMeta, Connection, PublicKey } from "@solana/web3.js";
import {
  createExecuteInstruction,
  getExtraAccountMetas,
  resolveExtraAccountMeta,
} from "@solana/spl-token";
import { AccountsType } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { extraAccountListAddress } from "../addresses.js";
import { PANGU_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "../constants.js";
import { PanguInputError } from "../inputs.js";

/**
 * A token account this transaction creates before the swap runs.
 *
 * Pangu derives a buyer's record from the owner field inside the receiving
 * token account, so resolving the hook's accounts means reading that account.
 * On a first buy it does not exist yet, and the chain cannot answer for it. The
 * owner is not a guess though: the same transaction creates the account, so the
 * bytes are filled in here from what is about to be written.
 */
export interface PendingTokenAccount {
  address: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
}

/** The first 64 bytes of a token account: the mint, then the owner. */
function tokenAccountBytes(mint: PublicKey, owner: PublicKey): Buffer {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  return data;
}

function chainPlusPending(
  connection: Connection,
  pending: PendingTokenAccount[]
): Connection {
  if (pending.length === 0) {
    return connection;
  }
  const known = new Map(
    pending.map((account) => [
      account.address.toBase58(),
      {
        data: tokenAccountBytes(account.mint, account.owner),
        owner: TOKEN_2022_PROGRAM_ID,
        executable: false,
        lamports: 0,
        rentEpoch: 0,
      } as AccountInfo<Buffer>,
    ])
  );
  const reader = {
    getAccountInfo: async (address: PublicKey) =>
      known.get(address.toBase58()) ?? (await connection.getAccountInfo(address)),
  };
  // The resolver only ever calls getAccountInfo. Handing it this reader is what
  // lets a first buy resolve the record of an account the transaction is still
  // about to open.
  return reader as unknown as Connection;
}

export interface HookAccountsInput {
  connection: Connection;
  mint: PublicKey;
  /** The token account the sale token leaves. */
  source: PublicKey;
  /** The token account the sale token lands in. */
  destination: PublicKey;
  /** Whoever signs for the source account. */
  authority: PublicKey;
  amount: bigint;
  pending?: PendingTokenAccount[];
}

/**
 * The accounts Pangu's hook has to be called with, read from the list the
 * program itself published on chain.
 *
 * Nothing here is a copy of what the program writes. The list is fetched, each
 * entry is resolved against the real token accounts of this transfer, and the
 * caller gets whatever that sale needs: a plain sale's four, a credential
 * sale's seven, a banded sale's eleven. The Meteora SDK's own helper cannot do
 * this because it resolves against placeholder accounts, and a record derived
 * from the receiver's owner has nothing to read there. See finding 1 in
 * docs/measurements/fork-test.md.
 *
 * Order matters and is the one Token-2022 rebuilds on chain: the published list
 * itself, then its entries, then the hook program.
 *
 * Throws PanguInputError when the mint has no published list, which means it is
 * not a Pangu sale.
 */
export async function hookAccounts(
  input: HookAccountsInput
): Promise<AccountMeta[]> {
  const validation = extraAccountListAddress(input.mint);
  const listAccount = await input.connection.getAccountInfo(validation);
  if (listAccount === null) {
    throw new PanguInputError(
      `${input.mint.toBase58()} has no published Pangu account list, so it is not a running Pangu sale`
    );
  }

  const execute = createExecuteInstruction(
    PANGU_PROGRAM_ID,
    input.source,
    input.mint,
    input.destination,
    input.authority,
    validation,
    input.amount
  );
  const reader = chainPlusPending(input.connection, input.pending ?? []);

  for (const meta of getExtraAccountMetas(listAccount)) {
    execute.keys.push(
      await resolveExtraAccountMeta(
        reader,
        meta,
        execute.keys,
        execute.data,
        PANGU_PROGRAM_ID
      )
    );
  }

  return [
    { pubkey: validation, isSigner: false, isWritable: false },
    ...execute.keys.slice(5),
    { pubkey: PANGU_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
}

/** DBC has to be told how many of the remaining accounts belong to the hook. */
export function hookAccountsInfo(accounts: AccountMeta[]) {
  return {
    slices: [
      { accountsType: AccountsType.TransferHookBase, length: accounts.length },
    ],
  };
}
