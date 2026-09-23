import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type ConnectionConfig,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ACCESS_MODE,
  SAS_PROGRAM_ID,
  attestationAddress,
  closeAttestationInstruction,
  createAttestationInstruction,
  createCredentialInstruction,
  createSchemaInstruction,
  credentialAddress,
  credentialStatus,
  getSale,
  listAttestations,
  schemaAddress,
  type CredentialStanding,
  type IssuedCredential,
} from "pangu-sdk";

import { CHAIN, FAUCET_ON, browserRpcUrl } from "./network";

export { explorerAddress, explorerTx } from "./network";

/*
 * The verifier console's chain work: set up a credential and schema, issue
 * credentials to wallets, revoke them, list them, and check one wallet.
 *
 * Everything here runs in the browser against the chain. Every transaction is
 * simulated before the wallet is asked to sign it, so a verifier never signs
 * something the chain would refuse, and every refusal is put in plain words.
 */

/**
 * The schema name every verifier set up here uses. The credential carries the
 * name the verifier types; the schema only needs to be one fixed, findable
 * address under it.
 */
export const SCHEMA_NAME = "pangu-buyer";
const SCHEMA_DESCRIPTION = "a wallet this verifier has checked, for Pangu credential-mode sales";

/** The attestation service writes names into addresses, which caps them at 32 bytes. */
export const MAX_NAME_BYTES = 32;

/** Solana's transaction size limit, in bytes. */
const TRANSACTION_LIMIT = 1232;

/** getMultipleAccounts answers at most this many addresses per call. */
const READ_BATCH = 100;

const REQUEST_GAP_MS = 140;
const RATE_LIMIT_TRIES = 5;
const RATE_LIMIT_BACKOFF_MS = 700;
const TOO_MANY_REQUESTS = 429;
const REQUEST_TIMEOUT_MS = 30_000;

const ACCOUNT_CREDENTIAL = 0;
const ACCOUNT_SCHEMA = 1;
/** Base58 of the single bytes 0x00 and 0x01 that open a credential and a schema. */
const CREDENTIAL_DISCRIMINATOR_BASE58 = "1";
const SCHEMA_DISCRIMINATOR_BASE58 = "2";
/** Where the authority sits in a credential, and the credential in a schema: right after the discriminator. */
const OWNER_OFFSET = 1;
const NAME_LENGTH_OFFSET = 33;

let inLine: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((wake) => setTimeout(wake, ms));
}

/**
 * One call at a time, spaced out, and tried again when the node says no.
 * Listing reads each credential's history, and the public devnet node answers
 * a burst of those with 429s.
 */
async function pacedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const turn = inLine.then(() => sleep(REQUEST_GAP_MS));
  inLine = turn;
  await turn;

  let response = await timedFetch(input, init);
  for (
    let attempt = 1;
    attempt < RATE_LIMIT_TRIES && response.status === TOO_MANY_REQUESTS;
    attempt += 1
  ) {
    await sleep(RATE_LIMIT_BACKOFF_MS * attempt);
    response = await timedFetch(input, init);
  }
  return response;
}

/**
 * A call the node never answers would leave a step reading forever. After
 * REQUEST_TIMEOUT_MS it throws instead, and the screen offers to read again.
 */
function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}

/** A connection that paces itself, on the browser's endpoint unless another is handed in. */
export function verifyConnection(endpoint: string = browserRpcUrl()): Connection {
  // web3.js types its fetch option against its own bundled fetch declaration.
  // The call shape is the platform's, so it is handed over as the config wants.
  const config = { commitment: "confirmed", fetch: pacedFetch } as unknown as ConnectionConfig;
  return new Connection(endpoint, config);
}

/** The wallet as the console needs it. The wallet adapter's own hook hands over exactly this. */
export interface VerifyWallet {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(transactions: T[]) => Promise<T[]>;
}

/** A credential and schema pair: what an issuer pastes into the launch form. */
export interface VerifierPair {
  credential: PublicKey;
  schema: PublicKey;
  /** The credential's name, as the verifier typed it. */
  name: string;
  schemaName: string;
  /** True when the connected wallet is on the credential's list of signers, so it can issue. */
  canSign: boolean;
  /** True when the schema is switched off, which stops issuing and stops new sales. */
  paused: boolean;
}

/** Where a press of a button has got to. Each one is shown on screen as it happens. */
export type Phase = "reading" | "simulating" | "signing" | "sending" | "confirming";

