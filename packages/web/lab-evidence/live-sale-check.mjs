/**
 * Which sale the page leads with, from lib/live-sale.ts itself, now and with
 * each banded sale's price forced stale in turn.
 *
 *   node lab-evidence/live-sale-check.mjs      (run from packages/web)
 *
 * Every case runs in a child process of its own, so no case sees the answer
 * another one left in the ten second share. The forcing lives only in this
 * script: a module hook hands lib/live-sale.ts a copy of pangu-sdk whose
 * readPrice calls the forced feed's price stale, and a copy of
 * lib/price-refresh.ts that answers "closed" for a forced sale, as a shut
 * market does. Nothing in the app reads LIVE_SALE_FORCE. A sale that is not
 * forced is read and, when stale, refreshed for real, exactly as the page does.
 *
 * The keyed endpoint in the root .env is used for the reads and never printed.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const EXCHANGE = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
const AAPLX = "978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675";
const FEED_OF_SYMBOL = { "Equity.US.AAPL/USD": EXCHANGE, "Crypto.AAPLX/USD": AAPLX };
const WORDS = { [EXCHANGE]: "Apple's exchange price", [AAPLX]: "AAPLx" };

const web = new URL("../", import.meta.url);
const salesFile = new URL("../../scripts/sales.json", import.meta.url);
const CASES = ["none", "exchange", "aaplx", "both"];

function forcedIn(force, feed) {
  return (
    force === "both" ||
    (force === "exchange" && feed === EXCHANGE) ||
    (force === "aaplx" && feed === AAPLX)
  );
}

if (process.env.LIVE_SALE_FORCE === undefined) {
  await parent();
} else {
  await child(process.env.LIVE_SALE_FORCE);
}

async function parent() {
  let failed = 0;
  for (const force of CASES) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: fileURLToPath(web),
      env: { ...process.env, LIVE_SALE_FORCE: force },
      encoding: "utf8",
      timeout: 240_000,
    });
    const lines = (run.stdout ?? "").trim().split("\n");
    const last = lines.pop() ?? "";
    for (const line of lines) {
      console.log(line);
    }
    let report;
    try {
      report = JSON.parse(last);
    } catch {
      failed += 1;
      console.log(`FAIL  ${force}: the child printed no answer (exit ${run.status})`);
      // Any address is masked, because an error's text can carry the keyed endpoint.
      console.log((run.stderr ?? "").replace(/https?:\/\/\S+/g, "[endpoint]").slice(0, 1500));
      console.log("");
      continue;
    }
    const verdict = judge(force, report);
    if (!verdict.ok) {
      failed += 1;
    }
    console.log(`${verdict.ok ? "ok  " : "FAIL"}  wanted    : ${verdict.wanted}`);
    console.log("");
  }
  console.log(failed === 0 ? "every case chose the right sale" : `${failed} case(s) chose wrongly`);
  process.exit(failed === 0 ? 0 : 1);
}

/**
 * The right answer for a case, worked out from how each sale's price really
 * stood once the choice was made, with a forced one counted as stale.
 */
function judge(force, report) {
  const usable = (feed) => report.realUsable[feed] === true && !forcedIn(force, feed);
  let wanted;
  if (usable(EXCHANGE)) {
    wanted = { feed: EXCHANGE, closed: false, exchangeShut: false };
  } else if (usable(AAPLX)) {
    wanted = { feed: AAPLX, closed: false, exchangeShut: true };
  } else {
    wanted = { feed: EXCHANGE, closed: true, exchangeShut: false };
  }
  const got = report.choice;
  const ok =
    got !== null &&
    got.feedId === wanted.feed &&
    got.closed === wanted.closed &&
    got.exchangeShut === wanted.exchangeShut;
  return {
    ok,
    wanted: `the sale following ${WORDS[wanted.feed]}, closed ${wanted.closed}, exchangeShut ${wanted.exchangeShut}`,
  };
}

