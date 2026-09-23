"use client";

import { motion, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Spinner } from "@/components/break/strike";
import { explorerTx, type Phase } from "@/lib/verify";
import { CHAIN } from "@/lib/network";

// The wallet button reads the browser's injected wallets, so rendering it on
// the server would only produce markup the client replaces at once.
export const WalletButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  { ssr: false, loading: () => <span className="block h-9 w-[132px] rounded-lg bg-raised" /> }
);

/** A step's number and title, the same shape the launch page uses. */
export function StepHead({
  index,
  title,
  done = false,
  children,
}: {
  index: string;
  title: string;
  done?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-line pb-4">
      <span className="font-mono text-[11px] tracking-[0.18em] text-accent">{index}</span>
      <h2 className="font-display text-[clamp(1.9rem,3.6vw,2.9rem)] font-semibold leading-none tracking-[-0.035em]">
        {title}
      </h2>
      {done && (
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">done</span>
      )}
      {children !== undefined && <div className="ml-auto">{children}</div>}
    </div>
  );
}

const PHASE_WORDS: Record<Phase, string> = {
  reading: `reading ${CHAIN.inSentence}`,
  simulating: "asking the chain first, nothing signed yet",
  signing: "waiting for your wallet to sign",
  sending: `sending to ${CHAIN.inSentence}`,
  confirming: `waiting for ${CHAIN.inSentence} to confirm, usually a few seconds`,
};

/** The one line that says what a button press is doing right now. */
export function PhaseLine({ phase, testId }: { phase: Phase; testId?: string }) {
  return (
    <p
      data-testid={testId}
      role="status"
      className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-pending"
    >
      <Spinner />
      {PHASE_WORDS[phase]}
    </p>
  );
}

/** A refusal or failure: what to do in the first line, the node's words under it. */
export function Failure({
  message,
  detail,
  testId,
}: {
  message: string;
  detail?: string | null;
  testId?: string;
}) {
  return (
    <div data-testid={testId} role="alert" className="max-w-[62ch] border-l-2 border-refused pl-4">
      <p className="text-[14px] leading-relaxed">{message}</p>
      {detail !== undefined && detail !== null && detail !== "" && (
        <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-muted">{detail}</p>
      )}
    </div>
  );
}

/** Links to the transactions a press landed. */
export function Landed({ signatures, testId }: { signatures: readonly string[]; testId?: string }) {
  if (signatures.length === 0) {
    return null;
  }
  return (
    <p data-testid={testId} className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted">
      {signatures.map((signature, place) => (
        <a
          key={signature}
          href={explorerTx(signature)}
          target="_blank"
          rel="noreferrer"
          data-signature={signature}
          className="border-b border-line pb-0.5 text-ink transition-colors hover:border-accent hover:text-accent"
        >
          {signatures.length === 1 ? "open the transaction" : `transaction ${place + 1}`}
        </a>
      ))}
    </p>
  );
}

const COPIED_MS = 1600;

/** Copies a value and says so for a moment. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // A browser that refuses the clipboard still shows the full address in
      // the title, so nothing is lost; the button just does not claim success.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`Copy the ${label}`}
      className="inline-flex h-8 items-center rounded-lg border border-line px-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted transition-colors duration-200 hover:border-ink hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

/**
 * The seal: a dashed ring that draws itself once, then a check inside it. The
 * console's one drawing, used large behind the header and small wherever a
 * credential is shown as valid.
 */
export function Seal({
  className,
  tone = "accent",
  drawn = true,
}: {
  className?: string;
  tone?: "accent" | "motif";
  drawn?: boolean;
}) {
  const still = useReducedMotion() === true;
  const colour = tone === "accent" ? "var(--accent)" : "var(--motif-line)";
  const timing = (delay: number) =>
    still ? { duration: 0 } : { duration: 1.1, delay, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={className} fill="none">
      <motion.circle
        cx="60"
        cy="60"
        r="54"
        stroke={colour}
        strokeWidth="1.2"
        strokeDasharray="3 7"
        initial={{ rotate: -90, opacity: 0 }}
        animate={drawn ? { rotate: 0, opacity: 1 } : { rotate: -90, opacity: 0 }}
        transition={timing(0)}
        style={{ originX: "60px", originY: "60px" }}
      />
      <motion.circle
        cx="60"
        cy="60"
        r="40"
        stroke={colour}
        strokeWidth="1.2"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: drawn ? 1 : 0 }}
        transition={timing(0.15)}
      />
      <motion.path
        d="M42 61 L55 73 L79 47"
        stroke={colour}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: drawn ? 1 : 0 }}
        transition={timing(0.55)}
      />
    </svg>
  );
}

/** A small uppercase label, the site's mono voice. */
export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  const className = "font-mono text-[10px] uppercase tracking-[0.18em] text-muted";
  return htmlFor === undefined ? (
    <p className={className}>{children}</p>
  ) : (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  );
}

export const FIELD_CLASS =
  "w-full rounded-lg border border-line bg-raised px-4 py-3 text-[15px] text-ink placeholder:text-muted/70 transition-colors duration-200 hover:border-muted focus:border-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export const PRIMARY_BUTTON =
  "group inline-flex h-12 items-center gap-3 rounded-lg bg-accent px-6 text-[15px] font-medium text-accent-ink transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_var(--accent)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

export const QUIET_BUTTON =
  "inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors duration-200 hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

/** A day as "23 Sep 2026", in UTC so every viewer reads the same day the chain does. */
export function utcDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
