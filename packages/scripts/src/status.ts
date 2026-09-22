/**
 * One read-only check that Pangu's devnet demo is still alive.
 *
 *   npm run status
 *
 * Judging runs to 2 October 2026 and a demo that dies quietly inside that
 * window is worth nothing, so every part a judge can reach gets a row here and
 * the command exits non-zero the moment one of them fails. It signs nothing and
 * spends nothing: each answer is a read of the chain, of Pyth's Hermes service,
 * or of the site.
 *
 * FAIL means the demo a judge would open is broken. WARN means something worth
 * a person's eye that does not stop the demo: a price that has aged out because
 * the US market is shut, a thin wallet, a sale left behind by an earlier build.
 * Only a FAIL changes the exit code.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  ACCESS_MODE,
  LIMITS,
  PANGU_PROGRAM_ID,
  getSale,
  isSaleRunning,
  priceFeedAddress,
  readPrice,
  type Sale,
} from "pangu-sdk";
import {
  devnet,
  payerKeypair,
  repositoryRoot,
  requireDevnet,
  rpcUrl,
} from "./environment.js";
import { FEEDS } from "./feeds.js";
import { readSales, type SaleRecord } from "./sales.js";

/** What one row of the table says. Only FAIL makes the command exit non-zero. */
export type Result = "PASS" | "WARN" | "FAIL" | "SKIP";

export interface CheckRow {
  /** What was checked, short enough to scan down one column. */
  check: string;
  result: Result;
  /** The numbers behind the result, so a reader does not have to run it again. */
  detail: string;
}

/** What docs/deployments.md records about the build running on devnet. */
export interface DeployedBuild {
  programId: string;
  programData: string;
  /** Length of the build in bytes. The account on chain is padded past this. */
  buildBytes: number;
  /** Lowercase hex, 64 characters. */
  sha256: string;
  upgradeAuthority: string;
}

const DEPLOYMENTS_FILE = join(repositoryRoot, "docs", "deployments.md");

/** Ram's Pyth access is a granted trial. A sale after this date needs its own key. */
const PYTH_ACCESS_END = "2026-10-05";

const HERMES_URL = "https://hermes.pyth.network";

/** Hermes answers in well under a second when it is healthy. */
const HERMES_TIMEOUT_MS = 15_000;

/** The site either answers quickly or it is not something a judge will wait for. */
const APP_TIMEOUT_MS = 5_000;

/**
 * How far ahead of this machine Pyth's clock may read before it is worth
 * saying so. It is the same tolerance the program's price.rs allows.
 */
const CLOCK_DRIFT_SECS = 60;

/** Under this a wallet cannot pay for a launch and a refresh, so it gets a WARN. */
const LOW_BALANCE_LAMPORTS = 0.2 * LAMPORTS_PER_SOL;

const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/**
 * The upgradeable loader writes an enum tag, the deploy slot and an optional
 * upgrade authority in front of the code, so the build starts at byte 45. That
 * is the same trim scripts/wsl/program-info.sh gets for free from
 * `solana program dump`, which strips the header before it writes the file.
 */
const PROGRAM_DATA_HEADER = 45;

/** Enough of an address to recognise, in a column that has to stay narrow. */
function short(address: string): string {
  return `${address.slice(0, 8)}...`;
}

function row(check: string, result: Result, detail: string): CheckRow {
  return { check, result, detail };
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** The table itself, as fixed width columns. */
export function renderTable(rows: readonly CheckRow[]): string {
  const head = ["Check", "Result", "Detail"];
  const cells = rows.map((each) => [each.check, each.result, each.detail]);
  const widths = head.map((title, column) =>
    Math.max(title.length, ...cells.map((line) => (line[column] ?? "").length))
  );
  const line = (values: string[]): string =>
    values.map((value, column) => pad(value, widths[column] ?? 0)).join("  ").trimEnd();

  return [
    line(head),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...cells.map(line),
  ].join("\n");
}

/** The closing line: the counts, and the UTC time they were read at. */
export function summaryLine(rows: readonly CheckRow[], at: Date): string {
  const count = (result: Result): number =>
    rows.filter((each) => each.result === result).length;
  const when = at.toISOString().replace(/\.\d{3}Z$/, "Z");
  return (
    `${count("PASS")} passed, ${count("WARN")} warned, ${count("FAIL")} failed, ` +
    `${count("SKIP")} not checked, at ${when}`
  );
}

/** Zero only when nothing failed. A warning is a live condition, not a break. */
export function exitCode(rows: readonly CheckRow[]): number {
  return rows.some((each) => each.result === "FAIL") ? 1 : 0;
}

/**
 * Whether the US market is inside a session an equity feed publishes through:
 * a weekday between 04:00 and 20:00 in New York, which covers the pre-market
 * and after-hours sessions as well as the regular one.
 *
 * The New York clock comes from the platform's own time zone database rather
 * than from an offset written down here, so the switch in and out of daylight
 * saving needs no maintenance. It knows nothing about market holidays, so a
 * closed Thanksgiving still reads as open.
 */
export function usMarketOpen(at: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "-1");
  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }
  return hour >= 4 && hour < 20;
}

