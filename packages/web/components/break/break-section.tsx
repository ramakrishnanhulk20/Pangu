"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ATTACKS,
  breakConnection,
  buildAttack,
  payingHeld,
  payingNeeded,
  readLanded,
  simulateAttack,
  targetFromWire,
  type Attack,
  type AttackId,
  type AttackResult,

  type Target,
  type TargetReading,
} from "@/lib/break";
import { utcDay, utcMoment } from "@/components/readout/format";
import { tokenAmount } from "@/lib/format";

import { AttackRow, IDLE, STOPPED, Tags, asExpected, type RowState } from "./attack-row";
import { Reveal, Spinner } from "./strike";
import { Tally } from "./tally";
import { WalletStrip } from "./wallet-strip";

type Mode = "simulate" | "send";

type Rows = Partial<Record<string, RowState>>;

const POLL_MS = 15_000;
const RETRY_MS = 5_000;

const UNREACHABLE =
  "This page could not reach its own server to read the sale. Check the connection, then press try again.";

/**
 * The whole "Try to break it" ledger.
 *
 * Every number on it is read off devnet and every row is a real transaction
 * built by pangu-sdk. Simulating is the default, so a wallet is never asked to
 * sign something meant to fail; sending for real is a deliberate switch, and it
 * is what leaves a refusal on chain with a signature anybody can open.
 */
