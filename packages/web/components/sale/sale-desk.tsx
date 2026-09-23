"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { explorerAddress, shortAddress, utcDay } from "@/components/readout/format";
import type { DirectorySale, SaleTermsWire } from "@/lib/directory";
import { messageOf, readMarket, tradeConnection } from "@/lib/trade";
import type { PoolView } from "pangu-sdk/dbc";

import { IssuerPanel } from "./issuer-panel";
import { TradePanel } from "./trade-panel";

const EASE = [0.22, 1, 0.36, 1] as const;
const MARKET_POLL_MS = 20_000;

/**
 * Everything a wallet does on this sale: the trade panel for anybody, and the
 * issuer's controls for the one wallet the rules name as issuer. The pool is
 * read here once and shared, so both panels quote off the same moment.
 */
export function SaleDesk({ sale, terms }: { sale: DirectorySale; terms: SaleTermsWire }) {
  const still = useReducedMotion() === true;
  const connection = useMemo(() => tradeConnection(), []);
  const mint = useMemo(() => new PublicKey(sale.mint), [sale.mint]);
  const { publicKey } = useWallet();
  const isIssuer = publicKey !== null && publicKey.toBase58() === sale.issuer;

  const [view, setView] = useState<PoolView | null>(null);
  const [marketFailure, setMarketFailure] = useState<string | null>(null);
  const ticket = useRef(0);
  const mounted = useRef(true);

  const reloadMarket = useCallback(() => {
    ticket.current += 1;
    const mine = ticket.current;
    readMarket(connection, mint).then(
      (next) => {
        if (mounted.current && ticket.current === mine) {
          setView(next);
          setMarketFailure(null);
        }
      },
      (error: unknown) => {
        if (mounted.current && ticket.current === mine) {
          setMarketFailure(messageOf(error));
        }
      }
    );
  }, [connection, mint]);

  useEffect(() => {
    mounted.current = true;
    reloadMarket();
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        reloadMarket();
      }
    }, MARKET_POLL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [reloadMarket]);

  return (
    <section
      id="trade"
      data-testid="sale-desk"
      className="relative isolate overflow-hidden border-t border-line px-[6vw] py-20 sm:py-28"
    >
      <motion.div
        initial={still ? false : { opacity: 0, y: 26 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={still ? { duration: 0 } : { duration: 0.8, ease: EASE }}
        className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"
      >
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            from your own wallet, on devnet
          </p>
          <h2 className="mt-5 max-w-[14ch] font-display text-[clamp(2.25rem,4.6vw,3.9rem)] font-semibold leading-[0.92] tracking-[-0.035em]">
            {sale.graduated ? "It trades freely now." : "Buy it. Sell it back."}
          </h2>
        </div>
        <p className="max-w-[40ch] text-[16px] leading-[1.5] text-muted">
          Every transaction is built by pangu-sdk and run against devnet first. Your
          wallet is only asked to sign what the chain would take.
        </p>
      </motion.div>

      {marketFailure !== null && view === null && (
        <p
          className="mt-12 max-w-[52ch] border-l-2 pl-5 text-[15px] leading-relaxed"
          style={{ borderColor: "var(--refused)" }}
        >
          {`The pool did not read: ${marketFailure} `}
          <button
            type="button"
            onClick={reloadMarket}
            className="ml-1 border-b border-line pb-0.5 text-ink transition-colors hover:border-accent hover:text-accent"
          >
            try again
          </button>
        </p>
      )}

      <div className="mt-12 grid gap-16 lg:mt-16 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-7">
          {sale.graduated ? (
            <Graduated sale={sale} />
          ) : (
            <TradePanel
              sale={sale}
              connection={connection}
              mint={mint}
              view={view}
              onMarketMoved={reloadMarket}
            />
          )}
        </div>

        <aside className="lg:col-span-5 lg:pl-8">
          {isIssuer ? (
            <IssuerPanel
              sale={sale}
              terms={terms}
              connection={connection}
              mint={mint}
              onMarketMoved={reloadMarket}
            />
          ) : (
            <IssuerNote sale={sale} />
          )}
        </aside>
      </div>
    </section>
  );
}

function Graduated({ sale }: { sale: DirectorySale }) {
  return (
    <div data-testid="sale-graduated" className="border-t border-ink pt-8">
      <p className="max-w-[34ch] font-display text-[clamp(1.4rem,2.6vw,2.1rem)] leading-[1.12] tracking-[-0.02em]">
        The curve filled and the sale graduated. Pangu came off the token, so there
        is nothing left to buy from the curve.
      </p>
      {sale.dammPool !== null ? (
        <a
          href={explorerAddress(sale.dammPool)}
          target="_blank"
          rel="noreferrer"
          className="group mt-8 inline-flex h-11 items-center gap-2 rounded-lg border border-accent bg-accent px-5 text-[14px] font-medium text-accent-ink transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          {`Its DAMM v2 pool, ${shortAddress(sale.dammPool)}`}
          <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
            &rarr;
          </span>
        </a>
      ) : (
        <p className="mt-6 max-w-[52ch] text-[15px] leading-relaxed text-muted">
          The move to DAMM v2 has not been sent yet. Anyone may send it; the issuer
          can from this page.
        </p>
      )}
    </div>
  );
}

/** What a visitor who is not the issuer sees where the issuer's controls would be. */
function IssuerNote({ sale }: { sale: DirectorySale }) {
  return (
    <div className="border-t border-line pt-8 text-[14px] leading-relaxed text-muted">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em]">the issuer</p>
      <a
        href={explorerAddress(sale.issuer)}
        target="_blank"
        rel="noreferrer"
        className="mt-3 block break-all font-mono text-[13px] text-ink transition-colors hover:text-accent"
      >
        {sale.issuer}
      </a>
      <p className="mt-4 max-w-[44ch]">
        {sale.accessMode === 1
          ? "This wallet approves who may buy, claims the trading fees and moves the curve to DAMM v2 once it fills. Connect it here and those controls appear."
          : "This wallet claims the trading fees and moves the curve to DAMM v2 once it fills. Connect it here and those controls appear."}
      </p>
      {sale.endsAt !== null && (
        <p className="mt-4 max-w-[44ch]">
          {sale.offeringOver
            ? `The offering ended on ${utcDay(sale.endsAt * 1000)}.`
            : `The offering ends on ${utcDay(sale.endsAt * 1000)}, and every rule lifts then.`}
        </p>
      )}
    </div>
  );
}
