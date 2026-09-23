"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, type Connection } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ACCESS_MODE } from "pangu-sdk";

import { Reveal, Spinner } from "@/components/break/strike";
import { explorerAddress, shortAddress, utcMoment } from "@/components/readout/format";
import { ceilingWords, whoMayBuy } from "@/components/sales/words";
import type { DirectorySale, SaleTermsWire } from "@/lib/directory";
import { tokenAmount } from "@/lib/format";
import {
  approveTransactions,
  claimTransaction,
  graduateSignable,
  parseWallets,
  readIssuerView,
  revokeTransaction,
  type IssuerView,
} from "@/lib/issuer";
import { messageOf } from "@/lib/trade";

import { ActionStatus } from "./action-status";
import { busy, useChainAction } from "./use-chain-action";

const LABEL = "font-mono text-[10px] uppercase tracking-[0.18em] text-muted";

const BUTTON =
  "group inline-flex h-10 items-center gap-2 rounded-lg border border-ink px-4 text-[14px] font-medium transition-all duration-200 hover:-translate-y-0.5 hover:border-accent hover:bg-accent hover:text-accent-ink disabled:translate-y-0 disabled:opacity-40 disabled:hover:border-ink disabled:hover:bg-transparent disabled:hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

/**
 * The issuer's controls, shown only to the wallet the rules name as issuer: who
 * may buy, the trading fees, the move to DAMM v2, and the terms read back.
 * Every action is simulated on devnet first, then signed by that wallet.
 */
export function IssuerPanel({
  sale,
  terms,
  connection,
  mint,
  onMarketMoved,
}: {
  sale: DirectorySale;
  terms: SaleTermsWire;
  connection: Connection;
  mint: PublicKey;
  onMarketMoved: () => void;
}) {
  const { publicKey } = useWallet();
  const [view, setView] = useState<IssuerView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    readIssuerView(connection, mint).then(
      (next) => {
        if (live) {
          setView(next);
          setFailure(null);
        }
      },
      (error: unknown) => live && setFailure(messageOf(error))
    );
    return () => {
      live = false;
    };
  }, [connection, mint, reload]);

  const moved = useCallback(() => {
    setReload((count) => count + 1);
    onMarketMoved();
  }, [onMarketMoved]);

  const quoteDecimals = sale.quoteDecimals ?? 0;
  const paying = (raw: bigint) =>
    sale.money === "SOL" ? `${tokenAmount(raw, quoteDecimals)} SOL` : `$${tokenAmount(raw, quoteDecimals)}`;

  return (
    <div data-testid="issuer-panel" className="border-t border-accent pt-8">
      <p className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
        <span className="h-2 w-2 rounded-full bg-accent" />
        your sale: you are its issuer
      </p>

      {failure !== null && view === null && (
        <p className="mt-6 text-[14px] leading-relaxed text-refused">
          {`The sale's pool and records did not read: ${failure} `}
          <button
            type="button"
            onClick={() => setReload((count) => count + 1)}
            className="border-b border-line pb-0.5 text-ink transition-colors hover:border-accent hover:text-accent"
          >
            try again
          </button>
        </p>
      )}

      {sale.accessMode === ACCESS_MODE.issuerList && publicKey !== null && (
        <Reveal className="mt-10">
          <ApprovedList
            connection={connection}
            issuer={publicKey}
            mint={mint}
            approved={view?.approved ?? null}
            onChanged={moved}
          />
        </Reveal>
      )}

      <Reveal className="mt-12" delay={0.05}>
        <Fees
          connection={connection}
          mint={mint}
          view={view}
          wallet={publicKey?.toBase58() ?? null}
          paying={paying}
          onClaimed={moved}
        />
      </Reveal>

      {view !== null && view.curveComplete && !view.migrated && publicKey !== null && (
        <Reveal className="mt-12" delay={0.05}>
          <Graduate connection={connection} payer={publicKey} mint={mint} onMoved={moved} />
        </Reveal>
      )}

      <Reveal className="mt-12" delay={0.05}>
        <Terms sale={sale} terms={terms} />
      </Reveal>
    </div>
  );
}