/** A failure with a sentence that says what to do next. */
export class VerifyError extends Error {
  constructor(
    message: string,
    /** The node's own last words, kept for anyone who wants them. */
    readonly detail: string | null = null
  ) {
    super(message);
    this.name = "VerifyError";
  }
}

function lengthAt(data: Uint8Array, offset: number): number | null {
  if (offset + 4 > data.length) {
    return null;
  }
  return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
}

/** Reads a length-prefixed string and where the next field starts, or null when it runs off the end. */
function stringAt(data: Uint8Array, offset: number): { text: string; next: number } | null {
  const length = lengthAt(data, offset);
  if (length === null || offset + 4 + length > data.length) {
    return null;
  }
  const text = new TextDecoder().decode(data.subarray(offset + 4, offset + 4 + length));
  return { text, next: offset + 4 + length };
}

/** A credential's name and signer list: `Credential::to_bytes_inner` in the service's source. */
function decodeCredential(data: Uint8Array): { name: string; signers: PublicKey[] } | null {
  if (data[0] !== ACCOUNT_CREDENTIAL) {
    return null;
  }
  const name = stringAt(data, NAME_LENGTH_OFFSET);
  if (name === null) {
    return null;
  }
  const count = lengthAt(data, name.next);
  if (count === null || name.next + 4 + count * 32 > data.length) {
    return null;
  }
  const signers: PublicKey[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = name.next + 4 + index * 32;
    signers.push(new PublicKey(data.subarray(start, start + 32)));
  }
  return { name: name.text, signers };
}

/**
 * A schema's name and paused flag: `Schema::to_bytes_inner`, which is name,
 * description, layout and field names, each behind a length, then the flag.
 */
function decodeSchema(data: Uint8Array): { name: string; paused: boolean } | null {
  if (data[0] !== ACCOUNT_SCHEMA) {
    return null;
  }
  const name = stringAt(data, NAME_LENGTH_OFFSET);
  if (name === null) {
    return null;
  }
  let offset = name.next;
  for (let field = 0; field < 3; field += 1) {
    const length = lengthAt(data, offset);
    if (length === null) {
      return null;
    }
    offset += 4 + length;
  }
  if (offset >= data.length) {
    return null;
  }
  return { name: name.text, paused: data[offset] === 1 };
}

/**
 * Every credential and schema pair this wallet already runs, found on chain.
 *
 * Two scans of the attestation service: the credentials whose authority is this
 * wallet, then the schemas under each. A pair is only returned when both
 * accounts sit at the addresses their own names derive, so what comes back is
 * exactly what `credentialAddress` and `schemaAddress` would give. The pair
 * named with SCHEMA_NAME comes first, then any other the wallet made elsewhere.
 */
export async function findVerifiers(
  connection: Connection,
  authority: PublicKey
): Promise<VerifierPair[]> {
  const credentials = await connection.getProgramAccounts(SAS_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { memcmp: { offset: 0, bytes: CREDENTIAL_DISCRIMINATOR_BASE58 } },
      { memcmp: { offset: OWNER_OFFSET, bytes: authority.toBase58() } },
    ],
  });

  const pairs: VerifierPair[] = [];
  for (const entry of credentials) {
    const credential = decodeCredential(entry.account.data);
    if (credential === null || !nameFits(credential.name)) {
      continue;
    }
    if (!credentialAddress(authority, credential.name).equals(entry.pubkey)) {
      continue;
    }
    const canSign = credential.signers.some((signer) => signer.equals(authority));
    const schemas = await connection.getProgramAccounts(SAS_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { memcmp: { offset: 0, bytes: SCHEMA_DISCRIMINATOR_BASE58 } },
        { memcmp: { offset: OWNER_OFFSET, bytes: entry.pubkey.toBase58() } },
      ],
    });
    for (const found of schemas) {
      const schema = decodeSchema(found.account.data);
      if (schema === null || !nameFits(schema.name)) {
        continue;
      }
      if (!schemaAddress(entry.pubkey, schema.name).equals(found.pubkey)) {
        continue;
      }
      pairs.push({
        credential: entry.pubkey,
        schema: found.pubkey,
        name: credential.name,
        schemaName: schema.name,
        canSign,
        paused: schema.paused,
      });
    }
  }
  return pairs.sort(
    (left, right) =>
      Number(right.schemaName === SCHEMA_NAME) - Number(left.schemaName === SCHEMA_NAME)
  );
}

function nameFits(name: string): boolean {
  const bytes = new TextEncoder().encode(name).length;
  return bytes > 0 && bytes <= MAX_NAME_BYTES;
}

