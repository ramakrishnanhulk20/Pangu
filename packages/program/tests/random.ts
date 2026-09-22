// Throws thousands of randomly chosen buys, sells, transfers, approvals and
// revocations at one sale, and checks the chain against a model of the rules after
// every single operation.
// Does NOT cover: the verifier-credential mode or the price band, which both need
// accounts from outside the program (see credential.ts and band.ts); transfers of
// zero; graduation; two sales at once; or the price a seller gets.

import { assert } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { BanksTransactionResultWithMeta } from "solana-bankrun";
import {
  ACCESS_ISSUER_LIST,
  ACCESS_OPEN,
  Env,
  approveBuyer,
  buy,
  buyerRecordPda,
  createAssociatedTokenAccount,
  createTokenAccount,
  fund,
  mintTokens,
  openBuyerRecord,
  readRules,
  revokeBuyer,
  sell,
  send,
  setupSale,
  simulateSell,
  transferTokens,
} from "./sale-fixture";

const WALLETS = 8;
const OPERATIONS = Number(process.env.PANGU_RANDOM_OPS ?? 600);
const SEEDS = (process.env.PANGU_RANDOM_SEEDS ?? "101,2027,30011,400009,5000011")
  .split(",")
  .map((value) => Number(value.trim()));
const EXIT_CHECKPOINTS = 25;
const VAULT_SUPPLY = 50_000_000n;
const U64_MAX = (1n << 64n) - 1n;
const VAULT = "vault";
const NOWHERE = "-";
const ACCOUNT_KINDS = ["ata", "second", "loose"];

/**
 * Tokens minted straight into three holders before the sequence starts.
 *
 * A wallet that only buys always holds exactly what its record says, so without
 * this the sell path's floor at zero would never be reached by a random sequence.
 * Tokens from a mint, an airdrop or a pre-sale are how a real holder ends up with
 * more than the sale ever sold them.
 */
const SEEDED_HOLDINGS: { label: string; amount: bigint }[] = [
  { label: "w0.ata", amount: 4_000n },
  { label: "w1.second", amount: 2_500n },
  { label: "w2.loose", amount: 3_000n },
];

const TOTAL_SUPPLY =
  VAULT_SUPPLY + SEEDED_HOLDINGS.reduce((sum, held) => sum + held.amount, 0n);

const OPERATION_WEIGHTS: [string, number][] = [
  ["buy.ata", 18],
  ["buy.second", 10],
  ["buy.loose", 6],
  ["sell", 22],
  ["transfer.wallets", 8],
  ["transfer.own", 6],
  ["approve", 8],
  ["revoke", 6],
  ["open", 8],
  ["direct", 4],
];
const OPERATION_TOTAL = OPERATION_WEIGHTS.reduce(
  (sum, entry) => sum + entry[1],
  0
);

type Rng = () => number;