async function child(force) {
  const sales = JSON.parse(readFileSync(salesFile, "utf8"));
  const feedOfMint = Object.fromEntries(
    sales
      .filter((sale) => typeof sale.feed === "string")
      .map((sale) => [sale.mint, FEED_OF_SYMBOL[sale.feed] ?? null])
  );

  const realSdk = import.meta.resolve("pangu-sdk");
  const liveSale = new URL("lib/live-sale.ts", web).href;
  const realRefresh = new URL("lib/price-refresh.ts", web).href;
  const forcedFeeds = [EXCHANGE, AAPLX].filter((feed) => forcedIn(force, feed));
  const forcedMints = Object.entries(feedOfMint)
    .filter(([, feed]) => feed !== null && forcedIn(force, feed))
    .map(([mint]) => mint);

  const stubSdk = [
    `import * as real from ${JSON.stringify(realSdk)};`,
    `export * from ${JSON.stringify(realSdk)};`,
    `const forced = ${JSON.stringify(forcedFeeds)};`,
    "export async function readPrice(connection, sale) {",
    "  const reading = await real.readPrice(connection, sale);",
    "  if (!forced.includes(sale.priceFeedId)) return reading;",
    '  return { ...reading, usable: false, error: "PriceStale", reason: "forced stale by live-sale-check" };',
    "}",
  ].join("\n");
  const stubRefresh = [
    `import * as real from ${JSON.stringify(realRefresh)};`,
    `export * from ${JSON.stringify(realRefresh)};`,
    `const forcedMints = ${JSON.stringify(forcedMints)};`,
    "export async function refreshIfStale(mint) {",
    "  const key = mint.toBase58();",
    "  const forced = forcedMints.includes(key);",
    '  const outcome = forced ? { status: "closed", closed: true, lastPublishedAt: 0 } : await real.refreshIfStale(mint);',
    '  console.log("refresh   : " + key.slice(0, 8) + " answered " + outcome.status + (forced ? " (forced)" : " (real)"));',
    "  return outcome;",
    "}",
  ].join("\n");

  // The app's own files use the bundler's rules: "@/" for the package root, no
  // file extensions, and a JSON import with no type attribute. Node is taught
  // those three here, for this script only.
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parentUrl = context.parentURL ?? "";
      if (specifier === "pangu-sdk" && parentUrl === liveSale) {
        return { url: "live-sale-check:sdk", shortCircuit: true };
      }
      const wanted = specifier.startsWith("@/") ? new URL(specifier.slice(2), web).href : specifier;
      const local =
        (wanted.startsWith(".") || wanted.startsWith("file:")) &&
        !parentUrl.includes("node_modules") &&
        !/\.([cm]?[jt]sx?|json)$/.test(wanted);
      // Pyth's helper library also imports without extensions, which only a
      // bundler accepts, so a miss is tried again the way a bundler would.
      const attempt = (name) => {
        for (const guess of [name, `${name}.js`, `${name}/index.js`]) {
          try {
            return nextResolve(guess, context);
          } catch (error) {
            if (guess.endsWith("/index.js")) {
              throw error;
            }
          }
        }
        return nextResolve(name, context);
      };
      const resolved = local ? nextResolve(`${wanted}.ts`, context) : attempt(wanted);
      if (resolved.url === realRefresh && parentUrl === liveSale) {
        return { url: "live-sale-check:refresh", shortCircuit: true };
      }
      return resolved;
    },
    load(url, context, nextLoad) {
      if (url === "live-sale-check:sdk") {
        return { format: "module", source: stubSdk, shortCircuit: true };
      }
      if (url === "live-sale-check:refresh") {
        return { format: "module", source: stubRefresh, shortCircuit: true };
      }
      if (url.endsWith(".json") && !url.includes("node_modules")) {
        const text = readFileSync(fileURLToPath(url), "utf8");
        return { format: "module", source: `export default ${text};`, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });

  const { chooseLiveSale } = await import(liveSale);
  const sdk = await import(realSdk);
  const { PublicKey } = await import("@solana/web3.js");
  const { devnetConnection } = await import(new URL("lib/solana.ts", web).href);

  console.log(`case      : ${force === "none" ? "as the chain stands now" : `${force} forced stale`}`);
  const started = Date.now();
  const choice = await chooseLiveSale();
  console.log(`took      : ${((Date.now() - started) / 1000).toFixed(1)} s`);

  // Read after the choice, so a price the choice posted counts as it now stands.
  const connection = devnetConnection();
  const realUsable = {};
  for (const candidate of choice?.candidates ?? []) {
    const sale = await sdk.getSale(connection, new PublicKey(candidate.mint));
    const reading = sale === null ? null : await sdk.readPrice(connection, sale);
    const usable = reading !== null && reading.usable;
    realUsable[candidate.feedId] = realUsable[candidate.feedId] === true || usable;
    const published =
      reading !== null && reading.publishTime > 0
        ? `, published ${new Date(reading.publishTime * 1000).toISOString()}`
        : "";
    console.log(
      `candidate : ${candidate.name} (${candidate.mint.slice(0, 8)}) follows ${
        WORDS[candidate.feedId] ?? candidate.feedId
      }, price really ${usable ? "usable" : `not usable (${reading?.error ?? "no reading"})`}${published}`
    );
  }
  console.log(
    choice === null
      ? "chosen    : none"
      : `chosen    : ${choice.name} (${choice.mint.slice(0, 8)}), ceiling follows ${
          WORDS[choice.feedId] ?? choice.feedId
        }, closed ${choice.closed}, exchangeShut ${choice.exchangeShut}`
  );
  console.log(
    JSON.stringify({
      choice:
        choice === null
          ? null
          : { feedId: choice.feedId, closed: choice.closed, exchangeShut: choice.exchangeShut },
      realUsable,
    })
  );
}