function plain(value: string): string {
  return value.replace(/`/g, "").trim();
}

function onlyRow(section: string, name: string): string {
  const found = section
    .split("\n")
    .filter((line) => line.trimStart().startsWith("|"))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells[1] === name)
    .map((cells) => plain(cells[2] ?? ""));
  if (found.length !== 1) {
    throw new Error(
      `docs/deployments.md has ${found.length} rows called "${name}" in its devnet section, and this needs exactly one`
    );
  }
  return found[0] as string;
}

function address(value: string, name: string): string {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(
      `docs/deployments.md gives "${value}" as ${name}, which is not an address`
    );
  }
}

/**
 * Reads what docs/deployments.md records about the build running on devnet.
 *
 * Only the "Devnet (live)" section is read, so the mainnet table and the deploy
 * history cannot answer for it, and a row name that appears twice or not at all
 * throws instead of one of them being picked. The recorded hash is lowercased
 * here and the hash of the bytes on chain is lowercased the same way, so both
 * sides of that comparison are always produced by the same rule.
 *
 * Throws when the section, a row, the size or the hash is missing or malformed.
 */
export function readDeployedBuild(markdown: string): DeployedBuild {
  const start = markdown.indexOf("## Devnet (live)");
  if (start === -1) {
    throw new Error('docs/deployments.md has no "## Devnet (live)" section');
  }
  const rest = markdown.slice(start + 1);
  const end = rest.indexOf("\n## ");
  const section = end === -1 ? rest : rest.slice(0, end);

  const size = Number(
    onlyRow(section, "Build size").replace(/,/g, "").replace(/\s*bytes$/, "")
  );
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(
      "docs/deployments.md does not record the devnet build size as a number of bytes"
    );
  }
  const sha256 = onlyRow(section, "sha256 of the deployed build").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(
      `docs/deployments.md gives "${sha256}" as the build's sha256, which is not a sha256`
    );
  }

  return {
    programId: address(onlyRow(section, "Program id"), "the program id"),
    programData: address(onlyRow(section, "Program data account"), "the program data account"),
    buildBytes: size,
    sha256,
    upgradeAuthority: address(
      onlyRow(section, "Upgrade authority (public key)"),
      "the upgrade authority"
    ),
  };
}

async function checkProgram(
  connection: Connection,
  build: DeployedBuild
): Promise<CheckRow> {
  const check = `program ${short(build.programId)}`;
  if (PANGU_PROGRAM_ID.toBase58() !== build.programId) {
    return row(
      check,
      "FAIL",
      `docs/deployments.md records ${build.programId}, pangu-sdk builds against ${PANGU_PROGRAM_ID.toBase58()}`
    );
  }

  const program = await connection.getAccountInfo(new PublicKey(build.programId));
  if (program === null) {
    return row(check, "FAIL", "there is no account at that address on devnet");
  }
  if (!program.executable) {
    return row(check, "FAIL", "the account is not executable, so nothing can call it");
  }
  if (!program.owner.equals(UPGRADEABLE_LOADER)) {
    return row(
      check,
      "FAIL",
      `owned by ${program.owner.toBase58()}, not by the upgradeable loader`
    );
  }
  if (program.data.length < 36) {
    return row(
      check,
      "FAIL",
      `the program account holds ${program.data.length} bytes, too few to name its program data account`
    );
  }
  const pointsAt = new PublicKey(program.data.subarray(4, 36)).toBase58();
  if (pointsAt !== build.programData) {
    return row(
      check,
      "FAIL",
      `it reads its code from ${pointsAt}, not from the recorded ${build.programData}`
    );
  }

  const data = await connection.getAccountInfo(new PublicKey(build.programData));
  if (data === null) {
    return row(check, "FAIL", `its program data account ${build.programData} is gone`);
  }
  const code = data.data.subarray(
    PROGRAM_DATA_HEADER,
    PROGRAM_DATA_HEADER + build.buildBytes
  );
  if (code.length < build.buildBytes) {
    return row(
      check,
      "FAIL",
      `the program data account holds ${code.length} bytes of code, fewer than the ${build.buildBytes} recorded`
    );
  }
  const onChain = createHash("sha256").update(code).digest("hex");
  if (onChain !== build.sha256) {
    return row(check, "FAIL", `sha256 ${onChain} is not the recorded ${build.sha256}`);
  }
  const slot = data.data.readBigUInt64LE(4);

  return row(
    check,
    "PASS",
    `executable, ${build.buildBytes} bytes, sha256 ${build.sha256.slice(0, 12)} as recorded, slot ${slot}`
  );
}