/** mulberry32: same numbers on every machine, and no dependency to pin. */
function seeded(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Outcome =
  | { kind: "ok" }
  | { kind: "error"; name: string }
  | { kind: "token"; note: string };

const OK: Outcome = { kind: "ok" };
const NO_FUNDS: Outcome = { kind: "token", note: "insufficient funds" };

function refuses(name: string): Outcome {
  return { kind: "error", name };
}

function outcomeName(outcome: Outcome): string {
  if (outcome.kind === "ok") {
    return "ok";
  }
  return outcome.kind === "error" ? outcome.name : outcome.note;
}

interface Step {
  n: number;
  op: string;
  wallet: number;
  from: string;
  to: string;
  amount: bigint;
  expect: Outcome;
}

interface AccountModel {
  label: string;
  /** Minus one for the pool vault, which belongs to no wallet in this sale. */
  wallet: number;
  immutable: boolean;
  balance: bigint;
}

interface WalletModel {
  hasRecord: boolean;
  approved: boolean;
  netBought: bigint;
}

interface Model {
  mode: number;
  cap: bigint;
  wallets: WalletModel[];
  accounts: Map<string, AccountModel>;
}

function capForSeed(seed: number): bigint {
  const rng = seeded(seed ^ 0x2545f491);
  return 500n + BigInt(Math.floor(rng() * 4_500));
}

function freshModel(mode: number, cap: bigint): Model {
  const accounts = new Map<string, AccountModel>();
  accounts.set(VAULT, {
    label: VAULT,
    wallet: -1,
    immutable: false,
    balance: VAULT_SUPPLY,
  });
  const wallets: WalletModel[] = [];
  for (let index = 0; index < WALLETS; index += 1) {
    wallets.push({ hasRecord: false, approved: false, netBought: 0n });
    for (const kind of ACCOUNT_KINDS) {
      const label = `w${index}.${kind}`;
      accounts.set(label, {
        label,
        wallet: index,
        immutable: kind !== "loose",
        balance: 0n,
      });
    }
  }
  for (const held of SEEDED_HOLDINGS) {
    accounts.get(held.label)!.balance = held.amount;
  }
  return { mode, cap, wallets, accounts };
}

function pickOperation(rng: Rng): string {
  let roll = rng() * OPERATION_TOTAL;
  for (const [name, weight] of OPERATION_WEIGHTS) {
    roll -= weight;
    if (roll < 0) {
      return name;
    }
  }
  return OPERATION_WEIGHTS[0][0];
}

function pickWallet(rng: Rng): number {
  return Math.floor(rng() * WALLETS);
}

function pickKind(rng: Rng): string {
  return ACCOUNT_KINDS[Math.floor(rng() * ACCOUNT_KINDS.length)];
}

/**
 * Leans towards a wallet that holds something.
 *
 * A uniform pick spends most of a sequence trying to move tokens out of empty
 * accounts, which the token program refuses before the hook is ever reached. The
 * lean keeps the sequence pointed at the rules being tested and still leaves a
 * quarter of the picks free to hit an empty account on purpose.
 */
function pickHolder(rng: Rng, model: Model): number {
  const holders: number[] = [];
  for (const account of model.accounts.values()) {
    if (account.wallet >= 0 && account.balance > 0n && !holders.includes(account.wallet)) {
      holders.push(account.wallet);
    }
  }
  if (holders.length > 0 && rng() < 0.75) {
    return holders[Math.floor(rng() * holders.length)];
  }
  return pickWallet(rng);
}

function pickAccount(rng: Rng, model: Model, wallet: number): AccountModel {
  const owned = ACCOUNT_KINDS.map(
    (kind) => model.accounts.get(`w${wallet}.${kind}`)!
  );
  const holding = owned.filter((account) => account.balance > 0n);
  if (holding.length > 0 && rng() < 0.75) {
    return holding[Math.floor(rng() * holding.length)];
  }
  return owned[Math.floor(rng() * owned.length)];
}

function belowMax(rng: Rng, max: bigint): bigint {
  return BigInt(Math.floor(rng() * Number(max)));
}

/** Amounts a buy is drawn from: one, the exact room left, one past it, and huge. */
function buyAmount(rng: Rng, model: Model, wallet: WalletModel): bigint {
  const room =
    model.cap > wallet.netBought ? model.cap - wallet.netBought : 0n;
  const roll = rng();
  if (roll < 0.15) {
    return 1n;
  }
  if (roll < 0.3) {
    return room > 0n ? room : 1n;
  }
  if (roll < 0.45) {
    return room + 1n;
  }
  if (roll < 0.55) {
    return U64_MAX - belowMax(rng, 1_000n);
  }
  return 1n + belowMax(rng, model.cap);
}

/** Amounts a sell is drawn from, including more than the record and more than held. */
function sellAmount(rng: Rng, held: bigint, netBought: bigint): bigint {
  const roll = rng();
  if (held === 0n) {
    return roll < 0.5 ? 1n : U64_MAX - 3n;
  }
  if (roll < 0.18) {
    return 1n;
  }
  if (roll < 0.36) {
    return held;
  }
  if (roll < 0.5) {
    return held + 1n;
  }
  if (roll < 0.68) {
    return netBought < held
      ? netBought + 1n + belowMax(rng, held - netBought)
      : held;
  }
  if (roll < 0.78) {
    return U64_MAX - 3n;
  }
  return 1n + belowMax(rng, held);
}

function transferAmount(rng: Rng, held: bigint): bigint {
  if (held === 0n) {
    return 1n;
  }
  const roll = rng();
  if (roll < 0.25) {
    return held;
  }
  if (roll < 0.4) {
    return held + 1n;
  }
  return 1n + belowMax(rng, held);
}

/**
 * Works out what Pangu must do with this operation, in the program's own order of
 * checks. The token program runs first, so anything the vault or the holder cannot
 * pay for never reaches the hook at all.
 */
function predictBuy(
  model: Model,
  wallet: WalletModel,
  account: AccountModel,
  amount: bigint
): Outcome {
  if (amount > model.accounts.get(VAULT)!.balance) {
    return NO_FUNDS;
  }
  if (!account.immutable) {
    return refuses("ReceivingAccountOwnerCanChange");
  }
  if (!wallet.hasRecord) {
    return refuses("BuyerRecordMissing");
  }
  if (model.mode === ACCESS_ISSUER_LIST && !wallet.approved) {
    return refuses("NotApproved");
  }
  if (wallet.netBought + amount > model.cap) {
    return refuses("OverCap");
  }
  return OK;
}

function planStep(model: Model, rng: Rng, n: number): Step {
  const op = pickOperation(rng);

  if (op.startsWith("buy.")) {
    const index = pickWallet(rng);
    const account = model.accounts.get(`w${index}.${op.slice(4)}`)!;
    const wallet = model.wallets[index];
    const amount = buyAmount(rng, model, wallet);
    return {
      n,
      op,
      wallet: index,
      from: VAULT,
      to: account.label,
      amount,
      expect: predictBuy(model, wallet, account, amount),
    };
  }

  if (op === "sell") {
    const index = pickHolder(rng, model);
    const account = pickAccount(rng, model, index);
    const amount = sellAmount(
      rng,
      account.balance,
      model.wallets[index].netBought
    );
    return {
      n,
      op,
      wallet: index,
      from: account.label,
      to: VAULT,
      amount,
      expect: amount > account.balance ? NO_FUNDS : OK,
    };
  }

  if (op === "transfer.wallets" || op === "transfer.own") {
    const index = pickHolder(rng, model);
    const source = pickAccount(rng, model, index);
    let destination: AccountModel;
    if (op === "transfer.wallets") {
      const other = (index + 1 + Math.floor(rng() * (WALLETS - 1))) % WALLETS;
      destination = model.accounts.get(`w${other}.${pickKind(rng)}`)!;
    } else {
      const from = ACCOUNT_KINDS.indexOf(source.label.split(".")[1]);
      const step = 1 + Math.floor(rng() * (ACCOUNT_KINDS.length - 1));
      const kind = ACCOUNT_KINDS[(from + step) % ACCOUNT_KINDS.length];
      destination = model.accounts.get(`w${index}.${kind}`)!;
    }
    const amount = transferAmount(rng, source.balance);
    return {
      n,
      op,
      wallet: index,
      from: source.label,
      to: destination.label,
      amount,
      expect:
        amount > source.balance
          ? NO_FUNDS
          : refuses("WalletToWalletDuringSale"),
    };
  }

  if (op === "approve") {
    const index = pickWallet(rng);
    return {
      n,
      op,
      wallet: index,
      from: NOWHERE,
      to: NOWHERE,
      amount: 0n,
      expect:
        model.mode === ACCESS_ISSUER_LIST ? OK : refuses("InvalidAccessMode"),
    };
  }

  if (op === "revoke") {
    const index = pickWallet(rng);
    const wallet = model.wallets[index];
    let expect = OK;
    if (!wallet.hasRecord) {
      expect = refuses("AccountNotInitialized");
    } else if (model.mode !== ACCESS_ISSUER_LIST) {
      expect = refuses("InvalidAccessMode");
    }
    return {
      n,
      op,
      wallet: index,
      from: NOWHERE,
      to: NOWHERE,
      amount: 0n,
      expect,
    };
  }

  if (op === "open") {
    return {
      n,
      op,
      wallet: pickWallet(rng),
      from: NOWHERE,
      to: NOWHERE,
      amount: 0n,
      expect: OK,
    };
  }

  const index = pickWallet(rng);
  const account = model.accounts.get(`w${index}.${pickKind(rng)}`)!;
  const asBuy = rng() < 0.5;
  return {
    n,
    op: "direct",
    wallet: index,
    from: asBuy ? VAULT : account.label,
    to: asBuy ? account.label : VAULT,
    amount: 1n + belowMax(rng, model.cap),
    expect: refuses("NotTransferring"),
  };
}

function move(model: Model, from: string, to: string, amount: bigint) {
  model.accounts.get(from)!.balance -= amount;
  model.accounts.get(to)!.balance += amount;
}

function applyStep(model: Model, step: Step) {
  if (step.expect.kind !== "ok") {
    return;
  }
  const wallet = model.wallets[step.wallet];
  if (step.op.startsWith("buy.")) {
    move(model, VAULT, step.to, step.amount);
    wallet.netBought += step.amount;
    return;
  }
  if (step.op === "sell") {
    move(model, step.from, VAULT, step.amount);
    if (wallet.hasRecord) {
      const removed =
        wallet.netBought < step.amount ? wallet.netBought : step.amount;
      wallet.netBought -= removed;
    }
    return;
  }
  if (step.op === "approve") {
    wallet.hasRecord = true;
    wallet.approved = true;
    return;
  }
  if (step.op === "revoke") {
    wallet.approved = false;
    return;
  }
  if (step.op === "open") {
    wallet.hasRecord = true;
  }
}

function describeStep(step: Step): string {
  const where =
    step.from === NOWHERE
      ? `w${step.wallet}`
      : `${step.from} -> ${step.to} amount ${step.amount}`;
  return `#${step.n} ${step.op} ${where} expect ${outcomeName(step.expect)}`;
}

/** FNV-1a over the step lines, so two runs of one seed can be compared in one word. */
function digestOf(lines: string[]): string {
  let hash = 0x811c9dc5;
  for (const line of lines) {
    for (let at = 0; at < line.length; at += 1) {
      hash ^= line.charCodeAt(at);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

/** The step list a seed produces, worked out from the model alone with no chain. */
function plannedSteps(mode: number, seed: number, operations: number): string[] {
  const model = freshModel(mode, capForSeed(seed));
  const rng = seeded(seed);
  const lines: string[] = [];
  for (let n = 0; n < operations; n += 1) {
    const step = planStep(model, rng, n);
    lines.push(describeStep(step));
    applyStep(model, step);
  }
  return lines;
}

function exitPoints(seed: number, operations: number): Set<number> {
  const rng = seeded(seed ^ 0x5bf03635);
  const points = new Set<number>();
  while (points.size < Math.min(EXIT_CHECKPOINTS, operations)) {
    points.add(Math.floor(rng() * operations));
  }
  return points;
}

interface World {
  env: Env;
  wallets: Keypair[];
  keys: Map<string, PublicKey>;
}

interface Snapshot {
  buyers: number;
  totalNetBought: bigint;
  records: ({ approved: boolean; netBought: bigint } | null)[];
  balances: Map<string, bigint>;
}

function walletKeypair(seed: number, index: number): Keypair {
  const rng = seeded(seed * 7919 + index * 104729);
  const bytes = new Uint8Array(32);
  for (let at = 0; at < 32; at += 1) {
    bytes[at] = Math.floor(rng() * 256);
  }
  return Keypair.fromSeed(bytes);
}

async function buildWorld(mode: number, seed: number, cap: bigint): Promise<World> {
  const env = await setupSale({
    cap,
    accessMode: mode,
    vaultSupply: VAULT_SUPPLY,
  });
  const keys = new Map<string, PublicKey>([[VAULT, env.vault]]);
  const wallets: Keypair[] = [];
  for (let index = 0; index < WALLETS; index += 1) {
    const wallet = walletKeypair(seed, index);
    fund(env, wallet.publicKey);
    wallets.push(wallet);
    keys.set(
      `w${index}.ata`,
      await createAssociatedTokenAccount(env, wallet.publicKey)
    );
    keys.set(
      `w${index}.second`,
      await createTokenAccount(env, wallet.publicKey)
    );
    keys.set(
      `w${index}.loose`,
      await createTokenAccount(env, wallet.publicKey, {
        immutableOwner: false,
      })
    );
  }
  for (const held of SEEDED_HOLDINGS) {
    await mintTokens(env, keys.get(held.label)!, held.amount);
  }
  return { env, wallets, keys };
}

async function readRecord(
  world: World,
  wallet: PublicKey
): Promise<{ approved: boolean; netBought: bigint } | null> {
  const info = await world.env.client.getAccount(
    buyerRecordPda(world.env.mint, wallet)
  );
  if (info === null || info.data.length < 82) {
    return null;
  }
  const data = Buffer.from(info.data);
  return { approved: data[72] === 1, netBought: data.readBigUInt64LE(73) };
}

async function readChain(world: World): Promise<Snapshot> {
  const rules = await readRules(world.env);
  const records: ({ approved: boolean; netBought: bigint } | null)[] = [];
  for (const wallet of world.wallets) {
    records.push(await readRecord(world, wallet.publicKey));
  }
  const balances = new Map<string, bigint>();
  for (const [label, key] of world.keys) {
    const info = await world.env.client.getAccount(key);
    assert.isNotNull(info, `token account ${label} is missing`);
    balances.set(label, Buffer.from(info!.data).readBigUInt64LE(64));
  }
  return {
    buyers: rules.buyers,
    totalNetBought: BigInt(rules.totalNetBought.toString()),
    records,
    balances,
  };
}

async function runOperation(
  world: World,
  step: Step
): Promise<BanksTransactionResultWithMeta> {
  const env = world.env;
  const owner = world.wallets[step.wallet];
  if (step.op.startsWith("buy.")) {
    return buy(env, world.keys.get(step.to)!, step.amount);
  }
  if (step.op === "sell") {
    return sell(env, world.keys.get(step.from)!, owner, step.amount);
  }
  if (step.op === "transfer.wallets" || step.op === "transfer.own") {
    return transferTokens(
      env,
      world.keys.get(step.from)!,
      world.keys.get(step.to)!,
      owner,
      step.amount
    );
  }
  if (step.op === "approve") {
    return approveBuyer(env, owner.publicKey);
  }
  if (step.op === "revoke") {
    return revokeBuyer(env, owner.publicKey);
  }
  if (step.op === "open") {
    return openBuyerRecord(env, owner);
  }
  const sourceOwner =
    step.from === VAULT ? env.poolAuthority.publicKey : owner.publicKey;
  const destinationOwner =
    step.to === VAULT ? env.poolAuthority.publicKey : owner.publicKey;
  const ix = await env.program.methods
    .execute(new BN(step.amount.toString()))
    .accountsPartial({
      sourceToken: world.keys.get(step.from)!,
      mint: env.mint,
      destinationToken: world.keys.get(step.to)!,
      authority: env.poolAuthority.publicKey,
      extraAccountMetaList: env.extraMetas,
      rules: env.rules,
      destinationRecord: buyerRecordPda(env.mint, destinationOwner),
      sourceRecord: buyerRecordPda(env.mint, sourceOwner),
    })
    .instruction();
  return send(env, [ix]);
}

function checkOutcome(step: Step, result: BanksTransactionResultWithMeta) {
  const logs = (result.meta?.logMessages ?? []).join("\n");
  const seen = `${result.result}\n${logs}`;
  if (step.expect.kind === "ok") {
    assert.isNull(result.result, `expected success, got ${seen}`);
    return;
  }
  assert.isNotNull(result.result, `expected a refusal, the operation went through`);
  if (step.expect.kind === "error") {
    assert.include(logs, `Error Code: ${step.expect.name}`, seen);
  } else {
    assert.include(logs, step.expect.note, seen);
  }
}

function checkInvariants(
  model: Model,
  step: Step,
  before: Snapshot,
  after: Snapshot
) {
  let sum = 0n;
  let above = 0;
  for (let index = 0; index < WALLETS; index += 1) {
    const wallet = model.wallets[index];
    const record = after.records[index];
    assert.equal(
      record !== null,
      wallet.hasRecord,
      `w${index}: the record's existence does not match the model`
    );
    if (record === null) {
      continue;
    }
    assert.equal(
      record.netBought,
      wallet.netBought,
      `w${index}: net bought on chain does not match the model`
    );
    assert.equal(
      record.approved,
      wallet.approved,
      `w${index}: approval on chain does not match the model`
    );
    assert.isTrue(
      record.netBought <= model.cap,
      `w${index}: ${record.netBought} is over the cap of ${model.cap}`
    );
    sum += record.netBought;
    if (record.netBought > 0n) {
      above += 1;
    }
  }
  assert.equal(
    after.totalNetBought,
    sum,
    "total net bought is not the sum of every record"
  );
  assert.equal(
    after.buyers,
    above,
    "the buyer count is not the number of records above zero"
  );

  let held = 0n;
  for (const [label, balance] of after.balances) {
    assert.equal(
      balance,
      model.accounts.get(label)!.balance,
      `${label}: the token balance does not match the model`
    );
    held += balance;
  }
  assert.equal(held, TOTAL_SUPPLY, "tokens were created or destroyed");

  if (step.expect.kind === "ok") {
    return;
  }
  assert.equal(
    after.totalNetBought,
    before.totalNetBought,
    "a refused operation moved the total"
  );
  assert.equal(after.buyers, before.buyers, "a refused operation moved the buyer count");
  for (let index = 0; index < WALLETS; index += 1) {
    assert.deepEqual(
      after.records[index],
      before.records[index],
      `a refused operation changed w${index}'s record`
    );
  }
  for (const [label, balance] of after.balances) {
    assert.equal(
      balance,
      before.balances.get(label),
      `a refused operation moved ${label}'s balance`
    );
  }
}

/**
 * The exit, checked against the chain rather than against the model: every holder
 * is offered a sell of everything it holds and the runtime is asked whether it
 * would go through. The answer is thrown away, so the sequence carries on from
 * exactly where it was.
 */
async function proveEveryoneCanExit(world: World, model: Model, step: Step) {
  for (const account of model.accounts.values()) {
    if (account.wallet < 0 || account.balance === 0n) {
      continue;
    }
    const result = await simulateSell(
      world.env,
      world.keys.get(account.label)!,
      world.wallets[account.wallet],
      account.balance
    );
    assert.isNull(
      result.result,
      `after step ${step.n}, ${account.label} could not sell its ${account.balance}: ` +
        `${result.result}\n${(result.meta?.logMessages ?? []).join("\n")}`
    );
    totalExitSells += 1;
  }
}

const chainDigests = new Map<string, string>();
const operationCounts = new Map<string, number>();
const outcomeCounts = new Map<string, number>();
let totalOperations = 0;
let totalExitChecks = 0;
let totalExitSells = 0;
let totalMillis = 0;

function tally(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

async function runSequence(mode: number, seed: number, operations: number) {
  const cap = capForSeed(seed);
  const model = freshModel(mode, cap);
  const world = await buildWorld(mode, seed, cap);
  const points = exitPoints(seed, operations);
  const history: string[] = [];
  const started = Date.now();
  const rng = seeded(seed);
  let before = await readChain(world);

  for (let n = 0; n < operations; n += 1) {
    const step = planStep(model, rng, n);
    history.push(describeStep(step));
    try {
      const result = await runOperation(world, step);
      checkOutcome(step, result);
      applyStep(model, step);
      const after = await readChain(world);
      checkInvariants(model, step, before, after);
      before = after;
      if (points.has(n)) {
        await proveEveryoneCanExit(world, model, step);
        totalExitChecks += 1;
      }
    } catch (error) {
      console.log(
        `\n      random sequence failed: seed ${seed}, mode ${mode}, step ${step.n}`
      );
      console.log(
        `      replay it with PANGU_RANDOM_SEEDS=${seed} PANGU_RANDOM_OPS=${operations}`
      );
      for (const line of history) {
        console.log(`      ${line}`);
      }
      throw new Error(
        `seed ${seed}, mode ${mode}, step ${step.n} (${describeStep(step)}): ` +
          `${(error as Error).message}`
      );
    }
    tally(operationCounts, step.op);
    tally(outcomeCounts, outcomeName(step.expect));
    totalOperations += 1;
  }

  const millis = Date.now() - started;
  totalMillis += millis;
  const digest = digestOf(history);
  chainDigests.set(`${mode}:${seed}`, digest);
  console.log(
    `      seed ${seed}, mode ${mode}, cap ${cap}: ${operations} operations in ` +
      `${(millis / 1000).toFixed(1)}s, sequence ${digest}`
  );
}

describe("random sequences", () => {
  for (const mode of [ACCESS_OPEN, ACCESS_ISSUER_LIST]) {
    const name = mode === ACCESS_OPEN ? "open" : "issuer list";
    for (const seed of SEEDS) {
      it(`holds every rule over ${OPERATIONS} random operations, ${name} sale, seed ${seed}`, async () => {
        await runSequence(mode, seed, OPERATIONS);
      });
    }
  }

  it("replays the same sequence from the same seed", () => {
    for (const [key, digest] of chainDigests) {
      const [mode, seed] = key.split(":").map(Number);
      const replay = plannedSteps(mode, seed, OPERATIONS);
      assert.equal(
        digestOf(replay),
        digest,
        `seed ${seed} in mode ${mode} did not replay the same sequence`
      );
      assert.equal(
        digestOf(plannedSteps(mode, seed, OPERATIONS)),
        digest,
        `seed ${seed} in mode ${mode} is not stable between two replays`
      );
    }
  });

  after(() => {
    const mix = [...operationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([op, count]) => `${op} ${count}`)
      .join(", ");
    const outcomes = [...outcomeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([outcome, count]) => `${outcome} ${count}`)
      .join(", ");
    console.log(`      operations: ${totalOperations}, mix: ${mix}`);
    console.log(`      outcomes: ${outcomes}`);
    console.log(
      `      exit checkpoints: ${totalExitChecks}, full-balance sells simulated: ` +
        `${totalExitSells}, total run time ${(totalMillis / 1000).toFixed(1)}s`
    );
  });
});
