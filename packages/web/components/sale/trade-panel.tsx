"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, type Connection, type PublicKey } from "@solana/web3.js";
import { motion, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACCESS_MODE, type PriceReading } from "pangu-sdk";
import type { BuyPreflight, PoolView } from "pangu-sdk/dbc";

import { Spinner } from "@/components/break/strike";
import { clock, explorerAddress, utcDay } from "@/components/readout/format";
import { explorerTx } from "@/lib/break";
import type { DirectorySale } from "@/lib/directory";
import { feedWords } from "@/lib/feeds";
import { tokenAmount } from "@/lib/format";
import {
  amountText,
  buildBuy,
  buildSell,
  credentialStanding,
  messageOf,
  parseAmount,
  preflight,
  quoteBuy,
  quoteSell,
  readBandPrice,
  readWallet,
  whatToDo,
  type CredentialStanding,
  type WalletStanding,
} from "@/lib/trade";

import { ActionStatus } from "./action-status";
import { busy, useChainAction } from "./use-chain-action";

// The wallet button reads the browser's injected wallets, so rendering it on
// the server would only produce markup the client replaces at once.
const WalletButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  { ssr: false, loading: () => <span className="block h-9 w-[132px] rounded-lg bg-raised" /> }
);

const EASE = [0.22, 1, 0.36, 1] as const;
const CHECK_DELAY_MS = 450;
const AIRDROP_SOL = 0.5;

type Mode = "buy" | "sell";
type Unit = "shares" | "paying";

/** Where the page's one ask to bring the band's price up to date has got to. */
type Refresh =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done" }
  | { state: "closed"; lastPublishedAt: number; askedAt: number }
  | { state: "failed"; reason: string };

/** The rules' answer to the amount typed, before anything is signed. */
type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "answer"; preflight: BuyPreflight }
  | { state: "failed"; message: string };

/** An answer, and the buy it answers, so a newer amount never shows an older answer. */
type Answered = { key: string; check: Check };

const FIELD =
  "h-14 w-full rounded-lg border border-line bg-transparent px-4 font-display text-[22px] tabular-nums tracking-[-0.01em] outline-none transition-colors placeholder:text-muted/60 hover:border-muted focus:border-accent";

const SMALL_BUTTON =
  "inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors duration-200 hover:border-ink hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

const PRIMARY =
  "group inline-flex h-12 items-center gap-2.5 rounded-lg border border-accent bg-accent px-6 text-[15px] font-medium text-accent-ink transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_var(--accent)] disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

/**
 * Buying and selling one sale. Every number is read off devnet for the
 * connected wallet; the rules' answer to a buy is given in words before the
 * wallet is asked for anything.
 */
