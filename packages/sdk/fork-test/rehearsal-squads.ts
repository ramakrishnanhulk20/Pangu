// The upgrade authority plan, rehearsed on the fork against Squads v4's real
// mainnet program: a two of three multisig is made from throwaway keys, the
// Pangu program's upgrade authority is handed to its vault, and one upgrade is
// carried out through a proposal.
//
//   tsx fork-test/rehearsal-squads.ts create
//       makes the multisig and prints "VAULT <address>" for the shell to hand
//       the upgrade authority to with `solana program set-upgrade-authority`
//   tsx fork-test/rehearsal-squads.ts upgrade <buffer address>
//       proposes the upgrade from that buffer, shows one approval is not enough
//       to carry it out, approves it a second time and carries it out
//
// Covers: multisig creation, the vault as upgrade authority, the threshold
// holding, and an executed upgrade. Does NOT cover: the time lock, a config
// authority, or the Squads web app, which is what the team would use on mainnet.
// @sqds/multisig is installed next to this package only for the rehearsal run,
// by scripts/wsl/mainnet-rehearsal.sh, so the published SDK never depends on it.

import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { PANGU_PROGRAM_ID } from "../src/index.js";
import { REHEARSAL_DIR, airdrop, connection, loadWallet, step } from "./rehearsal-setup.js";

const SQUADS_DIR = join(REHEARSAL_DIR, "squads");
const STATE_FILE = join(SQUADS_DIR, "squads.json");
const MEMBERS = ["member-1", "member-2", "member-3"];
const THRESHOLD = 2;

const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
/** UpgradeableLoaderInstruction::Upgrade, the loader's fourth instruction. */
const UPGRADE_INSTRUCTION = 3;

interface SquadsState {
  multisig: string;
  vault: string;
}

async function confirmed(signature: string): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const result = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  if (result.value.err !== null) {
    throw new Error(`${signature} failed: ${JSON.stringify(result.value.err)}`);
  }
  return signature;
}

function members(): Keypair[] {
  return MEMBERS.map((name) => loadWallet(SQUADS_DIR, name));
}

async function create(): Promise<void> {
  mkdirSync(SQUADS_DIR, { recursive: true });
  const keys = MEMBERS.map((name) => {
    const key = Keypair.generate();
    writeFileSync(join(SQUADS_DIR, `${name}.json`), JSON.stringify(Array.from(key.secretKey)), {
      mode: 0o600,
    });
    return key;
  });
  for (const key of keys) {
    await airdrop(key.publicKey, 10);
  }
  const [creator] = keys as [Keypair, Keypair, Keypair];

  step("s1. a two of three Squads v4 multisig");
  const [programConfig] = multisig.getProgramConfigPda({});
  const config = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, programConfig);
  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const before = await connection.getBalance(creator.publicKey);
  await confirmed(
    await multisig.rpc.multisigCreateV2({
      connection,
      treasury: config.treasury,
      createKey,
      creator,
      multisigPda,
      configAuthority: null,
      threshold: THRESHOLD,
      members: keys.map((key) => ({
        key: key.publicKey,
        permissions: multisig.types.Permissions.all(),
      })),
      timeLock: 0,
      rentCollector: null,
    })
  );
  const spent = before - (await connection.getBalance(creator.publicKey));
  const account = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  assert.equal(account.threshold, THRESHOLD);
  assert.equal(account.members.length, MEMBERS.length);
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ multisig: multisigPda.toBase58(), vault: vault.toBase58() }, null, 2)
  );
  console.log(`   multisig ${multisigPda.toBase58()}, threshold ${account.threshold} of ${account.members.length}`);
  console.log(`   creation fee in the program config: ${config.multisigCreationFee.toString()} lamports`);
  console.log(`   the creator spent ${spent / 1e9} SOL, rent for the multisig account included`);
  console.log(`VAULT ${vault.toBase58()}`);
}