/** What is wrong with a verifier name, in words, or null when it will do. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "Type the name buyers and issuers will know you by.";
  }
  const bytes = new TextEncoder().encode(trimmed).length;
  if (bytes > MAX_NAME_BYTES) {
    return `Keep it to ${MAX_NAME_BYTES} bytes: the name becomes part of an address. This one is ${bytes}.`;
  }
  return null;
}

/**
 * The transaction that opens the verifier's credential and schema, with the
 * connected wallet as authority, payer and only signer. Reads both addresses
 * first and only includes what is missing, so a setup that half landed before
 * finishes rather than failing. Null when both are already there.
 */
export async function setupTransaction(
  connection: Connection,
  authority: PublicKey,
  typedName: string
): Promise<{ transaction: Transaction | null; pair: VerifierPair }> {
  const name = typedName.trim();
  const problem = nameProblem(name);
  if (problem !== null) {
    throw new VerifyError(problem);
  }
  const credential = credentialAddress(authority, name);
  const schema = schemaAddress(credential, SCHEMA_NAME);
  const [credentialInfo, schemaInfo] = await connection.getMultipleAccountsInfo(
    [credential, schema],
    "confirmed"
  );
  for (const info of [credentialInfo, schemaInfo]) {
    if (info !== null && info !== undefined && !info.owner.equals(SAS_PROGRAM_ID)) {
      throw new VerifyError(
        "Something that is not the attestation service already sits at this verifier's address. Pick another name."
      );
    }
  }

  const transaction = new Transaction();
  if (credentialInfo === null || credentialInfo === undefined) {
    transaction.add(
      createCredentialInstruction({ payer: authority, authority, name, signers: [authority] })
    );
  }
  if (schemaInfo === null || schemaInfo === undefined) {
    transaction.add(
      createSchemaInstruction({
        payer: authority,
        authority,
        credential,
        name: SCHEMA_NAME,
        description: SCHEMA_DESCRIPTION,
      })
    );
  }
  return {
    transaction: transaction.instructions.length === 0 ? null : transaction,
    pair: { credential, schema, name, schemaName: SCHEMA_NAME, canSign: true, paused: false },
  };
}

/** One line of the pasted wallet list, checked. */
export interface PastedWallet {
  text: string;
  key: PublicKey | null;
  /** Why this line cannot be issued to, or null when it can. */
  problem: string | null;
}

/**
 * Splits pasted text into wallet addresses and checks each one. Commas,
 * semicolons, spaces and new lines all separate. A repeat is flagged on its
 * second appearance, so the first still goes through.
 */
export function parseWallets(text: string): PastedWallet[] {
  const seen = new Set<string>();
  return text
    .split(/[\s,;]+/)
    .filter((part) => part !== "")
    .map((part) => {
      let key: PublicKey;
      try {
        key = new PublicKey(part);
      } catch {
        return { text: part, key: null, problem: "not a Solana address" };
      }
      if (key.toBase58() !== part) {
        return { text: part, key: null, problem: "not a Solana address" };
      }
      if (key.equals(PublicKey.default)) {
        return { text: part, key: null, problem: "the all zero address belongs to nobody" };
      }
      if (seen.has(part)) {
        return { text: part, key: null, problem: "already in this list" };
      }
      seen.add(part);
      return { text: part, key, problem: null };
    });
}

/**
 * Unix seconds for the end of a chosen day, 23:59:59 UTC, or zero for never.
 * The day is read as UTC so the same date means the same second for the
 * verifier and for every buyer.
 */
export function expiryOf(day: string | null): number {
  if (day === null || day === "") {
    return 0;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) {
    throw new VerifyError("Pick the expiry from the date picker, or choose never.");
  }
  const seconds =
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59) / 1000;
  if (!Number.isFinite(seconds)) {
    throw new VerifyError("Pick the expiry from the date picker, or choose never.");
  }
  if (seconds * 1000 <= Date.now()) {
    throw new VerifyError("That day has already ended. Pick a later date, or choose never.");
  }
  return seconds;
}

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;