function ApprovedList({
  connection,
  issuer,
  mint,
  approved,
  onChanged,
}: {
  connection: Connection;
  issuer: PublicKey;
  mint: PublicKey;
  approved: string[] | null;
  onChanged: () => void;
}) {
  const [pasted, setPasted] = useState("");
  const approve = useChainAction(connection);
  const revoke = useChainAction(connection);
  const [revoking, setRevoking] = useState<string | null>(null);

  const parsed = useMemo(() => parseWallets(pasted, approved ?? []), [pasted, approved]);
  const advise = (error: string | null) =>
    error === "NotIssuer" ? "Connect the wallet that opened this sale." : null;

  const sendApprovals = async () => {
    const wallets = parsed.wallets;
    const landed = await approve.run(() => approveTransactions(connection, issuer, mint, wallets), advise);
    if (landed) {
      setPasted("");
      onChanged();
    }
  };

  const sendRevoke = async (wallet: string) => {
    setRevoking(wallet);
    const landed = await revoke.run(
      async () => [await revokeTransaction(connection, issuer, mint, new PublicKey(wallet))],
      advise
    );
    if (landed) {
      onChanged();
    }
  };

  return (
    <div data-testid="issuer-approvals">
      <h3 className="font-display text-[24px] font-semibold tracking-[-0.02em]">Who may buy</h3>
      <p className="mt-2 max-w-[44ch] text-[14px] leading-relaxed text-muted">
        Paste one wallet or many, split by spaces, commas or new lines. Each is
        checked before anything is built. Approving opens the wallet&apos;s record,
        which costs you a small deposit the network keeps for the account.
      </p>

      <label htmlFor="issuer-paste" className={`${LABEL} mt-6 block`}>
        wallets to approve
      </label>
      <textarea
        id="issuer-paste"
        data-testid="issuer-paste"
        rows={3}
        value={pasted}
        onChange={(event) => {
          setPasted(event.target.value);
          if (!busy(approve.step)) {
            approve.reset();
          }
        }}
        placeholder="wallet addresses"
        className="mt-2 w-full resize-y rounded-lg border border-line bg-transparent px-4 py-3 font-mono text-[12px] leading-relaxed outline-none transition-colors placeholder:text-muted/60 hover:border-muted focus:border-accent"
      />
      {parsed.problems.length > 0 && (
        <ul className="mt-2 space-y-1 text-[13px] leading-snug text-refused">
          {parsed.problems.map((problem) => (
            <li key={problem} className="break-all">
              {problem}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        data-testid="issuer-approve"
        disabled={parsed.wallets.length === 0 || busy(approve.step)}
        onClick={sendApprovals}
        className={`${BUTTON} mt-4`}
      >
        {busy(approve.step) && <Spinner />}
        {parsed.wallets.length === 0
          ? "Approve"
          : `Approve ${parsed.wallets.length} ${parsed.wallets.length === 1 ? "wallet" : "wallets"}`}
      </button>
      <ActionStatus step={approve.step} testId="issuer-approve-status" landedLine="Approved on devnet." />

      <p className={`${LABEL} mt-8`}>
        {approved === null ? "reading the list" : `on the list now, ${approved.length}`}
      </p>
      {approved !== null && approved.length === 0 && (
        <p className="mt-2 text-[14px] text-muted">Nobody yet. Until you approve a wallet, every buy is refused.</p>
      )}
      {approved !== null && approved.length > 0 && (
        <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto border-y border-line" data-lenis-prevent>
          {approved.map((wallet) => (
            <li key={wallet} className="group flex items-center justify-between gap-3 py-2.5">
              <a
                href={explorerAddress(wallet)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[12px] transition-colors hover:text-accent"
              >
                <span className="hidden sm:inline">{wallet}</span>
                <span className="sm:hidden">{shortAddress(wallet)}</span>
              </a>
              <button
                type="button"
                onClick={() => sendRevoke(wallet)}
                disabled={busy(revoke.step)}
                className="shrink-0 rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-refused hover:text-refused disabled:opacity-40"
              >
                {busy(revoke.step) && revoking === wallet ? "revoking" : "revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {revoking !== null && (
        <ActionStatus
          step={revoke.step}
          landedLine={`${shortAddress(revoking)} is off the list. It can still sell what it holds.`}
        />
      )}
    </div>
  );
}

function Fees({
  connection,
  mint,
  view,
  wallet,
  paying,
  onClaimed,
}: {
  connection: Connection;
  mint: PublicKey;
  view: IssuerView | null;
  wallet: string | null;
  paying: (raw: bigint) => string;
  onClaimed: () => void;
}) {
  const creator = useChainAction(connection);
  const partner = useChainAction(connection);
  const isCreator = view !== null && wallet === view.creator;
  const isPartner = view !== null && wallet === view.feeClaimer;

  const claim = async (who: "creator" | "partner") => {
    const action = who === "creator" ? creator : partner;
    const landed = await action.run(async () => [await claimTransaction(connection, mint, who)], () => null);
    if (landed) {
      onClaimed();
    }
  };

  const row = (who: "creator" | "partner", amount: bigint, action: typeof creator, label: string) => (
    <div key={who} className="border-b border-line py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className={LABEL}>{label}</p>
          <p className="mt-1.5 font-display text-[26px] tabular-nums tracking-[-0.02em]" data-testid={`issuer-fees-${who}`}>
            {paying(amount)}
          </p>
        </div>
        <button
          type="button"
          data-testid={`issuer-claim-${who}`}
          disabled={amount === 0n || busy(action.step)}
          onClick={() => claim(who)}
          className={BUTTON}
        >
          {busy(action.step) && <Spinner />}
          {amount === 0n ? "nothing to claim yet" : "Claim"}
        </button>
      </div>
      <ActionStatus step={action.step} landedLine="The fees landed in your wallet." />
    </div>
  );

  return (
    <div data-testid="issuer-fees">
      <h3 className="font-display text-[24px] font-semibold tracking-[-0.02em]">Trading fees</h3>
      <p className="mt-2 max-w-[44ch] text-[14px] leading-relaxed text-muted">
        Every trade on the curve pays a fee in the paying token. The pool holds your
        share until you claim it, and it can only go to the wallet the pool names.
      </p>
      {view === null ? (
        <p className="mt-4 text-[14px] text-muted">Reading the pool on devnet.</p>
      ) : (
        <div className="mt-4 border-t border-line">
          {isCreator && row("creator", view.creatorFees, creator, "yours as the pool's creator")}
          {isPartner && row("partner", view.partnerFees, partner, "yours as the launch template's fee claimer")}
          {!isCreator && !isPartner && (
            <p className="py-4 text-[14px] text-muted">
              {`The fees go to the pool's creator, ${shortAddress(view.creator)}, and the template's fee claimer, ${shortAddress(view.feeClaimer)}. Neither is this wallet.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Graduate({
  connection,
  payer,
  mint,
  onMoved,
}: {
  connection: Connection;
  payer: PublicKey;
  mint: PublicKey;
  onMoved: () => void;
}) {
  const action = useChainAction(connection);
  const [pool, setPool] = useState<string | null>(null);

  const move = async () => {
    const landed = await action.run(async () => {
      const built = await graduateSignable(connection, payer, mint);
      setPool(built.dammPool);
      return [built];
    }, () => null);
    if (landed) {
      onMoved();
    }
  };

  return (
    <div data-testid="issuer-graduate">
      <h3 className="font-display text-[24px] font-semibold tracking-[-0.02em]">The curve is full</h3>
      <p className="mt-2 max-w-[44ch] text-[14px] leading-relaxed text-muted">
        Everything the curve raised moves into a DAMM v2 pool, where the token
        trades freely. Anyone may send this; the locked liquidity goes to the
        pool&apos;s creator whoever pays.
      </p>
      <button type="button" onClick={move} disabled={busy(action.step)} className={`${BUTTON} mt-5`}>
        {busy(action.step) && <Spinner />}
        Move the pool to DAMM v2
      </button>
      <ActionStatus
        step={action.step}
        landedLine={pool === null ? "The pool moved to DAMM v2." : `The pool moved to DAMM v2 at ${shortAddress(pool)}.`}
      />
    </div>
  );
}

function Terms({ sale, terms }: { sale: DirectorySale; terms: SaleTermsWire }) {
  const ceiling = ceilingWords(sale);
  const rows: [string, string][] = [
    ["cap on one wallet", `${tokenAmount(BigInt(terms.cap), sale.baseDecimals)} shares`],
    ["who may buy", whoMayBuy(sale.accessMode).long],
    ["price ceiling", ceiling === null ? "none" : ceiling],
  ];
  if (sale.hasBand) {
    rows.push(["oldest price it buys against", `${terms.maxPriceAgeSecs} seconds`]);
    rows.push(["widest price doubt", `${(terms.maxConfBps / 100).toFixed(2)}% of the price`]);
  }
  if (sale.accessMode === ACCESS_MODE.verifierCredential) {
    rows.push(["verifier", shortAddress(terms.credential)]);
    rows.push(["schema", shortAddress(terms.schema)]);
  }
  rows.push([
    "offering ends",
    sale.endsAt === null ? "no end date: the rules hold until graduation" : utcMoment(sale.endsAt * 1000),
  ]);
  rows.push(["paid in", sale.quoteMint === null ? "unknown" : `${sale.money === "SOL" ? "SOL" : "dollars"}, ${shortAddress(sale.quoteMint)}`]);

  return (
    <div data-testid="issuer-terms">
      <h3 className="font-display text-[24px] font-semibold tracking-[-0.02em]">The terms, read back</h3>
      <p className="mt-2 text-[14px] text-muted">Written once when the sale opened. Nobody can change them.</p>
      <dl className="mt-4 divide-y divide-line border-y border-line text-[14px]">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-4 py-2.5">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
