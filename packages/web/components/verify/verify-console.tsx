"use client";

import "@/lib/buffer-shim";

import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import type { IssuedCredential } from "pangu-sdk";

import { Rise } from "@/components/hero/rise";
import { Reveal } from "@/components/break/strike";
import {
  findVerifiers,
  readIssued,
  saleVerifiers,
  verifyConnection,
  type SaleVerifier,
  type VerifierPair,
  type VerifyWallet,
} from "@/lib/verify";

import { Seal, WalletButton } from "./bits";
import { Checker } from "./checker";
import { IssueStep } from "./issue-step";
import { IssuedList } from "./issued-list";
import { SetupStep } from "./setup-step";

/** A credential-mode sale the scripts opened, as the page hands it over. */
export interface CredentialSale {
  symbol: string;
  name: string;
  mint: string;
  mode: string;
}

type Found =
  | { key: string; pairs: VerifierPair[] }
  | { key: string; failure: string };

type Listed =
  | { key: string; items: IssuedCredential[] }
  | { key: string; failure: string };

/** What the list should show once devnet's index catches up with a landed transaction. */
interface Expectation {
  present: string[];
  absent: string[];
}

/**
 * The node's program index can trail a confirmed transaction by a moment, so a
 * list read straight after an issue or a revoke is read again until it agrees.
 */
const CATCH_UP_TRIES = 6;
const CATCH_UP_WAIT_MS = 2_000;

const UNREACHABLE =
  "Devnet did not answer the read. Check the connection and read again.";

function sleep(ms: number): Promise<void> {
  return new Promise((wake) => setTimeout(wake, ms));
}

