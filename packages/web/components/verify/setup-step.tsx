"use client";

import { useState } from "react";

import {
  MAX_NAME_BYTES,
  VerifyError,
  nameProblem,
  setupTransaction,
  simulateSignSend,
  type Phase,
  type VerifierPair,
  type VerifyWallet,
} from "@/lib/verify";
import type { Connection } from "@solana/web3.js";

import {
  CopyButton,
  FIELD_CLASS,
  Failure,
  Label,
  Landed,
  PRIMARY_BUTTON,
  PhaseLine,
  QUIET_BUTTON,
  StepHead,
  WalletButton,
} from "./bits";

interface Trouble {
  message: string;
  detail: string | null;
}

function troubleOf(error: unknown): Trouble {
  if (error instanceof VerifyError) {
    return { message: error.message, detail: error.detail };
  }
  return {
    message: "Devnet did not answer. Check the connection and press again.",
    detail: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Step 01. Finds the verifier this wallet already runs, or opens one: a
 * credential named by the verifier and a schema under it, both run by the
 * connected wallet.
 */
export function SetupStep({
  connection,
  wallet,
  connected,
  reading,
  readFailure,
  pairs,
  chosen,
  onChoose,
  onSetUp,
  onReadAgain,
}: {
  connection: Connection;
  /** Null when no wallet is connected, or the one connected cannot sign. */
  wallet: VerifyWallet | null;
  connected: boolean;
  reading: boolean;
  readFailure: string | null;
  pairs: readonly VerifierPair[] | null;
  chosen: VerifierPair | null;
  onChoose: (index: number) => void;
  onSetUp: (pair: VerifierPair) => void;
  onReadAgain: () => void;
}) {
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [landed, setLanded] = useState<string[]>([]);

  const problem = nameProblem(name);

  const setUp = async () => {
    if (wallet === null || problem !== null) {
      setTouched(true);
      return;
    }
    setTrouble(null);
    setLanded([]);
    setPhase("reading");
    try {
      const built = await setupTransaction(connection, wallet.publicKey, name);
      const signatures =
        built.transaction === null
          ? []
          : await simulateSignSend(connection, wallet, [built.transaction], setPhase);
      setLanded(signatures);
      onSetUp(built.pair);
    } catch (error) {
      setTrouble(troubleOf(error));
    } finally {
      setPhase(null);
    }
  };

  return (
    <div data-testid="verify-setup">
      <StepHead index="01" title="Set up as a verifier" done={chosen !== null} />

      {!connected && (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <WalletButton />
          <p className="text-[14px] text-muted">
            Connect the devnet wallet that will sign your credentials.
          </p>
        </div>
      )}

      {connected && wallet === null && (
        <p className="mt-6 text-[14px] text-muted">
          This wallet cannot sign transactions. Connect another.
        </p>
      )}

      {connected && reading && (
        <div className="mt-6">
          <PhaseLine phase="reading" testId="verify-setup-reading" />
          <p className="mt-2 text-[13px] text-muted">
            Looking for a verifier this wallet already runs.
          </p>
        </div>
      )}

      {connected && !reading && readFailure !== null && (
        <div className="mt-6 space-y-4">
          <Failure message={readFailure} />
          <button type="button" onClick={onReadAgain} className={QUIET_BUTTON}>
            read again
          </button>
        </div>
      )}

      {chosen !== null && (
        <div className="mt-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            <PairField
              label="credential"
              value={chosen.credential.toBase58()}
              caption={chosen.name}
              testId="verify-pair-credential"
            />
            <PairField
              label="schema"
              value={chosen.schema.toBase58()}
              caption={chosen.schemaName}
              testId="verify-pair-schema"
            />
          </dl>
          <p className="mt-5 max-w-[56ch] border-l-2 border-accent pl-4 text-[15px] leading-relaxed">
            An issuer pastes these two into the launch form to sell only to wallets you verify.
          </p>
          {!chosen.canSign && (
            <p className="mt-4 max-w-[56ch] text-[14px] text-refused">
              This wallet runs the credential but is not on its list of signers, so it cannot issue under it.
            </p>
          )}
          {chosen.paused && (
            <p className="mt-4 max-w-[56ch] text-[14px] text-refused">
              This schema is paused, so nothing can be issued under it and no new sale can name it.
            </p>
          )}
          {pairs !== null && pairs.length > 1 && (
            <div className="mt-6">
              <Label>this wallet runs {pairs.length} verifiers</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {pairs.map((pair, index) => (
                  <button
                    key={`${pair.credential.toBase58()}:${pair.schema.toBase58()}`}
                    type="button"
                    onClick={() => onChoose(index)}
                    aria-pressed={pair === chosen}
                    className={`${QUIET_BUTTON} ${pair === chosen ? "border-accent text-accent" : ""}`}
                  >
                    {pair.name} / {pair.schemaName}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Landed signatures={landed} testId="verify-setup-landed" />
        </div>
      )}

      {connected && wallet !== null && !reading && readFailure === null && chosen === null && (
        <form
          className="mt-6 max-w-[34rem]"
          onSubmit={(event) => {
            event.preventDefault();
            void setUp();
          }}
        >
          <Label htmlFor="verify-name">your verifier&apos;s name</Label>
          <input
            id="verify-name"
            data-testid="verify-setup-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="for example, Acme KYC"
            autoComplete="off"
            className={`${FIELD_CLASS} mt-2`}
            aria-invalid={touched && problem !== null}
          />
          <p className="mt-2 text-[13px] text-muted">
            {touched && problem !== null
              ? problem
              : `Up to ${MAX_NAME_BYTES} bytes. It becomes part of your credential's address, so it cannot change later.`}
          </p>
          <p className="mt-4 max-w-[56ch] text-[14px] leading-relaxed text-muted">
            This opens two accounts on the attestation service, a credential and a schema, with this
            wallet as the one key allowed to sign. You pay for them once, in devnet SOL.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-5">
            <button
              type="submit"
              data-testid="verify-setup-button"
              disabled={phase !== null}
              className={PRIMARY_BUTTON}
            >
              Set up
              <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
                &rarr;
              </span>
            </button>
            {phase !== null && <PhaseLine phase={phase} />}
          </div>
          {trouble !== null && (
            <div className="mt-5">
              <Failure message={trouble.message} detail={trouble.detail} testId="verify-setup-failure" />
            </div>
          )}
        </form>
      )}
    </div>
  );
}

function PairField({
  label,
  value,
  caption,
  testId,
}: {
  label: string;
  value: string;
  caption: string;
  testId: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-raised/60 p-4 transition-colors duration-200 hover:border-muted">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{label}</dt>
      <dd className="mt-2 flex items-center justify-between gap-3">
        <span
          data-testid={testId}
          data-address={value}
          title={value}
          className="font-mono text-[15px] tabular-nums"
        >
          {value.slice(0, 6)}...{value.slice(-6)}
        </span>
        <CopyButton value={value} label={label} />
      </dd>
      <dd className="mt-1 truncate text-[12px] text-muted">{caption}</dd>
    </div>
  );
}
