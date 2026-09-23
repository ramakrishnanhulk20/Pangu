"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { motion, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Spinner } from "@/components/break/strike";
import { clock, explorerAddress, money, shortAddress } from "@/components/readout/format";
import { DirectoryMotif } from "@/components/sales/directory-motif";
import { useLenis } from "@/components/smooth-scroll";
import { CHAIN } from "@/lib/network";
import type { Portfolio } from "@/lib/portfolio";

import { HoldingsLedger, LABEL } from "./holdings-ledger";
import { IssuedLedger } from "./issued-ledger";
import { totalUnit } from "./words";

// The wallet button reads the browser's injected wallets, so rendering it on
// the server would only produce markup the client replaces at once.
const WalletButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  { ssr: false, loading: () => <span className="block h-11 w-[160px] rounded-lg bg-raised" /> }
);

const EASE = [0.22, 1, 0.36, 1] as const;

// The route shares one read per wallet for fifteen seconds, so asking more often gains nothing.
const POLL_MS = 15_000;

const UNREACHABLE =
  "This page could not reach its own server to read your wallet. Check the connection, then press read again.";

type Answer =
  | { wallet: string; portfolio: Portfolio }
  | { wallet: string; failure: string };

const OUTLINE_BUTTON =
  "group inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-ink px-5 text-[14px] font-medium transition-all duration-200 hover:-translate-y-0.5 hover:border-accent hover:bg-accent hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

function Title({ wallet, still }: { wallet: string | null; still: boolean }) {
  const rise = (delay: number) => ({
    initial: still ? false : ({ opacity: 0, y: 40 } as const),
    animate: { opacity: 1, y: 0 },
    transition: still ? { duration: 0 } : { duration: 0.9, delay, ease: EASE },
  });

  return (
    <header className="mx-auto max-w-[1500px]">
      <motion.p {...rise(0)} className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {`your wallet, read off ${CHAIN.inSentence}`}
      </motion.p>
      <h1 className="-ml-[0.03em] mt-6 font-display text-[clamp(3rem,10vw,9rem)] font-semibold leading-[0.88] tracking-[-0.05em]">
        <span className="block overflow-hidden pb-[0.04em]">
          <motion.span {...rise(0.08)} className="block">
            What you
          </motion.span>
        </span>
        <span className="block overflow-hidden pb-[0.06em]">
          <motion.span {...rise(0.18)} className="block lg:pl-[8vw]">
            hold<span className="text-accent">.</span>
          </motion.span>
        </span>
      </h1>
      <motion.p {...rise(0.3)} className="mt-8 max-w-[44ch] text-[16px] leading-[1.55] text-muted lg:ml-[8vw]">
        Every Pangu sale this wallet bought into or was approved for, what the cap
        still lets it buy, and every sale it issued. Nothing here is stored by this
        app: it is all read from the chain.
        {wallet !== null && (
          <a
            href={explorerAddress(wallet)}
            target="_blank"
            rel="noreferrer"
            className="ml-2 font-mono text-[12px] text-ink transition-colors hover:text-accent"
          >
            {shortAddress(wallet)}
          </a>
        )}
      </motion.p>
    </header>
  );
}

/** The poster's credits line: how many sales, and what they are worth in each paying token. */
function Totals({ portfolio, still }: { portfolio: Portfolio; still: boolean }) {
  const cells: { big: string; label: string; note?: string }[] = [
    {
      big: String(portfolio.holdings.length).padStart(2, "0"),
      label: portfolio.holdings.length === 1 ? "sale you are in" : "sales you are in",
    },
    ...portfolio.totals.map((total) => ({
      big: money(total.value, total.money),
      label: totalUnit(total),
      note:
        total.unpriced > 0
          ? `${total.unpriced} ${total.unpriced === 1 ? "sale" : "sales"} not priced`
          : `across ${total.sales} ${total.sales === 1 ? "sale" : "sales"}`,
    })),
    {
      big: String(portfolio.issued.length).padStart(2, "0"),
      label: portfolio.issued.length === 1 ? "sale you issued" : "sales you issued",
    },
  ];

  return (
    <dl
      data-testid="portfolio-totals"
      className="mx-auto mt-16 grid max-w-[1500px] grid-cols-2 border-y border-ink sm:mt-24 lg:flex lg:flex-wrap"
    >
      {cells.map((cell, place) => (
        <motion.div
          key={`${cell.label}-${place}`}
          initial={still ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={still ? { duration: 0 } : { duration: 0.7, delay: 0.1 + place * 0.08, ease: EASE }}
          className="border-line px-2 py-6 odd:border-r sm:px-4 lg:min-w-[14rem] lg:flex-1 lg:border-r lg:py-8 lg:last:border-r-0"
        >
          <dt className={LABEL}>{cell.label}</dt>
          <dd className="mt-3 font-display text-[clamp(1.9rem,4.4vw,3.6rem)] font-semibold leading-none tracking-[-0.04em] tabular-nums">
            {cell.big}
          </dd>
          {cell.note !== undefined && <dd className="mt-2 text-[12px] text-muted">{cell.note}</dd>}
        </motion.div>
      ))}
    </dl>
  );
}

function SectionHead({ index, title, count, still }: { index: string; title: string; count: number; still: boolean }) {
  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={still ? { duration: 0 } : { duration: 0.8, ease: EASE }}
      className="flex items-end gap-5 border-b border-ink pb-5"
    >
      <span className="pb-1 font-mono text-[11px] tracking-[0.18em] text-accent">{index}</span>
      <h2 className="font-display text-[clamp(2.25rem,4.6vw,3.9rem)] font-semibold leading-[0.92] tracking-[-0.035em]">
        {title}
      </h2>
      <span className="ml-auto pb-1 font-mono text-[11px] tabular-nums text-muted">
        {String(count).padStart(2, "0")}
      </span>
    </motion.div>
  );
}