/** A year from today as the date picker writes it: the usual life of a KYC check. */
export function defaultExpiryDay(): string {
  return new Date(Date.now() + YEAR_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/** What issuing to a list of wallets comes to, before anything is signed. */
export interface IssuePlan {
  transactions: Transaction[];
  /** Wallets each transaction attests, in the same order. */
  batches: PublicKey[][];
  /** Wallets that already hold a credential from this verifier, left out. */
  alreadyHeld: PublicKey[];
}

/** Whether a transaction still fits under the size limit once the payer has signed it. */
function fits(transaction: Transaction, payer: PublicKey): boolean {
  transaction.feePayer = payer;
  // Any valid-looking hash will do for measuring: the size does not depend on it.
  transaction.recentBlockhash = PublicKey.default.toBase58();
  try {
    return (
      transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length <=
      TRANSACTION_LIMIT
    );
  } catch {
    return false;
  }
}

/**
 * Builds the transactions that issue credentials to these wallets, as few as
 * fit under the size limit.
 *
 * Wallets that already hold an attestation from this verifier are left out and
 * reported, because the service would refuse the whole transaction for one of
 * them. To change an expiry, revoke and issue again.
 */
export async function planIssue(
  connection: Connection,
  authority: PublicKey,
  pair: Pick<VerifierPair, "credential" | "schema">,
  wallets: readonly PublicKey[],
  expiry: number
): Promise<IssuePlan> {
  const addresses = wallets.map((wallet) =>
    attestationAddress(pair.credential, pair.schema, wallet)
  );
  const held = new Set<string>();
  for (let start = 0; start < addresses.length; start += READ_BATCH) {
    const infos = await connection.getMultipleAccountsInfo(
      addresses.slice(start, start + READ_BATCH),
      "confirmed"
    );
    infos.forEach((info, index) => {
      if (info !== null && info !== undefined && info.lamports > 0) {
        held.add((wallets[start + index] as PublicKey).toBase58());
      }
    });
  }

  const plan: IssuePlan = { transactions: [], batches: [], alreadyHeld: [] };
  let current = new Transaction();
  let batch: PublicKey[] = [];
  for (const wallet of wallets) {
    if (held.has(wallet.toBase58())) {
      plan.alreadyHeld.push(wallet);
      continue;
    }
    const instruction = createAttestationInstruction({
      payer: authority,
      authorizedSigner: authority,
      credential: pair.credential,
      schema: pair.schema,
      wallet,
      expiry,
    });
    current.add(instruction);
    if (!fits(current, authority)) {
      current.instructions.pop();
      plan.transactions.push(current);
      plan.batches.push(batch);
      current = new Transaction().add(instruction);
      batch = [];
    }
    batch.push(wallet);
  }
  if (batch.length > 0) {
    plan.transactions.push(current);
    plan.batches.push(batch);
  }
  return plan;
}

/** The transaction that revokes one wallet's credential. The rent comes back to the verifier. */
export function revokeTransaction(
  authority: PublicKey,
  pair: Pick<VerifierPair, "credential" | "schema">,
  wallet: PublicKey
): Transaction {
  const instruction: TransactionInstruction = closeAttestationInstruction({
    payer: authority,
    authorizedSigner: authority,
    credential: pair.credential,
    schema: pair.schema,
    wallet,
  });
  return new Transaction().add(instruction);
}

/** The attestation service's own error numbers, from program/src/error.rs in its source. */
const SERVICE_ERRORS: Record<number, string> = {
  0: "The credential and schema do not belong together. Set up again.",
  3: "The connected wallet is not a signer on this credential. Connect the wallet that set it up.",
  5: "The connected wallet is not a signer on this credential. Connect the wallet that set it up.",
  6: "The expiry is already past by the chain's clock. Pick a later date.",
  11: "This verifier's schema is paused, so nothing can be issued under it.",
};

/** Turns a refusal into a sentence that says what to do next. */
function plainRefusal(logs: readonly string[] | null, error: unknown): VerifyError {
  const lines = logs ?? [];
  const joined = lines.join("\n");
  const errorText = typeof error === "string" ? error : JSON.stringify(error ?? null);
  const last = lines.filter((line) => line.trim() !== "").at(-1) ?? errorText;

  if (/insufficient lamports|InsufficientFundsForFee|AccountNotFound/i.test(`${joined} ${errorText}`)) {
    return new VerifyError(
      FAUCET_ON
        ? `This wallet does not have enough ${CHAIN.sol} for the fees and deposits. Take some from faucet.solana.com and press again.`
        : "This wallet does not have enough SOL for the fees and deposits. Add some SOL and press again.",
      last
    );
  }
  if (/already in use/i.test(joined)) {
    return new VerifyError(
      "One of these accounts already exists. Read the list again: it may have landed on an earlier press.",
      last
    );
  }
  const custom = /custom program error: 0x([0-9a-f]+)/i.exec(joined);
  const customFromError = /"Custom":(\d+)/.exec(errorText);
  const code =
    custom !== null
      ? Number.parseInt(custom[1] as string, 16)
      : customFromError !== null
        ? Number(customFromError[1])
        : null;
  if (code !== null && SERVICE_ERRORS[code] !== undefined) {
    return new VerifyError(SERVICE_ERRORS[code] as string, last);
  }
  return new VerifyError(
    "The chain refused this, and nothing was sent. The node's own words are below.",
    last
  );
}

function wordsOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Simulates every transaction, then asks the wallet to sign them all, then
 * sends and confirms each. Nothing is signed unless every simulation passed.
 *
 * `onPhase` is told each step as it starts, so the screen never sits on one
 * label while something else is happening. Returns the signatures in order.
 */
export async function simulateSignSend(
  connection: Connection,
  wallet: VerifyWallet,
  transactions: readonly Transaction[],
  onPhase: (phase: Phase) => void
): Promise<string[]> {
  if (transactions.length === 0) {
    return [];
  }
  onPhase("simulating");
  const latest = await connection.getLatestBlockhash("confirmed");
  for (const transaction of transactions) {
    transaction.feePayer = wallet.publicKey;
    transaction.recentBlockhash = latest.blockhash;
    const simulated = await connection.simulateTransaction(
      new VersionedTransaction(transaction.compileMessage()),
      { sigVerify: false, commitment: "confirmed" }
    );
    if (simulated.value.err !== null) {
      throw plainRefusal(simulated.value.logs, simulated.value.err);
    }
  }

  onPhase("signing");
  let signed: Transaction[];
  try {
    signed =
      transactions.length > 1 && wallet.signAllTransactions !== undefined
        ? await wallet.signAllTransactions([...transactions])
        : await Promise.all(transactions.map((transaction) => wallet.signTransaction(transaction)));
  } catch (error) {
    throw new VerifyError("The wallet did not sign, so nothing was sent.", wordsOf(error));
  }

  const signatures: string[] = [];
  for (const transaction of signed) {
    onPhase("sending");
    let signature: string;
    try {
      signature = await connection.sendRawTransaction(transaction.serialize(), {
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
    } catch (error) {
      const logs = (error as { logs?: string[] }).logs ?? null;
      throw plainRefusal(logs, wordsOf(error));
    }
    onPhase("confirming");
    const confirmed = await connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );
    if (confirmed.value.err !== null) {
      throw plainRefusal(null, confirmed.value.err);
    }
    signatures.push(signature);
  }
  return signatures;
}

/** The credentials issued under a pair, newest first, then by wallet so the order is stable. */
export async function readIssued(
  connection: Connection,
  pair: Pick<VerifierPair, "credential" | "schema">
): Promise<IssuedCredential[]> {
  const issued = await listAttestations(connection, pair.credential, pair.schema);
  return issued.sort(
    (left, right) =>
      (right.created ?? 0) - (left.created ?? 0) ||
      left.wallet.toBase58().localeCompare(right.wallet.toBase58())
  );
}

export async function checkWallet(
  connection: Connection,
  pair: Pick<VerifierPair, "credential" | "schema">,
  wallet: PublicKey
): Promise<CredentialStanding> {
  return credentialStatus(connection, pair.credential, pair.schema, wallet);
}

/** A verifier a running credential-mode sale checks, for the checker to offer. */
export interface SaleVerifier {
  symbol: string;
  name: string;
  credential: PublicKey;
  schema: PublicKey;
}

/**
 * The verifiers the credential-mode sales named in the registry check, read
 * off each sale's own rules on chain rather than from the registry.
 */
export async function saleVerifiers(
  connection: Connection,
  sales: readonly { symbol: string; name: string; mint: string; mode: string }[]
): Promise<SaleVerifier[]> {
  const found: SaleVerifier[] = [];
  for (const sale of sales) {
    if (sale.mode !== "credential") {
      continue;
    }
    const rules = await getSale(connection, new PublicKey(sale.mint));
    if (rules === null || rules.accessMode !== ACCESS_MODE.verifierCredential) {
      continue;
    }
    found.push({
      symbol: sale.symbol,
      name: sale.name,
      credential: rules.credential,
      schema: rules.schema,
    });
  }
  return found;
}

/** First and last four characters, the way wallets show an address. */
export function shortKey(key: PublicKey | string): string {
  const text = typeof key === "string" ? key : key.toBase58();
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}