async function upgrade(bufferText: string): Promise<void> {
  const buffer = new PublicKey(bufferText);
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as SquadsState;
  const multisigPda = new PublicKey(state.multisig);
  const vault = new PublicKey(state.vault);
  const [first, second] = members() as [Keypair, Keypair, Keypair];
  const [programData] = PublicKey.findProgramAddressSync(
    [PANGU_PROGRAM_ID.toBuffer()],
    UPGRADEABLE_LOADER
  );

  step("s2. a proposal to upgrade Pangu from the buffer, signed by the vault");
  // The buffer's rent comes back to the spill account when the upgrade lands.
  const upgradeInstruction = new TransactionInstruction({
    programId: UPGRADEABLE_LOADER,
    keys: [
      { pubkey: programData, isSigner: false, isWritable: true },
      { pubkey: PANGU_PROGRAM_ID, isSigner: false, isWritable: true },
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: first.publicKey, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([UPGRADE_INSTRUCTION, 0, 0, 0]),
  });
  const account = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const transactionIndex = BigInt(account.transactionIndex.toString()) + 1n;
  const message = new TransactionMessage({
    payerKey: vault,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [upgradeInstruction],
  });
  await confirmed(
    await multisig.rpc.vaultTransactionCreate({
      connection,
      feePayer: first,
      multisigPda,
      transactionIndex,
      creator: first.publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: message,
    })
  );
  await confirmed(
    await multisig.rpc.proposalCreate({
      connection,
      feePayer: first,
      multisigPda,
      transactionIndex,
      creator: first,
    })
  );
  await confirmed(
    await multisig.rpc.proposalApprove({
      connection,
      feePayer: first,
      multisigPda,
      transactionIndex,
      member: first,
    })
  );
  console.log(`   proposal ${transactionIndex} created and approved by one member`);

  step("s3. one approval of two cannot carry it out");
  let refused = "";
  try {
    await confirmed(
      await multisig.rpc.vaultTransactionExecute({
        connection,
        feePayer: first,
        multisigPda,
        transactionIndex,
        member: first.publicKey,
      })
    );
  } catch (error) {
    const logs = (error as { logs?: string[] }).logs ?? [];
    refused = logs.find((line) => line.includes("Error Message")) ?? String(error).split("\n")[0]!;
  }
  assert.ok(refused.length > 0, "the upgrade went through on one approval");
  console.log(`   refused: ${refused.replace(/^Program log: /, "").slice(0, 160)}`);

  step("s4. the second approval, and the upgrade carried out through the vault");
  await confirmed(
    await multisig.rpc.proposalApprove({
      connection,
      feePayer: second,
      multisigPda,
      transactionIndex,
      member: second,
    })
  );
  const before = await connection.getAccountInfo(programData);
  const slotBefore = before!.data.readBigUInt64LE(4);
  await confirmed(
    await multisig.rpc.vaultTransactionExecute({
      connection,
      feePayer: second,
      multisigPda,
      transactionIndex,
      member: second.publicKey,
    })
  );
  const [proposalPda] = multisig.getProposalPda({ multisigPda, transactionIndex });
  const proposal = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
  assert.ok(multisig.types.isProposalStatusExecuted(proposal.status), "the proposal is not executed");
  const after = await connection.getAccountInfo(programData);
  const slotAfter = after!.data.readBigUInt64LE(4);
  assert.ok(slotAfter > slotBefore, "the program was not redeployed");
  // The upgrade authority sits behind a one byte option tag at offset 12.
  assert.equal(after!.data[12], 1, "the program lost its upgrade authority");
  assert.ok(
    new PublicKey(after!.data.subarray(13, 45)).equals(vault),
    "the upgrade authority is no longer the vault"
  );
  assert.equal(await connection.getAccountInfo(buffer), null, "the buffer was not consumed");
  console.log(`   deployed slot ${slotBefore} to ${slotAfter}, the upgrade authority is still the vault`);
  console.log("SQUADS-UPGRADE-OK");
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  if (command === "create") {
    await create();
    return;
  }
  if (command === "upgrade" && argument !== undefined) {
    await upgrade(argument);
    return;
  }
  throw new Error("usage: rehearsal-squads.ts create | upgrade <buffer address>");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