function modeWord(accessMode: number): string {
  if (accessMode === ACCESS_MODE.open) {
    return "open";
  }
  if (accessMode === ACCESS_MODE.issuerList) {
    return "list";
  }
  if (accessMode === ACCESS_MODE.verifierCredential) {
    return "credential";
  }
  return `access mode ${accessMode}`;
}

interface SaleCheck {
  row: CheckRow;
  sale: Sale | null;
  running: boolean;
}

/**
 * Why these bytes cannot be a sale the running build opened, or null when
 * nothing says so.
 *
 * A sale opened by an earlier build sits at the same address behind the same
 * Anchor discriminator, so it decodes without complaint and hands back numbers
 * read from the wrong offsets. The test is the program's own limits rather than
 * a list of old addresses: a band of 20443 basis points is something create_sale
 * would have refused, so those bytes are not this build's layout. It cannot
 * catch an old account whose every field happens to land inside the limits.
 */
function notThisBuild(sale: Sale): string | null {
  if (sale.bandBps > LIMITS.maxBandBps) {
    return `a band of ${sale.bandBps} bps, past the ${LIMITS.maxBandBps} create_sale allows`;
  }
  if (!sale.hasBand) {
    return null;
  }
  if (sale.maxPriceAgeSecs > LIMITS.maxPriceAgeSecs) {
    return `a price age limit of ${sale.maxPriceAgeSecs}s, past the ${LIMITS.maxPriceAgeSecs} create_sale allows`;
  }
  if (sale.maxConfBps > LIMITS.maxConfBps) {
    return `a confidence limit of ${sale.maxConfBps} bps, past the ${LIMITS.maxConfBps} create_sale allows`;
  }
  return null;
}

/**
 * One sale's rules account, read back off the chain rather than out of
 * sales.json, so the mode and the buyer count in the table are the chain's
 * answer and not the file's memory of what was opened.
 */
async function checkSale(
  connection: Connection,
  record: SaleRecord
): Promise<SaleCheck> {
  const check = `sale ${record.symbol} ${short(record.mint)}`;
  const mint = new PublicKey(record.mint);
  let sale: Sale | null;
  try {
    sale = await getSale(connection, mint);
  } catch (error) {
    return {
      row: row(check, "FAIL", error instanceof Error ? error.message : String(error)),
      sale: null,
      running: false,
    };
  }
  if (sale === null) {
    return {
      row: row(check, "FAIL", `no SaleRules account at ${record.rules}`),
      sale: null,
      running: false,
    };
  }
  const running = await isSaleRunning(connection, mint);
  const older = notThisBuild(sale);
  if (older !== null) {
    return {
      row: row(
        check,
        "WARN",
        `${record.mint}, opened by an earlier build: it decodes to ${older}. Retire it from sales.json.`
      ),
      sale: null,
      running,
    };
  }
  const band = sale.hasBand ? `, band ${sale.bandBps} bps` : "";
  return {
    row: row(
      check,
      "PASS",
      `${record.mint}, ${modeWord(sale.accessMode)}${band}, ${sale.buyers} buyers, ${running ? "running" : "graduated"}`
    ),
    sale,
    running,
  };
}

