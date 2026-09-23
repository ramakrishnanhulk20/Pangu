"use client";

import { PublicKey, type Connection } from "@solana/web3.js";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRef, useState } from "react";
import type { CredentialStanding } from "pangu-sdk";

import { checkWallet, parseWallets, shortKey, type SaleVerifier, type VerifierPair } from "@/lib/verify";

import { FIELD_CLASS, Failure, Label, PRIMARY_BUTTON, Seal } from "./bits";

/** A verifier the checker can ask about. */
interface Source {
  id: string;
  label: string;
  credential: PublicKey;
  schema: PublicKey;
}

const VERDICT: Record<CredentialStanding, { word: string; line: string }> = {
  valid: {
    word: "Verified",
    line: "This wallet holds a credential from this verifier that is in date. A sale that checks this verifier accepts it as a buyer, and holds it to the same cap as everyone.",
  },
  expired: {
    word: "Expired",
    line: "This wallet was verified, but the credential has run out. A sale refuses its buys until the verifier issues a new one.",
  },
  absent: {
    word: "Not verified",
    line: "This verifier holds no credential for this wallet: never issued, or revoked. A sale that checks this verifier refuses its buys.",
  },
};

/**
 * Anyone can use this: paste a wallet, pick a verifier, and read off devnet
 * whether a sale checking that verifier would let the wallet buy.
 */
export function Checker({
  connection,
  own,
  sales,
  salesReading,
}: {
  connection: Connection;
  own: VerifierPair | null;
  sales: readonly SaleVerifier[];
  salesReading: boolean;
}) {
  const still = useReducedMotion() === true;
  const sources: Source[] = [
    ...(own === null
      ? []
      : [{ id: "own", label: `yours, ${own.name}`, credential: own.credential, schema: own.schema }]),
    ...sales.map((sale) => ({
      id: `sale:${sale.symbol}:${sale.credential.toBase58()}`,
      label: `the one ${sale.name} checks`,
      credential: sale.credential,
      schema: sale.schema,
    })),
  ];

  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [answer, setAnswer] = useState<{
    standing: CredentialStanding;
    wallet: string;
    source: string;
    /** Which press of Check this answers, counted from one on each page load. */
    turn: number;
  } | null>(null);
  const latestTurn = useRef(0);
  const [trouble, setTrouble] = useState<string | null>(null);

  const source = sources.find((entry) => entry.id === picked) ?? sources[0] ?? null;
  const parsed = parseWallets(text);
  const lineProblem =
    text.trim() === ""
      ? null
      : parsed.length !== 1
        ? "Paste one wallet at a time."
        : parsed[0]?.problem ?? null;
  const target = parsed.length === 1 && parsed[0]?.key !== null ? (parsed[0]?.key as PublicKey) : null;

  const check = async () => {
    if (source === null || target === null) {
      return;
    }
    // Each press is a new turn. The last verdict leaves the screen at once, and
    // an answer that comes back after a newer press is dropped, so what is shown
    // is always the answer to the latest question.
    const turn = latestTurn.current + 1;
    latestTurn.current = turn;
    setAnswer(null);
    setChecking(true);
    setTrouble(null);
    try {
      const standing = await checkWallet(connection, source, target);
      if (latestTurn.current === turn) {
        setAnswer({ standing, wallet: target.toBase58(), source: source.label, turn });
      }
    } catch {
      if (latestTurn.current === turn) {
        setTrouble("Devnet did not answer. Check the connection and press again.");
      }
    } finally {
      if (latestTurn.current === turn) {
        setChecking(false);
      }
    }
  };

  return (
    <div
      data-testid="verify-checker"
      className="relative overflow-hidden rounded-lg border border-line bg-raised p-6 sm:p-8"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">open to anyone</p>
      <h2 className="mt-4 font-display text-[clamp(2rem,4vw,3.2rem)] font-semibold leading-[0.95] tracking-[-0.04em]">
        Check a wallet
      </h2>
      <p className="mt-4 max-w-[44ch] text-[15px] leading-relaxed text-muted">
        Paste a wallet and see whether it holds a valid credential from a verifier, read straight off devnet.
      </p>

      <form
        className="mt-7 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void check();
        }}
      >
        <div>
          <Label htmlFor="verify-check-source">verifier</Label>
          {sources.length === 0 ? (
            <p className="mt-2 text-[14px] text-muted">
              {salesReading
                ? "Reading the verifiers the live sales check."
                : "No verifier to check against yet. Set one up on the left."}
            </p>
          ) : (
            <select
              id="verify-check-source"
              data-testid="verify-check-source"
              value={source?.id ?? ""}
              onChange={(event) => setPicked(event.target.value)}
              className={`${FIELD_CLASS} mt-2 cursor-pointer`}
            >
              {sources.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}, {shortKey(entry.credential)}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <Label htmlFor="verify-check-wallet">wallet</Label>
          <input
            id="verify-check-wallet"
            data-testid="verify-check-wallet"
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="a Solana wallet address"
            className={`${FIELD_CLASS} mt-2 font-mono text-[13px]`}
            aria-invalid={lineProblem !== null}
          />
          {lineProblem !== null && <p className="mt-2 text-[13px] text-refused">{lineProblem}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <button
            type="submit"
            data-testid="verify-check-button"
            disabled={source === null || target === null || checking}
            className={PRIMARY_BUTTON}
          >
            Check
            <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
              &rarr;
            </span>
          </button>
        </div>
      </form>

      {trouble !== null && (
        <div className="mt-6">
          <Failure message={trouble} />
        </div>
      )}

      <AnimatePresence mode="wait">
        {checking && (
          <motion.div
            key="checking"
            data-testid="verify-check-pending"
            initial={still ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: still ? 0 : 0.2 }}
            className="mt-8 border-t border-line pt-6"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-pending">
              checking devnet
            </p>
          </motion.div>
        )}
        {answer !== null && (
          <motion.div
            key={`answer:${answer.turn}`}
            data-testid="verify-check-result"
            data-standing={answer.standing}
            data-wallet={answer.wallet}
            data-turn={answer.turn}
            initial={still ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: still ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 flex items-start gap-5 border-t border-line pt-6"
          >
            <div className="h-16 w-16 shrink-0">
              {answer.standing === "valid" ? (
                <Seal className="h-full w-full" />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-full w-full items-center justify-center rounded-full border border-dashed border-refused font-display text-[28px] leading-none text-refused"
                >
                  &times;
                </span>
              )}
            </div>
            <div>
              <p
                className={`font-display text-[clamp(1.8rem,3vw,2.4rem)] font-semibold leading-none tracking-[-0.035em] ${
                  answer.standing === "valid" ? "text-accent" : "text-refused"
                }`}
              >
                {VERDICT[answer.standing].word}
              </p>
              <p className="mt-2 font-mono text-[11px] text-muted">
                {shortKey(answer.wallet)}, against {answer.source}
              </p>
              <p className="mt-3 max-w-[44ch] text-[14px] leading-relaxed">{VERDICT[answer.standing].line}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