function Note({ children, tone = "line" }: { children: ReactNode; tone?: "line" | "refused" }) {
  return (
    <div
      className="mt-10 max-w-[56ch] border-l-2 pl-5 text-[16px] leading-relaxed"
      style={{ borderColor: tone === "refused" ? "var(--refused)" : "var(--line)" }}
    >
      {children}
    </div>
  );
}

/** Where to go when a wallet is in nothing yet. */
function EmptyLinks() {
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <Link href="/sales" className={OUTLINE_BUTTON}>
        See every sale
        <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
          &rarr;
        </span>
      </Link>
      <Link
        href="/launch"
        className="group inline-flex h-11 w-fit items-center gap-2 rounded-lg border border-line px-5 text-[14px] text-muted transition-all duration-200 hover:-translate-y-0.5 hover:border-ink hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        Launch a sale
        <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
          &rarr;
        </span>
      </Link>
    </div>
  );
}

function ConnectPrompt({ still }: { still: boolean }) {
  return (
    <motion.div
      data-testid="portfolio-connect"
      initial={still ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={still ? { duration: 0 } : { duration: 0.8, delay: 0.4, ease: EASE }}
      className="mx-auto mt-16 grid max-w-[1500px] gap-8 border-t border-ink pt-10 sm:mt-24 lg:grid-cols-12"
    >
      <p className="font-display text-[clamp(1.6rem,3vw,2.6rem)] font-semibold leading-[1.02] tracking-[-0.03em] lg:col-span-6">
        Connect a wallet and its sales line up here.
      </p>
      <div className="flex flex-col gap-5 lg:col-span-5 lg:col-start-8">
        <p className="max-w-[44ch] text-[16px] leading-relaxed text-muted">
          This page only reads. It never asks your wallet to sign anything. Buying,
          selling and the issuer&apos;s controls live on each sale&apos;s own page.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <WalletButton />
          <Link href="/sales" className="border-b border-line pb-0.5 text-[14px] text-muted transition-colors hover:border-accent hover:text-accent">
            or look at every sale first
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

function Reading({ wallet }: { wallet: string }) {
  return (
    <div data-testid="portfolio-reading" className="mx-auto mt-16 max-w-[1500px] sm:mt-24">
      <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-pending">
        <Spinner />
        {`reading every sale on ${CHAIN.inSentence} for ${shortAddress(wallet)}, up to half a minute when the list of sales is read fresh`}
      </p>
      <div aria-hidden="true" className="mt-8 border-t border-ink">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-6 border-b border-line px-4 py-8">
            <span className="h-3 w-6 animate-pulse rounded bg-raised" />
            <span className="h-7 w-[32%] animate-pulse rounded bg-raised" />
            <span className="ml-auto h-4 w-[20%] animate-pulse rounded bg-raised" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The connected wallet's portfolio: every sale it is in and every sale it
 * issued, read through the app's own server and read again every fifteen
 * seconds while the page is in view.
 */
export function PortfolioView() {
  const still = useReducedMotion() === true;
  const { publicKey, connecting } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;

  const [answer, setAnswer] = useState<Answer | null>(null);
  const [reading, setReading] = useState(false);
  const ticket = useRef(0);

  const read = useCallback((address: string) => {
    ticket.current += 1;
    const mine = ticket.current;
    setReading(true);
    fetch(`/api/portfolio/${address}`, { cache: "no-store" })
      .then(async (response): Promise<Answer> => {
        const body = (await response.json()) as Portfolio | { reason: string };
        if ("reason" in body) {
          return { wallet: address, failure: body.reason };
        }
        return body.failure === null
          ? { wallet: address, portfolio: body }
          : { wallet: address, failure: body.failure };
      })
      .catch((): Answer => ({ wallet: address, failure: UNREACHABLE }))
      .then((next) => {
        if (ticket.current !== mine) {
          return;
        }
        // A failed read never hides the last good one: it only says so.
        setAnswer((previous) =>
          "failure" in next && previous !== null && previous.wallet === address && "portfolio" in previous
            ? { wallet: address, portfolio: { ...previous.portfolio, stale: true } }
            : next
        );
        setReading(false);
      });
  }, []);

  useEffect(() => {
    if (wallet === null) {
      return;
    }
    const first = window.setTimeout(() => read(wallet), 0);
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        read(wallet);
      }
    }, POLL_MS);
    const onShow = () => {
      if (!document.hidden) {
        read(wallet);
      }
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [wallet, read]);

  const mine = answer !== null && answer.wallet === wallet ? answer : null;
  const portfolio = mine !== null && "portfolio" in mine ? mine.portfolio : null;
  const failure = mine !== null && "failure" in mine ? mine.failure : null;

  // Smooth scroll measures the page once, while it is still the short loading
  // state, and a wheel would otherwise stop there with the ledgers below out of
  // reach. It measures again whenever a reading changes what the page holds.
  const lenis = useLenis();
  useEffect(() => {
    lenis?.resize();
  }, [lenis, portfolio, failure]);

  return (
    <section className="grain relative isolate overflow-hidden px-[6vw] pb-28 pt-16 sm:pt-24">
      <DirectoryMotif count={portfolio?.holdings.length ?? 0} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[20%] top-[30%] -z-10 h-[520px] w-[520px] rounded-full opacity-[0.12] blur-[120px]"
        style={{ background: "var(--accent)" }}
      />

      <Title wallet={wallet} still={still} />

      {wallet === null ? (
        connecting ? (
          <p className="mx-auto mt-16 flex max-w-[1500px] items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-pending sm:mt-24">
            <Spinner />
            connecting your wallet
          </p>
        ) : (
          <ConnectPrompt still={still} />
        )
      ) : portfolio === null ? (
        failure === null ? (
          <Reading wallet={wallet} />
        ) : (
          <div className="mx-auto mt-16 max-w-[1500px] sm:mt-24">
            <Note tone="refused">
              <p>{failure}</p>
              <button
                type="button"
                onClick={() => read(wallet)}
                disabled={reading}
                className="mt-4 inline-flex h-9 items-center rounded-lg border border-line px-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
              >
                read again
              </button>
            </Note>
          </div>
        )
      ) : (
        <div data-testid="portfolio" data-wallet={portfolio.wallet}>
          <Totals portfolio={portfolio} still={still} />

          <div className="mx-auto mt-5 flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
            <p className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted" data-testid="portfolio-read-at">
              <span className={`inline-flex h-2 w-2 rounded-full ${reading || portfolio.stale ? "bg-pending" : "bg-accent"}`} />
              {reading
                ? `reading ${CHAIN.inSentence}`
                : `read ${clock(portfolio.readAt)}${portfolio.stale ? ", the latest read went unanswered" : ""}, again every 15 s`}
            </p>
            <button
              type="button"
              onClick={() => read(wallet)}
              disabled={reading}
              className="inline-flex h-9 items-center rounded-lg border border-line px-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted transition-colors duration-200 hover:border-ink hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              read again
            </button>
          </div>

          <div className="mx-auto mt-20 max-w-[1500px] sm:mt-28">
            <SectionHead index="01" title="Sales you are in" count={portfolio.holdings.length} still={still} />
            {portfolio.holdings.length === 0 ? (
              <div data-testid="portfolio-empty">
                <Note>
                  <p>
                    This wallet holds no Pangu sale token and has no buyer record in any
                    sale the program holds. Buy into a sale and it shows here within
                    fifteen seconds.
                  </p>
                  <EmptyLinks />
                </Note>
              </div>
            ) : (
              <HoldingsLedger holdings={portfolio.holdings} still={still} />
            )}
          </div>

          <div className="mx-auto mt-24 max-w-[1500px] sm:mt-32 lg:pl-[8vw]">
            <SectionHead index="02" title="Sales you issued" count={portfolio.issued.length} still={still} />
            {portfolio.issued.length === 0 ? (
              <Note>
                <p>This wallet has not opened a sale. The launch page opens one from this wallet, with its own rules.</p>
                <div className="mt-6">
                  <Link href="/launch" className={OUTLINE_BUTTON}>
                    Launch a sale
                    <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
                      &rarr;
                    </span>
                  </Link>
                </div>
              </Note>
            ) : (
              <IssuedLedger issued={portfolio.issued} still={still} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
