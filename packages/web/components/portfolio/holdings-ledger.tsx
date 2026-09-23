"use client";

import { motion } from "framer-motion";
import Link from "next/link";

import { explorerAddress, money, shortAddress } from "@/components/readout/format";
import { TokenLogo } from "@/components/token-logo";
import { tokenAmount } from "@/lib/format";
import type { Holding } from "@/lib/portfolio";

import { accessWords, noBuyReason, stateLine, type Tone } from "./words";

const EASE = [0.22, 1, 0.36, 1] as const;

export const LABEL = "font-mono text-[10px] uppercase tracking-[0.18em] text-muted";

const TONE: Record<Tone, string> = {
  accent: "bg-accent",
  pending: "bg-pending",
  refused: "bg-refused",
  muted: "bg-muted",
};

const ACTION =
  "group/action inline-flex h-9 items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-medium transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

const PRIMARY = `${ACTION} border-accent bg-accent text-accent-ink hover:shadow-[0_10px_26px_-12px_var(--accent)]`;
const SECONDARY = `${ACTION} border-line text-ink hover:border-ink`;

const QUIET_LINK =
  "border-b border-line pb-px text-muted transition-colors hover:border-accent hover:text-accent";

function Arrow() {
  return (
    <span aria-hidden="true" className="transition-transform duration-200 group-hover/action:translate-x-0.5">
      &rarr;
    </span>
  );
}

/** The token's logo beside its name, Pangu's curve in the same circle when it has none. */
export function SaleMark({ uri, name }: { uri: string | null; name: string }) {
  return (
    <TokenLogo
      uri={uri}
      name={name}
      size={40}
      className="mt-0.5 transition-transform duration-500 ease-out group-hover:scale-105"
    />
  );
}