function feedName(feedId: string): string {
  return FEEDS.find((feed) => feed.id === feedId)?.symbol ?? `feed 0x${feedId.slice(0, 8)}`;
}

/**
 * The price account a banded sale reads, and how old the price in it is.
 *
 * A price that has only aged out is a WARN: Pyth stops publishing an equity
 * when the US market shuts, so an overnight sale ages out by design and one
 * refresh brings it back. Anything structural, a missing account, the wrong
 * feed, an update the guardians did not fully sign, is a FAIL, because no
 * refresh fixes it.
 */
async function checkBand(
  connection: Connection,
  record: SaleRecord,
  sale: Sale,
  running: boolean,
  at: Date
): Promise<CheckRow> {
  const symbol = feedName(sale.priceFeedId);
  const check = `band ${record.symbol} ${short(record.mint)}`;
  if (!running) {
    return row(check, "SKIP", `graduated, so no buy is priced against ${symbol} any more`);
  }

  const derived = priceFeedAddress(sale.priceFeedId, sale.priceShard);
  if (!derived.equals(sale.priceAccount)) {
    return row(
      check,
      "FAIL",
      `the rules read ${sale.priceAccount.toBase58()}, but ${symbol} on shard ${sale.priceShard} lives at ${derived.toBase58()}`
    );
  }
  const account = await connection.getAccountInfo(derived);
  if (account === null) {
    return row(
      check,
      "FAIL",
      `nothing at ${derived.toBase58()}: ${symbol} has never been refreshed on shard ${sale.priceShard}`
    );
  }

  const price = await readPrice(connection, sale);
  const published = new Date(price.publishTime * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const age = `${symbol} published ${published}, ${price.ageSecs} seconds ago of an allowed ${sale.maxPriceAgeSecs}`;
  if (price.usable) {
    return row(check, "PASS", `${age}, at ${price.priceDollars.toFixed(2)} dollars`);
  }
  if (price.error === "PriceStale" && price.ageSecs > sale.maxPriceAgeSecs) {
    const shut =
      symbol.startsWith("Equity.US.") && !usMarketOpen(at)
        ? ", and the US market is shut right now, so this is expected"
        : "";
    return row(check, "WARN", `${age}. Buys are refused until it is refreshed${shut}`);
  }
  if (price.error === "PriceTooUncertain") {
    return row(
      check,
      "WARN",
      `${symbol} is ${price.confBps} basis points uncertain, wider than the ${sale.maxConfBps} this sale buys against`
    );
  }
  return row(check, "FAIL", `${price.error}: ${price.reason ?? "the price cannot be used"}`);
}

/**
 * One Hermes read of Apple's price with the key from .env.
 *
 * The key is never printed, and it is cut out of anything Hermes says before
 * that text reaches the table, because a failure line ends up in a log.
 */
async function checkPythKey(): Promise<CheckRow> {
  const check = "pyth key";
  const key = process.env.PYTH_API_KEY;
  if (key === undefined || key.length === 0) {
    return row(check, "FAIL", "PYTH_API_KEY is not set in .env, so no price can be refreshed");
  }
  const feed = FEEDS.find((each) => each.symbol === "Equity.US.AAPL/USD");
  if (feed === undefined) {
    return row(check, "FAIL", "src/feeds.ts no longer carries Equity.US.AAPL/USD");
  }

  let response: Response;
  try {
    response = await fetch(
      `${HERMES_URL}/v2/updates/price/latest?ids[]=${feed.id}&encoding=base64&parsed=true`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(HERMES_TIMEOUT_MS),
      }
    );
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    return row(check, "FAIL", `Hermes did not answer: ${said.split(key).join("[key]")}`);
  }

  if (!response.ok) {
    const said = (await response.text()).slice(0, 120).split(key).join("[key]");
    const meaning =
      response.status === 401 || response.status === 403
        ? "the key is refused, so every banded sale is frozen"
        : said;
    return row(check, "FAIL", `HTTP ${response.status}, ${meaning}`);
  }

  const body = (await response.json()) as {
    parsed?: { price?: { publish_time?: number } }[];
  };
  const publishTime = body.parsed?.[0]?.price?.publish_time;
  if (typeof publishTime !== "number") {
    return row(
      check,
      "WARN",
      `HTTP ${response.status}, but Hermes returned no publish time to read`
    );
  }
  const ageSecs = Math.floor(Date.now() / 1000) - publishTime;
  if (ageSecs < -CLOCK_DRIFT_SECS) {
    return row(
      check,
      "WARN",
      `HTTP ${response.status}, but Apple's price is dated ${-ageSecs} seconds ahead of this machine, so one of the two clocks is wrong`
    );
  }
  return row(
    check,
    "PASS",
    `HTTP ${response.status}, Apple published ${Math.max(0, ageSecs)} seconds ago`
  );
}