export function TradePanel({
  sale,
  connection,
  mint,
  view,
  onMarketMoved,
}: {
  sale: DirectorySale;
  connection: Connection;
  mint: PublicKey;
  view: PoolView | null;
  onMarketMoved: () => void;
}) {
  const still = useReducedMotion() === true;
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const { step, run, reset } = useChainAction(connection);

  const [mode, setMode] = useState<Mode>("buy");
  const [unit, setUnit] = useState<Unit>("shares");
  const [typed, setTyped] = useState("");
  const [standing, setStanding] = useState<WalletStanding | null>(null);
  const [standingFailure, setStandingFailure] = useState<string | null>(null);
  const [credential, setCredential] = useState<CredentialStanding | null>(null);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [price, setPrice] = useState<PriceReading | null>(null);
  const [refresh, setRefresh] = useState<Refresh>({ state: "idle" });
  const [reload, setReload] = useState(0);

  const symbol = "shares";
  const baseDecimals = view?.sale.baseDecimals ?? sale.baseDecimals;
  const quoteDecimals = sale.quoteDecimals ?? view?.sale.quoteDecimals ?? 0;
  const inSol = sale.money === "SOL";
  const rulesOff = sale.offeringOver;
  const feed = feedWords(sale.feedId);

  const shares = useCallback((raw: bigint) => `${tokenAmount(raw, baseDecimals)} ${symbol}`, [baseDecimals, symbol]);
  const paying = useCallback(
    (raw: bigint) => (inSol ? `${tokenAmount(raw, quoteDecimals)} SOL` : `$${tokenAmount(raw, quoteDecimals)}`),
    [inSol, quoteDecimals]
  );

  // A wallet's numbers belong to that wallet. A switch clears them before the new read lands.
  const [standingFor, setStandingFor] = useState(wallet);
  if (standingFor !== wallet) {
    setStandingFor(wallet);
    setStanding(null);
    setCredential(null);
    setStandingFailure(null);
    setAnswered(null);
  }

  useEffect(() => {
    if (view === null || publicKey === null) {
      return;
    }
    let live = true;
    readWallet(connection, view, publicKey).then(
      (next) => {
        if (live) {
          setStanding(next);
          setStandingFailure(null);
        }
      },
      (error: unknown) => {
        if (live) {
          setStandingFailure(messageOf(error));
        }
      }
    );
    return () => {
      live = false;
    };
  }, [connection, view, publicKey, reload]);

  const hasRecord = standing !== null && standing.record !== null;

  useEffect(() => {
    if (view === null || publicKey === null || sale.accessMode !== ACCESS_MODE.verifierCredential || rulesOff || standing === null) {
      return;
    }
    let live = true;
    credentialStanding(connection, view, publicKey, hasRecord).then(
      (next) => live && setCredential(next),
      () => live && setCredential(null)
    );
    return () => {
      live = false;
    };
  }, [connection, view, publicKey, sale.accessMode, rulesOff, hasRecord, standing]);

  // The band's price, and one ask of the server to bring it up to date when it
  // has aged out. Once a page load: after that only the button asks again.
  const refreshTried = useRef(false);
  const askRefresh = useCallback(() => {
    setRefresh({ state: "running" });
    fetch("/api/price/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mint: sale.mint }),
      cache: "no-store",
    })
      .then(async (answer) => {
        const body = (await answer.json().catch(() => null)) as {
          status?: string;
          lastPublishedAt?: number;
          reason?: string;
        } | null;
        if (body?.status === "closed" && typeof body.lastPublishedAt === "number") {
          setRefresh({ state: "closed", lastPublishedAt: body.lastPublishedAt, askedAt: Date.now() });
          return;
        }
        if (body?.status === "posted" || body?.status === "fresh" || body?.status === "limited") {
          setRefresh({ state: "done" });
          onMarketMoved();
          return;
        }
        setRefresh({ state: "failed", reason: body?.reason ?? "The server could not bring the price up to date." });
      })
      .catch(() =>
        setRefresh({
          state: "failed",
          reason: "This page could not reach its own server. Check the connection and press it again.",
        })
      );
  }, [sale.mint, onMarketMoved]);

  useEffect(() => {
    if (view === null || !sale.hasBand) {
      return;
    }
    let live = true;
    readBandPrice(connection, view).then(
      (reading) => {
        if (!live) {
          return;
        }
        setPrice(reading);
        if (reading !== null && reading.error === "PriceStale" && !rulesOff && !refreshTried.current) {
          refreshTried.current = true;
          askRefresh();
        }
      },
      () => live && setPrice(null)
    );
    return () => {
      live = false;
    };
  }, [connection, view, sale.hasBand, rulesOff, askRefresh]);

  const decimalsNow = mode === "sell" || unit === "shares" ? baseDecimals : quoteDecimals;
  const amount = useMemo(() => parseAmount(typed, decimalsNow), [typed, decimalsNow]);

  const quote = useMemo(() => {
    if (view === null || amount === null) {
      return null;
    }
    try {
      if (mode === "sell") {
        return { ok: true as const, shares: amount, pays: quoteSell(view, amount) };
      }
      const got = quoteBuy(view, amount, unit);
      return { ok: true as const, ...got };
    } catch (error) {
      return { ok: false as const, message: messageOf(error) };
    }
  }, [view, amount, mode, unit]);

  // The rules' answer, asked a moment after typing stops. Each answer carries
  // the buy it was asked about, so until the newest one lands the line says it
  // is asking rather than showing the answer to an older amount.
  const buyShares = mode === "buy" && quote !== null && quote.ok ? quote.shares : null;
  const checkable =
    publicKey !== null && buyShares !== null && buyShares > 0n && !rulesOff && standing !== null;
  const checkKey = checkable
    ? `${publicKey.toBase58()}:${buyShares.toString()}:${standing.record === null ? "new" : standing.record.netBought.toString()}`
    : null;
  useEffect(() => {
    if (checkKey === null || publicKey === null || buyShares === null || standing === null) {
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      preflight(connection, mint, publicKey, buyShares, standing.record !== null).then(
        (answer) => live && setAnswered({ key: checkKey, check: { state: "answer", preflight: answer } }),
        (error: unknown) =>
          live && setAnswered({ key: checkKey, check: { state: "failed", message: messageOf(error) } })
      );
    }, CHECK_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [connection, mint, publicKey, buyShares, standing, checkKey]);
  const check: Check =
    checkKey === null
      ? { state: "idle" }
      : answered !== null && answered.key === checkKey
        ? answered.check
        : { state: "checking" };

  const capRoomText = standing === null ? "" : tokenAmount(standing.capRoom, baseDecimals);
  const advise = useCallback(
    (error: Parameters<typeof whatToDo>[0]) =>
      whatToDo(error, { issuer: sale.issuer, capRoom: capRoomText, symbol, accessMode: sale.accessMode }),
    [sale.issuer, sale.accessMode, capRoomText, symbol]
  );

  const afterLanding = (landed: boolean) => {
    if (landed) {
      setTyped("");
      setReload((count) => count + 1);
      onMarketMoved();
    }
  };

  const buy = async () => {
    if (publicKey === null || quote === null || !quote.ok) {
      return;
    }
    const pays = quote.pays;
    afterLanding(
      await run(async () => {
        const built = await buildBuy(connection, publicKey, mint, pays);
        return [{ transaction: built.transaction, signers: [] }];
      }, advise)
    );
  };

  const sell = async () => {
    if (publicKey === null || amount === null) {
      return;
    }
    const part = amount;
    afterLanding(
      await run(async () => {
        const built = await buildSell(connection, publicKey, mint, part);
        return [{ transaction: built.transaction, signers: [] }];
      }, advise)
    );
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setTyped("");
    reset();
  };

  const switchUnit = (next: Unit) => {
    if (next === unit) {
      return;
    }
    // The amount carries over at the quote, so flipping the unit does not change the buy.
    if (quote !== null && quote.ok) {
      setTyped(next === "shares" ? amountText(quote.shares, baseDecimals) : amountText(quote.pays, quoteDecimals));
    }
    setUnit(next);
  };

  const running = busy(step);
  const shortOfPaying =
    mode === "buy" && standing !== null && quote !== null && quote.ok && quote.pays > standing.paying;
  const overHolding = mode === "sell" && standing !== null && amount !== null && amount > standing.shares;
  const refusedNow = check.state === "answer" && !check.preflight.ok;

  const canAct =
    publicKey !== null &&
    view !== null &&
    amount !== null &&
    quote !== null &&
    quote.ok &&
    !running &&
    !shortOfPaying &&
    !overHolding &&
    (mode === "sell" || !refusedNow);

  return (
    <div data-testid="trade-panel" className="border-t border-ink pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="tablist" aria-label="Buy or sell" className="inline-flex rounded-lg border border-line p-1">
          {(["buy", "sell"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={mode === option}
              data-testid={`trade-mode-${option}`}
              onClick={() => switchMode(option)}
              className={`relative h-9 rounded-md px-5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
                mode === option ? "text-accent-ink" : "text-muted hover:text-ink"
              }`}
            >
              {mode === option && (
                <motion.span
                  layoutId="trade-mode"
                  className="absolute inset-0 rounded-md bg-accent"
                  transition={still ? { duration: 0 } : { duration: 0.35, ease: EASE }}
                />
              )}
              <span className="relative">{option}</span>
            </button>
          ))}
        </div>
        <WalletButton />
      </div>

      {rulesOff && sale.endsAt !== null && (
        <p data-testid="trade-offering-over" className="mt-8 max-w-[52ch] border-l-2 border-accent pl-4 text-[15px] leading-relaxed">
          {`The offering ended on ${utcDay(sale.endsAt * 1000)}: the rules have lifted, this token trades freely.`}
        </p>
      )}

      {mode === "buy" && !rulesOff && (
        <AccessNote sale={sale} standing={standing} credential={credential} connected={publicKey !== null} />
      )}

      {mode === "buy" && sale.hasBand && !rulesOff && (
        <PriceLine price={price} refresh={refresh} feedName={feed.fresh} onRefresh={askRefresh} />
      )}

      {mode === "sell" && (
        <p className="mt-8 max-w-[52ch] border-l-2 border-accent pl-4 text-[15px] leading-relaxed">
          Selling back is never blocked by the rules: no list, no price and no cap is
          checked on the way out.
        </p>
      )}

      <div className="mt-8">
        <div className="flex items-end justify-between gap-4">
          <label htmlFor="trade-amount" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            {mode === "sell" ? `${symbol} to sell back` : unit === "shares" ? `${symbol} to buy` : `${inSol ? "SOL" : "dollars"} to spend`}
          </label>
          {mode === "buy" ? (
            <div className="inline-flex gap-1 font-mono text-[10px] uppercase tracking-[0.14em]">
              {(["shares", "paying"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  data-testid={`trade-unit-${option}`}
                  onClick={() => switchUnit(option)}
                  aria-pressed={unit === option}
                  className={`rounded-md border px-2.5 py-1.5 transition-colors ${
                    unit === option ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {option === "shares" ? "in shares" : inSol ? "in SOL" : "in dollars"}
                </button>
              ))}
            </div>
          ) : (
            standing !== null &&
            standing.shares > 0n && (
              <button
                type="button"
                data-testid="trade-sell-all"
                onClick={() => setTyped(amountText(standing.shares, baseDecimals))}
                className="rounded-md border border-line px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-accent hover:text-ink"
              >
                all
              </button>
            )
          )}
        </div>
        <input
          id="trade-amount"
          data-testid="trade-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            if (!running) {
              reset();
            }
          }}
          className={`${FIELD} mt-3`}
        />

        <div className="mt-4 min-h-[1.5rem] text-[14px] leading-relaxed" data-testid="trade-quote">
          {typed.trim() !== "" && amount === null ? (
            <span className="text-refused">{`Type a number above zero, with at most ${decimalsNow} decimals.`}</span>
          ) : quote === null ? (
            view === null ? (
              <span className="text-muted">Reading the pool on devnet.</span>
            ) : null
          ) : !quote.ok ? (
            <span className="text-refused">{quote.message}</span>
          ) : mode === "sell" ? (
            <span>{`Selling ${shares(quote.shares)} returns about ${paying(quote.pays)}.`}</span>
          ) : (
            <span>{`About ${shares(quote.shares)} for ${paying(quote.pays)}, fee included, at the pool's price now.`}</span>
          )}
        </div>

        <Holding
          standing={standing}
          failure={standingFailure}
          connected={publicKey !== null}
          shares={shares}
          paying={paying}
          mode={mode}
          rulesOff={rulesOff}
        />

        {mode === "buy" && !rulesOff && (
          <CheckLine
            check={check}
            advise={advise}
            shortOfPaying={shortOfPaying}
            connected={publicKey !== null}
          />
        )}
        {overHolding && (
          <p className="mt-3 text-[14px] text-refused">This wallet does not hold that many to sell.</p>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            data-testid={mode === "buy" ? "trade-buy" : "trade-sell"}
            disabled={!canAct}
            onClick={mode === "buy" ? buy : sell}
            className={PRIMARY}
          >
            {running && <Spinner />}
            {mode === "buy"
              ? quote !== null && quote.ok
                ? `Buy ${shares(quote.shares)}`
                : "Buy"
              : amount !== null
                ? `Sell ${shares(amount)}`
                : "Sell"}
            <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
              &rarr;
            </span>
          </button>
          {publicKey === null && (
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
              connect a devnet wallet first
            </span>
          )}
        </div>

        <ActionStatus
          step={step}
          testId="trade-status"
          landedLine={mode === "buy" ? "The buy landed on devnet." : "The sell landed on devnet."}
        />

        {wallet !== null && (
          <Funding
            sale={sale}
            connection={connection}
            wallet={wallet}
            onFunded={() => setReload((count) => count + 1)}
          />
        )}
      </div>
    </div>
  );
}

/** Who may buy, said before the amount, with this wallet's own answer. */
function AccessNote({
  sale,
  standing,
  credential,
  connected,
}: {
  sale: DirectorySale;
  standing: WalletStanding | null;
  credential: CredentialStanding | null;
  connected: boolean;
}) {
  if (sale.accessMode === ACCESS_MODE.issuerList) {
    const approved = standing?.record?.approved === true;
    return (
      <div data-testid="trade-access" className="mt-8 max-w-[56ch] border-l-2 pl-4 text-[15px] leading-relaxed" style={{ borderColor: approved ? "var(--accent)" : "var(--pending)" }}>
        {!connected ? (
          <p>This sale sells only to wallets the issuer approved. Connect a wallet to see whether yours is on the list.</p>
        ) : standing === null ? (
          <p className="text-muted">Reading whether your wallet is on the issuer&apos;s list.</p>
        ) : approved ? (
          <p>Your wallet is on the issuer&apos;s list, so the rules let it buy up to the cap.</p>
        ) : (
          <>
            <p>This sale sells only to wallets the issuer approved. Yours is not on the list: ask the issuer.</p>
            <a
              href={explorerAddress(sale.issuer)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block break-all font-mono text-[12px] text-muted transition-colors hover:text-accent"
            >
              {sale.issuer}
            </a>
          </>
        )}
      </div>
    );
  }

  if (sale.accessMode === ACCESS_MODE.verifierCredential) {
    return (
      <div
        data-testid="trade-access"
        className="mt-8 max-w-[56ch] border-l-2 pl-4 text-[15px] leading-relaxed"
        style={{ borderColor: credential?.valid === true ? "var(--accent)" : "var(--pending)" }}
      >
        <p>
          {`This sale sells only to wallets carrying an approval from its verifier${
            credential?.verifierName ? `, ${credential.verifierName}` : ""
          }.`}
        </p>
        {credential !== null && (
          <dl className="mt-3 grid gap-1 font-mono text-[11px] text-muted">
            <div className="flex gap-2">
              <dt>verifier</dt>
              <dd className="break-all">
                <a href={explorerAddress(credential.credential)} target="_blank" rel="noreferrer" className="transition-colors hover:text-accent">
                  {credential.credential}
                </a>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt>schema</dt>
              <dd className="break-all">
                <a href={explorerAddress(credential.schema)} target="_blank" rel="noreferrer" className="transition-colors hover:text-accent">
                  {credential.schema}
                </a>
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-3">
          {!connected
            ? "Connect a wallet to see whether it holds a valid approval."
            : credential === null
              ? "Reading your wallet's approval on devnet."
              : credential.valid
                ? "Your wallet holds a valid approval from this verifier."
                : `${credential.sentence ?? ""} Ask the verifier to attest this wallet under the schema above, then come back.`}
        </p>
      </div>
    );
  }

  return null;
}

/** The band's price, and the one ask to bring it up to date when it is too old. */
function PriceLine({
  price,
  refresh,
  feedName,
  onRefresh,
}: {
  price: PriceReading | null;
  refresh: Refresh;
  feedName: string;
  onRefresh: () => void;
}) {
  if (refresh.state === "running") {
    return (
      <p className="mt-5 flex items-center gap-2.5 text-[14px] text-muted">
        <Spinner />
        {`The ${feedName} is too old to buy against. Asking the server to post a fresh one from Pyth, which takes up to a minute.`}
      </p>
    );
  }
  if (refresh.state === "closed") {
    return (
      <p className="mt-5 max-w-[56ch] text-[14px] leading-relaxed text-muted">
        {`Pyth has no newer ${feedName} since ${clock(refresh.lastPublishedAt * 1000, refresh.askedAt)}: the market is shut, so buying waits for it to open. Selling back is never touched by it.`}
      </p>
    );
  }
  if (price === null || price.usable) {
    return null;
  }
  return (
    <p className="mt-5 flex max-w-[56ch] flex-wrap items-center gap-x-3 gap-y-2 text-[14px] leading-relaxed text-muted">
      <span>
        {refresh.state === "failed" ? refresh.reason : `There is no fresh ${feedName} right now, so every buy is refused until one lands.`}
      </span>
      <button type="button" onClick={onRefresh} className={SMALL_BUTTON}>
        bring the price up to date
      </button>
    </p>
  );
}

function Holding({
  standing,
  failure,
  connected,
  shares,
  paying,
  mode,
  rulesOff,
}: {
  standing: WalletStanding | null;
  failure: string | null;
  connected: boolean;
  shares: (raw: bigint) => string;
  paying: (raw: bigint) => string;
  mode: Mode;
  rulesOff: boolean;
}) {
  if (!connected) {
    return null;
  }
  if (standing === null) {
    return (
      <p className="mt-2 text-[14px] text-muted" data-testid="trade-holding">
        {failure ?? "Reading your wallet on devnet."}
      </p>
    );
  }
  return (
    <p className="mt-2 text-[14px] leading-relaxed text-muted" data-testid="trade-holding">
      {mode === "buy" && !rulesOff
        ? `You hold ${shares(standing.shares)}, you may still buy ${shares(standing.capRoom)} under the cap. You have ${paying(standing.paying)} to spend.`
        : `You hold ${shares(standing.shares)}.`}
    </p>
  );
}

function CheckLine({
  check,
  advise,
  shortOfPaying,
  connected,
}: {
  check: Check;
  advise: (error: Parameters<typeof whatToDo>[0]) => string | null;
  shortOfPaying: boolean;
  connected: boolean;
}) {
  if (!connected || check.state === "idle") {
    return null;
  }
  return (
    <div data-testid="trade-check" className="mt-4 text-[14px] leading-relaxed">
      {check.state === "checking" && (
        <p className="flex items-center gap-2.5 text-muted">
          <Spinner />
          Asking the program&apos;s rules about this buy.
        </p>
      )}
      {check.state === "failed" && <p className="text-muted">{`The rules could not be asked: ${check.message}`}</p>}
      {check.state === "answer" &&
        (check.preflight.ok ? (
          <p data-verdict="pass">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-accent" />
            {shortOfPaying
              ? "The rules would take this buy, but this wallet does not hold enough to pay for it."
              : "The rules would take this buy right now. A pass is the chain as it stands, not a promise: the buy is checked again when it lands."}
          </p>
        ) : (
          <div data-verdict="refused">
            <p className="font-medium text-refused">{check.preflight.reason}</p>
            {advise(check.preflight.error) !== null && <p className="mt-1 text-muted">{advise(check.preflight.error)}</p>}
          </div>
        ))}
    </div>
  );
}

/** The devnet SOL faucet on a SOL sale, the demo dollars on a demo dollar sale. */
function Funding({
  sale,
  connection,
  wallet,
  onFunded,
}: {
  sale: DirectorySale;
  connection: Connection;
  wallet: string;
  onFunded: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<{ text: string; signature: string | null } | null>(null);

  const [noteFor, setNoteFor] = useState(wallet);
  if (noteFor !== wallet) {
    setNoteFor(wallet);
    setNote(null);
    setAsking(false);
  }

  const askDollars = async () => {
    setAsking(true);
    setNote(null);
    try {
      const response = await fetch("/api/break/dollars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      const answer = (await response.json().catch(() => null)) as {
        reason?: string;
        signature?: string;
        amount?: string;
        decimals?: number;
      } | null;
      if (!response.ok || answer?.signature === undefined) {
        setNote({ text: answer?.reason ?? "The demo dollar mint turned this down. Try again in a moment.", signature: null });
        return;
      }
      setNote({
        text: `${tokenAmount(BigInt(answer.amount ?? "0"), answer.decimals ?? 0)} demo dollars landed.`,
        signature: answer.signature,
      });
      onFunded();
    } catch {
      setNote({ text: "This page could not reach the demo dollar mint. Check the connection and press it again.", signature: null });
    } finally {
      setAsking(false);
    }
  };

  const askSol = async () => {
    setAsking(true);
    setNote(null);
    try {
      const { PublicKey } = await import("@solana/web3.js");
      const signature = await connection.requestAirdrop(new PublicKey(wallet), AIRDROP_SOL * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature, "confirmed");
      setNote({ text: `${AIRDROP_SOL} devnet SOL landed.`, signature });
      onFunded();
    } catch {
      setNote({
        text: "The devnet faucet turned this wallet down, which it does when an address has asked recently. Take some from faucet.solana.com instead.",
        signature: null,
      });
    } finally {
      setAsking(false);
    }
  };

  if (!sale.demoDollar && sale.money !== "SOL") {
    return null;
  }

  return (
    <div className="mt-10 border-t border-line pt-6">
      <div className="flex flex-wrap items-center gap-3">
        {sale.demoDollar ? (
          <button
            type="button"
            data-testid="trade-demo-dollars"
            onClick={askDollars}
            disabled={asking}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-accent px-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-accent transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent hover:text-accent-ink disabled:translate-y-0 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            {asking && <Spinner />}
            {asking ? "minting on devnet" : "get demo dollars"}
          </button>
        ) : (
          <>
            <button type="button" onClick={askSol} disabled={asking} className={SMALL_BUTTON}>
              {asking && <Spinner />}
              {asking ? "asking the faucet" : `take ${AIRDROP_SOL} devnet SOL`}
            </button>
            <a
              href="https://faucet.solana.com"
              target="_blank"
              rel="noreferrer"
              className="border-b border-line pb-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-accent hover:text-accent"
            >
              faucet.solana.com
            </a>
          </>
        )}
      </div>
      <p className="mt-3 max-w-[52ch] text-[13px] leading-relaxed text-muted">
        {sale.demoDollar
          ? "This sale is priced in a dollar token minted for the demo. The button hands your devnet wallet some, once an hour."
          : "This sale is priced in SOL. A devnet wallet with none can take some here."}
      </p>
      {note !== null && (
        <p className="mt-3 max-w-[52ch] text-[13px] leading-relaxed">
          {note.text}{" "}
          {note.signature !== null && (
            <a
              href={explorerTx(note.signature)}
              target="_blank"
              rel="noreferrer"
              className="border-b border-line pb-0.5 transition-colors hover:border-accent hover:text-accent"
            >
              open the transaction
            </a>
          )}
        </p>
      )}
    </div>
  );
}