export function VerifyConsole({ credentialSales }: { credentialSales: readonly CredentialSale[] }) {
  const connection = useMemo(() => verifyConnection(), []);
  const { publicKey, signTransaction, signAllTransactions } = useWallet();

  const walletKey = publicKey === null ? null : publicKey.toBase58();
  const signer: VerifyWallet | null = useMemo(
    () =>
      publicKey === null || signTransaction === undefined
        ? null
        : { publicKey, signTransaction, signAllTransactions },
    [publicKey, signTransaction, signAllTransactions]
  );

  const [findTurn, setFindTurn] = useState(0);
  const [found, setFound] = useState<Found | null>(null);
  const [chosenIndex, setChosenIndex] = useState(0);
  const [listTurn, setListTurn] = useState(0);
  const [issueTurn, setIssueTurn] = useState(0);
  const [listed, setListed] = useState<Listed | null>(null);
  const [expectation, setExpectation] = useState<Expectation>({ present: [], absent: [] });
  const [sales, setSales] = useState<SaleVerifier[] | null>(null);

  // Everything above belongs to one wallet. A new wallet, or none, starts clean.
  const [shownFor, setShownFor] = useState(walletKey);
  if (shownFor !== walletKey) {
    setShownFor(walletKey);
    setChosenIndex(0);
    setExpectation({ present: [], absent: [] });
  }

  const findKey = walletKey === null ? null : `${walletKey}:${findTurn}`;
  useEffect(() => {
    if (findKey === null || publicKey === null) {
      return;
    }
    let live = true;
    findVerifiers(connection, publicKey).then(
      (pairs) => {
        if (live) {
          setFound({ key: findKey, pairs });
        }
      },
      () => {
        if (live) {
          setFound({ key: findKey, failure: UNREACHABLE });
        }
      }
    );
    return () => {
      live = false;
    };
  }, [connection, findKey, publicKey]);

  const current = found !== null && found.key === findKey ? found : null;
  const findReading = findKey !== null && current === null;
  const pairs = current !== null && "pairs" in current ? current.pairs : null;
  const chosen = pairs === null ? null : (pairs[chosenIndex] ?? pairs[0] ?? null);

  const listKey =
    chosen === null
      ? null
      : `${chosen.credential.toBase58()}:${chosen.schema.toBase58()}:${listTurn}`;
  useEffect(() => {
    if (listKey === null || chosen === null) {
      return;
    }
    let live = true;
    const agrees = (items: IssuedCredential[]) => {
      const wallets = new Set(items.map((item) => item.wallet.toBase58()));
      return (
        expectation.present.every((wallet) => wallets.has(wallet)) &&
        expectation.absent.every((wallet) => !wallets.has(wallet))
      );
    };
    (async () => {
      let items = await readIssued(connection, chosen);
      for (let tries = 1; tries < CATCH_UP_TRIES && !agrees(items) && live; tries += 1) {
        await sleep(CATCH_UP_WAIT_MS);
        items = await readIssued(connection, chosen);
      }
      return items;
    })().then(
      (items) => {
        if (live) {
          setListed({ key: listKey, items });
        }
      },
      () => {
        if (live) {
          setListed({ key: listKey, failure: UNREACHABLE });
        }
      }
    );
    return () => {
      live = false;
    };
    // The expectation is read when a new list key starts a read, never on its
    // own: changing it alone must not start a second read of the same list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, listKey]);

  // The list on screen stays up while a new read runs, so a revoked row can
  // finish its strike before it leaves. It only goes when the verifier changes.
  const listFor = chosen === null ? null : `${chosen.credential.toBase58()}:${chosen.schema.toBase58()}:`;
  const shownList = listed !== null && listFor !== null && listed.key.startsWith(listFor) ? listed : null;
  const listReading = listKey !== null && (listed === null || listed.key !== listKey);
  const items = shownList !== null && "items" in shownList ? shownList.items : null;
  const listFailure =
    !listReading && shownList !== null && "failure" in shownList ? shownList.failure : null;

  useEffect(() => {
    let live = true;
    saleVerifiers(connection, credentialSales).then(
      (verifiers) => {
        if (live) {
          setSales(verifiers);
        }
      },
      () => {
        if (live) {
          setSales([]);
        }
      }
    );
    return () => {
      live = false;
    };
  }, [connection, credentialSales]);

  return (
    <section data-testid="verify-page" className="grain relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[10vw] -top-[12vw] w-[48vw] max-w-[540px] opacity-40 sm:-right-[7vw] sm:-top-[10vw] sm:w-[38vw]"
      >
        <Seal className="h-auto w-full" tone="motif" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1500px] px-[6vw] pb-28 pt-12 sm:pt-16">
        <header>
          <Rise>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              for verifiers, on devnet
            </p>
          </Rise>
          <Rise delay={0.08}>
            <h1 className="-ml-[0.02em] mt-6 font-display text-[clamp(3rem,10vw,9rem)] font-semibold leading-[0.88] tracking-[-0.045em]">
              Vouch for
              <br />
              <span className="pl-[0.6em] sm:pl-[1.4em]">a wallet</span>
            </h1>
          </Rise>
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
            <Rise delay={0.16}>
              <p className="max-w-[46ch] text-[17px] leading-[1.5] sm:text-[18px]">
                A verifier is whoever checks buyers, a KYC provider or an issuer&apos;s own desk, and a
                sale in credential mode sells only to the wallets its verifier has vouched for on chain.
              </p>
            </Rise>
            <Rise delay={0.22}>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-4 lg:mt-2">
                <WalletButton />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                  {walletKey === null
                    ? "connect to issue, anyone can check"
                    : `signing as ${walletKey.slice(0, 4)}...${walletKey.slice(-4)}`}
                </span>
              </div>
            </Rise>
          </div>
        </header>

        <div className="mt-20 grid gap-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-x-16">
          <div className="space-y-20">
            <Reveal>
              <SetupStep
                key={walletKey ?? "none"}
                connection={connection}
                wallet={signer}
                connected={walletKey !== null}
                reading={findReading}
                readFailure={current !== null && "failure" in current ? current.failure : null}
                pairs={pairs}
                chosen={chosen}
                onChoose={(index) => setChosenIndex(index)}
                onSetUp={(pair) => {
                  if (findKey === null) {
                    return;
                  }
                  const others = (pairs ?? []).filter(
                    (entry) => !entry.credential.equals(pair.credential) || !entry.schema.equals(pair.schema)
                  );
                  setFound({ key: findKey, pairs: [pair, ...others] });
                  setChosenIndex(0);
                }}
                onReadAgain={() => setFindTurn((turn) => turn + 1)}
              />
            </Reveal>
            <Reveal>
              <IssueStep
                key={walletKey ?? "none"}
                connection={connection}
                wallet={signer}
                pair={chosen}
                onIssued={(wallets: PublicKey[]) => {
                  setExpectation({ present: wallets.map((wallet) => wallet.toBase58()), absent: [] });
                  setIssueTurn((turn) => turn + 1);
                  setListTurn((turn) => turn + 1);
                }}
              />
            </Reveal>
            <Reveal>
              <IssuedList
                key={walletKey ?? "none"}
                connection={connection}
                wallet={signer}
                pair={chosen}
                items={items}
                reading={listReading}
                failure={listFailure}
                issueTurn={issueTurn}
                onReadAgain={() => {
                  setExpectation({ present: [], absent: [] });
                  setListTurn((turn) => turn + 1);
                }}
                onRevoked={(wallet) => {
                  setExpectation({ present: [], absent: [wallet] });
                  setListTurn((turn) => turn + 1);
                }}
              />
            </Reveal>
          </div>

          <aside className="self-start lg:sticky lg:top-24">
            <Reveal delay={0.1}>
              <Checker
                connection={connection}
                own={chosen}
                sales={sales ?? []}
                salesReading={sales === null}
              />
            </Reveal>
          </aside>
        </div>
      </div>
    </section>
  );
}
