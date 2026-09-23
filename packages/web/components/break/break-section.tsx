"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useMemo, useState } from "react";

import {
  ATTACKS,
  breakConnection,
  buildAttack,
  payingHeld,
  payingNeeded,
  readLanded,
  readTarget,
  simulateAttack,
  type Attack,
  type SaleCandidate,
  type Target,
} from "@/lib/break";
import { tokenAmount } from "@/lib/format";

import { AttackRow, IDLE, asExpected, type RowState } from "./attack-row";
import { Reveal } from "./strike";
import { Tally } from "./tally";
import { WalletStrip } from "./wallet-strip";

type Mode = "simulate" | "send";

type Rows = Partial<Record<string, RowState>>;

/**
 * The whole "Try to break it" ledger.
 *
 * Every number on it is read off devnet and every row is a real transaction
 * built by pangu-sdk. Simulating is the default, so a wallet is never asked to
 * sign something meant to fail; sending for real is a deliberate switch, and it
 * is what leaves a refusal on chain with a signature anybody can open.
 */
export function BreakSection({
  sales,
  id = "try-to-break-it",
}: {
  sales: SaleCandidate[];
  id?: string;
}) {
  // Its own paced connection, not the wallet adapter's: building nine attacks
  // reads a hundred accounts and the public devnet node rate limits bursts.
  const connection = useMemo(() => breakConnection(), []);
  const { connection: walletConnection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [target, setTarget] = useState<Target | null>(null);
  const [reading, setReading] = useState(true);
  const [readFailure, setReadFailure] = useState<string | null>(null);
  const [rows, setRows] = useState<Rows>({});
  const [mode, setMode] = useState<Mode>("simulate");
  const [lamports, setLamports] = useState<number | null>(null);
  const [payingRaw, setPayingRaw] = useState<bigint | null>(null);

  // Bumped after a transaction really lands, so the sale and the wallet are
  // read again. The reads themselves live in effects and only ever set state
  // from the promise's own callback.
  const [reload, setReload] = useState(0);

  const wallet = publicKey === null ? null : publicKey.toBase58();
  // The list of sales comes from the server and does not change while the page
  // is open, so it is taken once. Reading it every render would restart the
  // chain read on every keystroke of state above.
  const [candidates] = useState(sales);

  useEffect(() => {
    let alive = true;
    readTarget(connection, candidates).then(
      (found) => {
        if (!alive) {
          return;
        }
        setTarget(found);
        setReadFailure(
          found === null
            ? "No Pangu sale is running on devnet right now, so there are no rules left to attack. A sale that has graduated has had its hook removed by Meteora, which is the design."
            : null
        );
        setReading(false);
      },
      (error: unknown) => {
        if (!alive) {
          return;
        }
        setReadFailure(
          `Devnet did not answer, so this ledger has nothing real to show yet: ${messageOf(error)}`
        );
        setReading(false);
      }
    );
    return () => {
      alive = false;
    };
  }, [connection, candidates, reload]);

  useEffect(() => {
    if (publicKey === null || target === null) {
      return;
    }
    let alive = true;
    Promise.all([
      connection.getBalance(publicKey, "confirmed"),
      payingHeld(connection, target, publicKey),
    ]).then(
      ([sol, paying]) => {
        if (!alive) {
          return;
        }
        setLamports(sol);
        setPayingRaw(paying);
      },
      () => {
        // A missed read leaves the last real number on screen, never a guess.
      }
    );
    return () => {
      alive = false;
    };
  }, [connection, publicKey, target, reload]);

  const setRow = (attack: Attack, state: RowState) => {
    setRows((current) => ({ ...current, [attack.id]: state }));
  };

  const run = async (attack: Attack) => {
    if (publicKey === null || target === null) {
      return;
    }
    setRow(attack, { ...IDLE, status: "building" });
    try {
      const built = await buildAttack(attack.id, { connection, target, wallet: publicKey });
      const promised = { expected: built.expected, shares: built.shares };
      setRow(attack, { ...IDLE, ...promised, status: "waiting" });

      if (mode === "simulate") {
        const result = await simulateAttack(connection, built);
        setRow(attack, { ...promised, status: "done", result, message: null });
        return;
      }

      // Preflight is skipped on purpose: a refusal that is meant to be seen has
      // to land on chain, or there is no signature for anyone to open.
      const signature = await sendTransaction(built.transaction, walletConnection, {
        signers: built.signers,
        skipPreflight: true,
        maxRetries: 3,
      });
      const result = await readLanded(connection, signature);
      setRow(attack, { ...promised, status: "done", result, message: null });
      setReload((count) => count + 1);
    } catch (error) {
      setRow(attack, { ...IDLE, status: "unavailable", message: messageOf(error) });
    }
  };

  const counts = useMemo(() => {
    let run = 0;
    let refusedAsExpected = 0;
    let allowedAsExpected = 0;
    let off = 0;
    let unseen = 0;
    if (target !== null) {
      for (const attack of ATTACKS) {
        const state = rows[attack.id] ?? IDLE;
        if (state.status !== "done" || state.result === null) {
          continue;
        }
        run += 1;
        if (state.result.outcome === "unseen") {
          // Sent, but the chain has no record of it, so it proves nothing
          // either way and is counted apart.
          unseen += 1;
        } else if (!asExpected(attack, state)) {
          off += 1;
        } else if (state.result.outcome === "allowed") {
          allowedAsExpected += 1;
        } else {
          refusedAsExpected += 1;
        }
      }
    }
    return { run, refusedAsExpected, allowedAsExpected, off, unseen };
  }, [rows, target]);

  return (
    <section
      id={id}
      data-testid="break-section"
      className="grain relative isolate overflow-hidden border-t border-line"
    >
      <CapMotif />

      <div className="relative z-10 mx-auto w-full max-w-[1500px] px-[6vw] py-24 sm:py-32">
        <header className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-16">
          <div>
            <Reveal>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                the rules, from your own wallet
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="-ml-[0.02em] mt-6 font-display text-[clamp(3rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.045em]">
                Try to
                <br />
                break it
              </h2>
            </Reveal>
          </div>

          <Reveal delay={0.16}>
            <p className="max-w-[40ch] text-[17px] leading-[1.5]">
              Connect a devnet wallet and run the attacks yourself. Every refusal
              comes from the program, not from this page.
            </p>
            <div className="mt-8">
              <WalletStrip
                connection={connection}
                wallet={wallet}
                target={target}
                lamports={lamports}
                payingRaw={payingRaw}
                onFunded={() => setReload((count) => count + 1)}
              />
            </div>
          </Reveal>
        </header>

        <Reveal delay={0.1} className="mt-16 sm:mt-20">
          <SaleFacts target={target} reading={reading} failure={readFailure} />
        </Reveal>

        <Reveal delay={0.05} className="mt-12">
          <ModeToggle mode={mode} onPick={setMode} />
        </Reveal>

        <ol className="mt-10 border-b border-line">
          {ATTACKS.map((attack, place) => (
            <Reveal key={attack.id} delay={Math.min(place * 0.04, 0.24)}>
              <AttackRow
                attack={attack}
                target={target}
                state={rows[attack.id] ?? IDLE}
                connected={wallet !== null}
                ready={target !== null}
                payingShort={shortFor(attack, target, payingRaw)}
                onRun={() => void run(attack)}
              />
            </Reveal>
          ))}
        </ol>

        <Tally target={target} counts={counts} />
      </div>
    </section>
  );
}

function ModeToggle({ mode, onPick }: { mode: Mode; onPick: (mode: Mode) => void }) {
  const options: { value: Mode; label: string }[] = [
    { value: "simulate", label: "simulate" },
    { value: "send", label: "send for real" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="inline-flex rounded-lg border border-line p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onPick(option.value)}
            className={`rounded-md px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-200 ${
              mode === option.value
                ? "bg-accent text-accent-ink"
                : "text-muted hover:text-ink"
            } focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="max-w-[52ch] text-[13px] leading-relaxed text-muted">
        {mode === "simulate"
          ? "Simulating asks the chain what would happen, so your wallet is never asked to sign something meant to fail."
          : "Sending for real puts the refusal on chain, with a signature you can open in the explorer. Each one costs about 0.000005 SOL."}
      </p>
    </div>
  );
}

function SaleFacts({
  target,
  reading,
  failure,
}: {
  target: Target | null;
  reading: boolean;
  failure: string | null;
}) {
  if (reading) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        reading devnet
      </p>
    );
  }
  if (target === null) {
    return (
      <p className="max-w-[62ch] text-[15px] leading-relaxed text-muted">
        {failure ?? "No sale to attack right now."}
      </p>
    );
  }

  const facts: { label: string; value: string }[] = [
    { label: "the sale", value: `${target.name} (${target.symbol})` },
    { label: "who may buy", value: target.openAccess ? "anyone, under the cap" : "the issuer's list" },
    {
      label: "the cap, per wallet",
      value: `${tokenAmount(target.cap, target.baseDecimals)} shares`,
    },
    { label: "on the curve now", value: `$${target.curveDollars.toFixed(2)} a share` },
  ];
  if (target.ceilingDollars !== null) {
    facts.push({
      label: "the band's ceiling",
      value: `$${target.ceilingDollars.toFixed(2)} a share`,
    });
  }
  if (target.stockDollars !== null) {
    facts.push({
      label: "the real stock, from Pyth",
      value: `$${target.stockDollars.toFixed(2)}`,
    });
  }

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-7 border-t border-line pt-7 sm:grid-cols-3 lg:grid-cols-6">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="font-mono text-[10px] uppercase leading-none tracking-[0.18em] text-muted">
              {fact.label}
            </dt>
            <dd className="mt-2.5 text-[15px] leading-tight tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {target.standingReason !== null && (
        <p className="mt-7 max-w-[68ch] text-[14px] leading-relaxed text-muted">
          {target.standingReason}
        </p>
      )}
    </div>
  );
}

/** The cap line again, faint, running the width of the section behind the ledger. */
function CapMotif() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        className="h-full w-full"
        style={{ filter: "var(--motif-glow)" }}
      >
        <line
          x1={0}
          x2={1440}
          y1={188}
          y2={188}
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeDasharray="0.5 10"
          strokeLinecap="round"
          opacity={0.5}
        />
        <path
          d="M -40 880 C 300 866, 640 804, 880 620 C 1080 466, 1240 250, 1340 20"
          pathLength={1}
          fill="none"
          stroke="var(--motif-faint)"
          strokeWidth={2}
        />
      </svg>
    </div>
  );
}

/**
 * True when this row would spend more of the paying token than the wallet has.
 *
 * Only asked of a sale priced in the demo dollar: a sale priced in wrapped SOL
 * has the faucet for that, and a wallet that has not connected is told to
 * connect before anything else.
 */
function shortFor(attack: Attack, target: Target | null, payingRaw: bigint | null): boolean {
  if (target === null || target.payingInSol || payingRaw === null || !attack.needsPayingToken) {
    return false;
  }
  return payingRaw < payingNeeded(attack, target);
}

/** A thrown value as a sentence a visitor can act on. */
function messageOf(error: unknown): string {
  const text =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  if (/user rejected|request rejected|declined/i.test(text)) {
    return "You turned this down in your wallet, so nothing was sent.";
  }
  if (/429|rate limit/i.test(text)) {
    return "The public devnet node is rate limiting this browser. Wait a moment and run it again.";
  }
  return text;
}