async function checkBalance(
  connection: Connection,
  check: string,
  wallet: PublicKey
): Promise<CheckRow> {
  const lamports = await connection.getBalance(wallet, "confirmed");
  const held = `${wallet.toBase58()} holds ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
  if (lamports < LOW_BALANCE_LAMPORTS) {
    return row(
      check,
      "WARN",
      `${held}, under the 0.2 SOL a launch and a refresh need. Airdrop it.`
    );
  }
  return row(check, "PASS", held);
}

/** The demo wallet's public key, from the key file .env points at. The bytes stay in it. */
async function checkDemoWallet(connection: Connection): Promise<CheckRow> {
  const check = "wallet demo";
  try {
    const payer = payerKeypair();
    return await checkBalance(
      connection,
      `${check} ${short(payer.publicKey.toBase58())}`,
      payer.publicKey
    );
  } catch (error) {
    return row(check, "FAIL", error instanceof Error ? error.message : String(error));
  }
}

/** The live site, when .env names one. No URL is a SKIP rather than a failure. */
async function checkApp(url: string | undefined): Promise<CheckRow> {
  const check = "app";
  if (url === undefined || url.length === 0) {
    return row(check, "SKIP", "APP_URL is not set in .env, so there is no site to check");
  }
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return row(check, "FAIL", `APP_URL is "${url}", which is not a URL`);
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return row(
      check,
      "FAIL",
      `APP_URL is ${target.protocol} and this only fetches over http or https`
    );
  }

  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(APP_TIMEOUT_MS) });
    const body = await response.text();
    if (response.status !== 200) {
      return row(check, "FAIL", `${target.href} answered HTTP ${response.status}`);
    }
    if (!body.includes("Pangu")) {
      return row(check, "FAIL", `${target.href} answered 200 but the page never says Pangu`);
    }
    return row(
      check,
      "PASS",
      `${target.href} answered 200 inside ${APP_TIMEOUT_MS / 1000} seconds and says Pangu`
    );
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    return row(check, "FAIL", `${target.href} did not answer: ${said}`);
  }
}

function daysUntil(day: string, at: Date): number {
  return Math.ceil((Date.parse(`${day}T00:00:00Z`) - at.getTime()) / 86_400_000);
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    throw new Error(`status takes no flags, got ${process.argv.slice(2).join(" ")}`);
  }

  // Asking for the RPC url is also what loads .env, which is where the Pyth key
  // and APP_URL are read from further down.
  const endpoint = rpcUrl();
  const connection = devnet();
  await requireDevnet(connection);
  const at = new Date();
  const build = readDeployedBuild(readFileSync(DEPLOYMENTS_FILE, "utf8"));

  const rows: CheckRow[] = [await checkProgram(connection, build)];
  for (const record of readSales()) {
    const checked = await checkSale(connection, record);
    rows.push(checked.row);
    if (checked.sale !== null && checked.sale.hasBand) {
      rows.push(await checkBand(connection, record, checked.sale, checked.running, at));
    }
  }
  rows.push(await checkPythKey());
  rows.push(await checkDemoWallet(connection));
  rows.push(
    await checkBalance(
      connection,
      `wallet project ${short(build.upgradeAuthority)}`,
      new PublicKey(build.upgradeAuthority)
    )
  );
  rows.push(await checkApp(process.env.APP_URL));

  console.log(`network : devnet, ${endpoint}`);
  console.log("");
  console.log(renderTable(rows));
  console.log("");
  console.log(
    `pyth    : the granted key runs to ${PYTH_ACCESS_END}, ${daysUntil(PYTH_ACCESS_END, at)} days from now. A sale after that needs its own key.`
  );
  console.log(summaryLine(rows, at));
  process.exit(exitCode(rows));
}

// The test reads this file for its table functions, so main only runs when node
// was started on this file rather than on vitest.
const runningAsCommand =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (runningAsCommand) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