/** Room left under one wallet's cap: the used part as a hairline that draws itself once in view. */
function CapRoom({ holding, still }: { holding: Holding; still: boolean }) {
  if (holding.graduated || holding.offeringOver) {
    return (
      <span className="block">
        No cap now
        <span className="mt-1 block text-[12px] text-muted">the rules lifted with the offering</span>
      </span>
    );
  }
  const cap = BigInt(holding.cap);
  const room = BigInt(holding.capRoom);
  if (cap === 0n) {
    return <span className="text-muted">cap not readable</span>;
  }
  const used = Number(((cap - room) * 10_000n) / cap) / 10_000;
  return (
    <span className="block" data-testid="portfolio-cap-room" data-room-raw={holding.capRoom}>
      <span className="tabular-nums text-ink">{`${tokenAmount(room, holding.baseDecimals)} left`}</span>
      <span className="text-muted">{` of ${tokenAmount(cap, holding.baseDecimals)}`}</span>
      <span className="relative mt-2 block h-px w-full bg-line">
        <motion.span
          className="absolute left-0 block origin-left bg-accent"
          style={{ width: `${Math.min(1, used) * 100}%`, height: 2, top: -0.5 }}
          initial={still ? false : { scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={still ? { duration: 0 } : { duration: 1.1, ease: EASE, delay: 0.25 }}
        />
      </span>
    </span>
  );
}

function Actions({ holding }: { holding: Holding }) {
  const page = `/sale/${holding.mint}#trade`;
  const held = BigInt(holding.held) > 0n;
  const reason = noBuyReason(holding);
  const freely = holding.graduated || holding.offeringOver;
  const poolLink = holding.graduated ? holding.dammPool : holding.pool;

  return (
    <div className="flex flex-col gap-3">
      {freely && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" data-testid="portfolio-freely">
          <span className="font-medium text-accent">Trades freely now</span>
          {poolLink !== null ? (
            <a href={explorerAddress(poolLink)} target="_blank" rel="noreferrer" className={QUIET_LINK}>
              {`${holding.graduated ? "DAMM v2 pool" : "the pool"} ${shortAddress(poolLink)}`}
            </a>
          ) : (
            <Link href={page} className={QUIET_LINK}>
              send the move to DAMM v2
            </Link>
          )}
        </p>
      )}
      {!holding.graduated && (reason === null || held) && (
        <div className="flex flex-wrap gap-2">
          {reason === null && (
            <Link href={page} className={PRIMARY} data-testid="portfolio-buy-more">
              Buy more
              <Arrow />
            </Link>
          )}
          {held && (
            <Link href={page} className={SECONDARY} data-testid="portfolio-sell-back">
              Sell back
              <Arrow />
            </Link>
          )}
        </div>
      )}
      {reason !== null && <p className="max-w-[32ch] text-[12px] leading-snug text-muted">{reason}</p>}
    </div>
  );
}

function Row({ holding, index, still }: { holding: Holding; index: number; still: boolean }) {
  const access = accessWords(holding);
  const state = stateLine(holding);
  const held = BigInt(holding.held);
  const priced = holding.graduated ? "at the curve's last price" : "at the curve's price now";

  return (
    <motion.li
      data-testid="portfolio-row"
      data-mint={holding.mint}
      data-held-raw={holding.held}
      data-net-bought-raw={holding.netBought}
      initial={still ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={still ? { duration: 0 } : { duration: 0.7, delay: Math.min(index, 8) * 0.06, ease: EASE }}
      className="group relative border-b border-line"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px] origin-top scale-y-0 bg-accent transition-transform duration-500 ease-out group-hover:scale-y-100"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-raised opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-6 px-2 py-7 sm:px-4 lg:grid-cols-[3rem_minmax(0,2.3fr)_minmax(0,1.6fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1.7fr)] lg:gap-x-6 lg:py-8">
        <span className="pt-2.5 font-mono text-[11px] tabular-nums text-muted">
          {String(index + 1).padStart(2, "0")}
        </span>

        <div className="flex min-w-0 gap-3.5">
          <SaleMark uri={holding.uri} name={holding.name} />
          <div className="min-w-0">
            <Link
              href={`/sale/${holding.mint}`}
              className="line-clamp-2 break-words font-display text-[clamp(1.35rem,2.1vw,1.8rem)] font-semibold leading-[1.05] tracking-[-0.025em] transition-colors duration-300 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              {holding.name}
            </Link>
            <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              {holding.symbol === "" ? shortAddress(holding.mint) : holding.symbol}
              {holding.retired && <span className="ml-3 text-refused">retired</span>}
            </p>
          </div>
        </div>

        <dl className="col-span-2 grid grid-cols-2 gap-x-6 gap-y-6 pl-[calc(2.5rem+1rem)] text-[14px] leading-snug sm:grid-cols-3 lg:contents">
          <div className="col-span-2 sm:col-span-1">
            <dt className={`${LABEL} lg:sr-only`}>you hold</dt>
            <dd className="mt-1.5 lg:mt-0">
              <span
                data-testid="portfolio-held"
                className="block font-display text-[clamp(1.6rem,2.3vw,2.1rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums"
              >
                {tokenAmount(held, holding.baseDecimals)}
                <span className="ml-1.5 font-body text-[13px] font-normal tracking-normal text-muted">shares</span>
              </span>
              <span className="mt-2 block text-[12px] text-muted" data-testid="portfolio-value">
                {holding.value === null ? "value not readable" : `${money(holding.value, holding.money)} ${priced}`}
              </span>
            </dd>
          </div>

          <div className="col-span-2 sm:col-span-1">
            <dt className={`${LABEL} lg:sr-only`}>room under your cap</dt>
            <dd className="mt-1.5 text-[13px] lg:mt-0">
              <CapRoom holding={holding} still={still} />
            </dd>
          </div>

          <div>
            <dt className={`${LABEL} lg:sr-only`}>may you buy</dt>
            <dd className="mt-1.5 flex items-center gap-2 lg:mt-0" data-testid="portfolio-access">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[access.tone]}`} />
              {access.word}
            </dd>
          </div>

          <div>
            <dt className={`${LABEL} lg:sr-only`}>state</dt>
            <dd className="mt-1.5 lg:mt-0">
              <span className="block font-medium">{state.word}</span>
              <span className="mt-1 block text-[12px] text-muted">{state.detail}</span>
            </dd>
          </div>

          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <dt className="sr-only">what you can do</dt>
            <dd>
              <Actions holding={holding} />
            </dd>
          </div>
        </dl>
      </div>
    </motion.li>
  );
}

const HEADINGS = ["no.", "sale", "you hold", "room under your cap", "may you buy", "state", ""];

/** Every sale this wallet is in, as a ruled ledger in the directory's own shape. */
export function HoldingsLedger({ holdings, still }: { holdings: Holding[]; still: boolean }) {
  return (
    <div data-testid="portfolio-holdings">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[3rem_minmax(0,2.3fr)_minmax(0,1.6fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1.7fr)] gap-x-6 border-b border-line px-4 py-3 lg:grid"
      >
        {HEADINGS.map((label, place) => (
          <span key={place} className={LABEL}>
            {label}
          </span>
        ))}
      </div>
      <ol className="relative">
        {holdings.map((holding, index) => (
          <Row key={holding.mint} holding={holding} index={index} still={still} />
        ))}
      </ol>
    </div>
  );
}