export function BreakSection({ id = "try-to-break-it" }: { id?: string }) {
  // Its own paced connection, not the wallet adapter's: building nine attacks
  // reads a hundred accounts and the public devnet node rate limits bursts.
  // Only a connected wallet's own work goes through it.
  const connection = useMemo(() => breakConnection(), []);
  const { connection: walletConnection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [target, setTarget] = useState<Target | null>(null);
  const [reading, setReading] = useState(true);
  const [readFailure, setReadFailure] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [rows, setRows] = useState<Rows>({});
  const [mode, setMode] = useState<Mode>("simulate");
  const [lamports, setLamports] = useState<number | null>(null);
  const [payingRaw, setPayingRaw] = useState<bigint | null>(null);

  // Bumped after a transaction really lands, so the sale and the wallet are
  // read again. The reads themselves live in effects and only ever set state
  // from the promise's own callback.
  const [reload, setReload] = useState(0);

  const wallet = publicKey === null ? null : publicKey.toBase58();

  // Everything on the ledger belongs to one wallet. When the wallet changes or
  // disconnects, its rows, its tally and its balances go with it, and a row
  // still running for the old wallet ends as stopped so it is never counted
  // for the new one.
  const [ledgerFor, setLedgerFor] = useState(wallet);
  if (ledgerFor !== wallet) {
    setLedgerFor(wallet);
    setRows((current) => stopRunning(current));
    setLamports(null);
    setPayingRaw(null);
  }

  // Bumped on every change of wallet, so a run can tell after each await whether
  // the wallet it started under is still the one on screen. A count rather than
  // the address, so switching away and back still stops the old run.
  const walletTurn = useRef(0);
  useEffect(() => {
    walletTurn.current += 1;
  }, [wallet]);

  // The latest run of each row. An older run finishing late never overwrites it.
  const latestRun = useRef(new Map<AttackId, number>());

  // The sale on screen, beside the state, so a failed read can tell whether
  // there are real facts to keep. Every read takes a ticket and only the
  // newest may change the screen.
  const shown = useRef<Target | null>(null);
  const ticket = useRef(0);
  const mounted = useRef(true);
  const retryTimer = useRef<number | null>(null);

  const readSale = useCallback((first: boolean) => {
    // Named inside, so the retry can call it again after five seconds.
    const attempt = (automatic: boolean) => {
      ticket.current += 1;
      const mine = ticket.current;
      const newest = () => mounted.current && ticket.current === mine;
      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }

      const failed = (sentence: string, retryable: boolean) => {
        setReading(false);
        // A missed poll leaves the facts already on screen where they are.
        if (retryable && shown.current !== null) {
          return;
        }
        if (!retryable) {
          shown.current = null;
          setTarget(null);
        }
        setCanRetry(true);
        if (retryable && !automatic) {
          setReadFailure(`${sentence} This ledger also tries once more by itself in 5 seconds.`);
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null;
            attempt(true);
          }, RETRY_MS);
          return;
        }
        setReadFailure(sentence);
      };

      fetch("/api/break/sale", { cache: "no-store" })
        .then(async (answer) => {
          if (!answer.ok) {
            throw new Error(`the server answered ${answer.status}`);
          }
          return (await answer.json()) as TargetReading;
        })
        .then(
          (answer) => {
            if (!newest()) {
              return;
            }
            if (answer.target === null) {
              failed(answer.failure ?? UNREACHABLE, answer.unanswered);
              return;
            }
            const next = targetFromWire(answer.target);
            shown.current = next;
            setTarget(next);
            setReadFailure(null);
            setCanRetry(false);
            setReading(false);
          },
          () => {
            if (newest()) {
              failed(UNREACHABLE, true);
            }
          }
        );
    };
    attempt(first);
  }, []);

  const tryAgain = () => {
    setReading(true);
    setReadFailure(null);
    setCanRetry(false);
    readSale(false);
  };

  useEffect(() => {
    mounted.current = true;
    readSale(false);
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        readSale(true);
      }
    }, POLL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current);
      }
    };
  }, [readSale]);

  // A transaction that landed, or a wallet just funded, moves the sale's own
  // numbers, so the sale is read again straight away.
  useEffect(() => {
    if (reload > 0) {
      readSale(true);
    }
  }, [reload, readSale]);

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
    const startedUnder = walletTurn.current;
    const turn = (latestRun.current.get(attack.id) ?? 0) + 1;
    latestRun.current.set(attack.id, turn);

    // Writes the row only while this is its latest run and the wallet has not
    // changed. Returns false when the run should stop.
    const settle = (state: RowState): boolean => {
      if (latestRun.current.get(attack.id) !== turn) {
        return false;
      }
      if (walletTurn.current !== startedUnder) {
        setRow(attack, STOPPED);
        return false;
      }
      setRow(attack, state);
      return true;
    };

    // A row that was sent but never read back is read again, never sent again:
    // the transaction is already on its way and a second send would be a
    // second attempt the visitor did not ask for.
    const before = rows[attack.id];
    if (before !== undefined && before.status === "unanswered" && before.signature !== null) {
      const signature = before.signature;
      settle({ ...before, status: "waiting" });
      try {
        const result = await readLanded(connection, signature);
        if (settle({ ...before, status: "done", result })) {
          setReload((count) => count + 1);
        }
      } catch {
        settle(before);
      }
      return;
    }

    settle({ ...IDLE, status: "building" });
    try {
      const built = await buildAttack(attack.id, { connection, target, wallet: publicKey });
      const promised = { expected: built.expected, shares: built.shares };
      if (!settle({ ...IDLE, ...promised, status: "waiting" })) {
        return;
      }

      if (mode === "simulate") {
        const result = await simulateAttack(connection, built);
        settle({ ...IDLE, ...promised, status: "done", result });
        return;
      }

      // Preflight is skipped on purpose: a refusal that is meant to be seen has
      // to land on chain, or there is no signature for anyone to open.
      const signature = await sendTransaction(built.transaction, walletConnection, {
        signers: built.signers,
        skipPreflight: true,
        maxRetries: 3,
      });
      if (!settle({ ...IDLE, ...promised, status: "waiting", signature })) {
        return;
      }
      let result: AttackResult;
      try {
        result = await readLanded(connection, signature);
      } catch {
        // Sent, but the node did not answer the read. The signature is kept so
        // the visitor can open it, and Run reads it again rather than resending.
        settle({ ...IDLE, ...promised, status: "unanswered", signature });
        return;
      }
      if (settle({ ...IDLE, ...promised, status: "done", result, signature })) {
        setReload((count) => count + 1);
      }
    } catch (error) {
      settle({ ...IDLE, status: "unavailable", message: messageOf(error) });
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

        <CapLine />

        <Reveal delay={0.1} className="mt-16 sm:mt-20">
          <SaleFacts
            target={target}
            reading={reading}
            failure={readFailure}
            onTryAgain={canRetry ? tryAgain : null}
          />
        </Reveal>

        <Reveal delay={0.05} className="mt-12">
          <ModeToggle mode={mode} onPick={setMode} />
        </Reveal>

        <ol className="mt-10 border-b border-line">
          {ATTACKS.map((attack, place) => (
            <Reveal key={attack.id} as="li" delay={Math.min(place * 0.04, 0.24)}>
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
            aria-pressed={mode === option.value}
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
  onTryAgain,
}: {
  target: Target | null;
  reading: boolean;
  failure: string | null;
  /** Set when the read failed and asking again may help. */
  onTryAgain: (() => void) | null;
}) {
  if (reading && target === null) {
    return (
      <p
        data-testid="break-reading"
        className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-pending"
      >
        <Spinner />
        reading the sale from devnet
      </p>
    );
  }
  if (target === null) {
    return (
      <div data-testid="break-failure" className="max-w-[62ch]">
        <p className="text-[15px] leading-relaxed text-muted">
          {failure ?? "No sale to attack right now. Come back once a sale opens."}
        </p>
        {onTryAgain !== null && (
          <button
            type="button"
            onClick={onTryAgain}
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink transition-all duration-200 hover:-translate-y-0.5 hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            try again
            <span aria-hidden="true">&rarr;</span>
          </button>
        )}
      </div>
    );
  }

  const facts: { label: string; value: string }[] = [
    { label: "the sale", value: target.name },
    { label: "who may buy", value: target.openAccess ? "anyone, under the cap" : "the issuer's list" },
    {
      label: "the cap, per wallet",
      value: `${tokenAmount(target.cap, target.baseDecimals)} shares`,
    },
    { label: "on the curve now", value: `$${target.curveDollars.toFixed(2)} a share` },
  ];
  if (target.ceilingDollars !== null) {
    facts.push({
      label: "the price ceiling",
      value: `$${target.ceilingDollars.toFixed(2)} a share`,
    });
  }
  if (target.stockDollars !== null) {
    facts.push({
      label: "the real stock, from Pyth",
      value: `$${target.stockDollars.toFixed(2)}`,
    });
  }
  facts.push({
    label: "the offering",
    value:
      target.endsAt === null
        ? "no end date"
        : target.offeringOver
          ? `over since ${utcDay(target.endsAt * 1000)}`
          : `ends ${utcMoment(target.endsAt * 1000)}`,
  });

  return (
    <div>
      <dl
        data-testid="break-facts"
        className="grid grid-cols-2 gap-x-8 gap-y-7 border-t border-line pt-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
      >
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
          {target.standingReason} <Tags names={[target.standingRefusal]} />
        </p>
      )}
    </div>
  );
}

/**
 * The cap line again, dotted, running the full width of the section in the
 * gap between the heading and the sale's facts. It sits in that gap rather
 * than at a fixed height of the section, so however tall the section grows at
 * any width, it never runs through a line of text.
 */
function CapLine() {
  return (
    <div aria-hidden="true" className="pointer-events-none relative">
      <div
        className="absolute left-1/2 top-8 h-[3px] w-screen -translate-x-1/2 opacity-50 sm:top-10"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--accent) 0 1px, transparent 1.4px)",
          backgroundSize: "10.5px 3px",
          filter: "var(--motif-glow)",
        }}
      />
    </div>
  );
}

/** The curve, faint, rising across the section behind the ledger. */
function CapMotif() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        className="h-full w-full"
        style={{ filter: "var(--motif-glow)" }}
      >
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

/** A row still running for the wallet that just left is stopped; every other row is cleared. */
function stopRunning(rows: Rows): Rows {
  const kept: Rows = {};
  for (const [id, state] of Object.entries(rows)) {
    if (state !== undefined && (state.status === "building" || state.status === "waiting")) {
      kept[id] = STOPPED;
    }
  }
  return kept;
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
