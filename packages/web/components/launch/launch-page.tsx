"use client";

import "@/lib/buffer-shim";

import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { motion, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Reveal, Spinner } from "@/components/break/strike";
import { breakConnection } from "@/lib/break";
import {
  DEFAULT_FORM,
  LAUNCH_COST_LAMPORTS,
  STEPS,
  StepError,
  explorerTx,
  loadProgress,
  loadUpload,
  planLaunch,
  storesMetadata,
  resumeState,
  runLaunch,
  type FeedChoice,
  type LaunchForm as Form,
  type LaunchResult,
  type Progress,
  type StepId,
  type StepState,
  type StockReading,
  type UploadRecord,
} from "@/lib/launch";
import { LogoRefused, prepareLogo, storagePrice } from "@/lib/token-metadata";

import { RefusalLine } from "./fields";
import { LaunchDone } from "./launch-done";
import { LaunchForm } from "./launch-form";
import { LaunchPreview } from "./launch-preview";
import { LaunchSteps } from "./launch-steps";
import type { LogoPick } from "./logo-drop";

// The wallet button reads the browser's injected wallets, so rendering it on
// the server would only produce markup the client replaces at once.
const WalletButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  { ssr: false, loading: () => <span className="block h-9 w-[132px] rounded-lg bg-raised" /> }
);

export type StockState =
  | { state: "reading" }
  | { state: "ready"; reading: StockReading }
  | { state: "missing"; reason: string };

export type StorageState =
  | { state: "idle" }
  | { state: "pricing" }
  | { state: "ready"; lamports: number }
  | { state: "missing" };

interface StockAnswer {
  feed: FeedChoice;
  reading: StockReading | null;
  reason: string | null;
}

const IDLE_STEPS: Record<StepId, StepState> = {
  metadata: { status: "waiting", signature: null, failure: null },
  template: { status: "waiting", signature: null, failure: null },
  sale: { status: "waiting", signature: null, failure: null },
};

const BALANCE_POLL_MS = 20_000;
const BALANCE_RETRY_MS = 5_000;
const STOCK_POLL_MS = 60_000;
const STOCK_RETRY_MS = 8_000;
/** Irys is asked the price once the typing pauses, not on every key. */
const PRICE_SETTLE_MS = 600;
/** An object URL outlives its logo long enough for the swap animation to finish drawing it. */
const URL_LINGER_MS = 2_000;

const FACTS = ["Meteora's Dynamic Bonding Curve", "Pangu's rules on every transfer", "Pyth for the stock price"];

/**
 * The launch page: the offering and its rules on one side, the sale they make
 * on the other, and the two transactions that open it.
 *
 * `feedMints` names, for each feed, one of the app's own banded sales whose
 * price the existing price route already reads, so the ceiling in the preview
 * is worked out from the same live Pyth account a buyer's transfer is checked
 * against.
 */
export function LaunchPage({ feedMints }: { feedMints: Record<FeedChoice, string | null> }) {
  const still = useReducedMotion() === true;
  const connection = useMemo(() => breakConnection(), []);
  const { publicKey, signTransaction, signAllTransactions, signMessage, sendTransaction } = useWallet();
  const wallet = publicKey === null ? null : publicKey.toBase58();

  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [balance, setBalance] = useState<{ wallet: string; lamports: number } | null>(null);
  const [stockAnswer, setStockAnswer] = useState<StockAnswer | null>(null);
  const [steps, setSteps] = useState<Record<StepId, StepState>>(IDLE_STEPS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [launchedAs, setLaunchedAs] = useState<{ name: string; symbol: string } | null>(null);
  const [logo, setLogo] = useState<LogoPick>({ state: "empty" });
  const [storage, setStorage] = useState<{ key: string; lamports: number | null } | null>(null);
  const [upload, setUpload] = useState<UploadRecord | null>(null);
  const [storedAtLaunch, setStoredAtLaunch] = useState(false);
  const now = useSyncExternalStore(neverChanges, pageOpenedAt, () => null);

  // A wallet that comes back to this tab finds the form and the half finished
  // launch it left, so pressing Launch again resumes rather than starting over.
  const [progressFor, setProgressFor] = useState<string | null>(null);
  if (progressFor !== wallet) {
    setProgressFor(wallet);
    const saved = wallet === null ? null : loadProgress(wallet);
    setProgress(saved);
    setUpload(wallet === null ? null : loadUpload(wallet));
    if (saved !== null) {
      setForm(saved.form);
    }
    setSteps(IDLE_STEPS);
    setResult(null);
  }

  const set = useCallback(<K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const pickTurn = useRef(0);
  const pickLogo = useCallback((file: File, restored = false) => {
    pickTurn.current += 1;
    const mine = pickTurn.current;
    setLogo({ state: "preparing" });
    prepareLogo(file).then(
      (prepared) => {
        if (pickTurn.current === mine) {
          setLogo({ state: "ready", logo: prepared, url: URL.createObjectURL(prepared.file), restored });
        }
      },
      (error: unknown) => {
        if (pickTurn.current === mine) {
          setLogo({
            state: "refused",
            sentence: error instanceof LogoRefused ? error.message : "That file could not be read. Pick it again.",
          });
        }
      }
    );
  }, []);
  const clearLogo = useCallback(() => {
    pickTurn.current += 1;
    setLogo({ state: "empty" });
  }, []);

  const logoUrl = logo.state === "ready" ? logo.url : null;
  useEffect(() => {
    if (logoUrl === null) {
      return;
    }
    return () => {
      window.setTimeout(() => URL.revokeObjectURL(logoUrl), URL_LINGER_MS);
    };
  }, [logoUrl]);

  // A launch that stopped after its logo was stored gets that logo back after
  // a reload, fetched from Irys, so the next press uses it again unpaid.
  const storedImage = upload?.stored?.imageUri || null;
  const storedType = upload?.stored?.imageType || null;
  const logoEmpty = logo.state === "empty";
  // Brought back once per stored logo, so removing it on purpose keeps it removed.
  const restoredImage = useRef<string | null>(null);
  useEffect(() => {
    if (storedImage === null || storedType === null || !logoEmpty || restoredImage.current === storedImage) {
      return;
    }
    restoredImage.current = storedImage;
    let alive = true;
    fetch(storedImage)
      .then((answer) => (answer.ok ? answer.blob() : null))
      .then((blob) => {
        if (alive && blob !== null) {
          const ending = storedType === "image/svg+xml" ? "svg" : storedType.slice("image/".length);
          pickLogo(new File([blob], `stored-logo.${ending}`, { type: storedType }), true);
        }
      })
      .catch(() => {
        // With Irys out of reach the issuer picks the logo again, and the
        // same bytes are still recognised and not paid for twice.
      });
    return () => {
      alive = false;
    };
  }, [storedImage, storedType, logoEmpty, pickLogo]);

  const storing = storesMetadata(form, logo.state === "ready");
  const storageKey = storing
    ? JSON.stringify([
          logo.state === "ready" ? logo.logo.bytes : null,
          form.name.trim(),
          form.symbol.trim().toUpperCase(),
          form.description.trim(),
          form.website.trim(),
          form.x.trim(),
        ])
      : null;
  useEffect(() => {
    if (storageKey === null) {
      return;
    }
    const [bytes, name, symbol, description, website, x] = JSON.parse(storageKey) as [
      number | null,
      string,
      string,
      string,
      string,
      string,
    ];
    let alive = true;
    const timer = window.setTimeout(() => {
      storagePrice(bytes, { name, symbol, description, links: { website: website || null, x: x || null } }).then(
        (lamports) => {
          if (alive) {
            setStorage({ key: storageKey, lamports });
          }
        },
        () => {
          if (alive) {
            setStorage({ key: storageKey, lamports: null });
          }
        }
      );
    }, PRICE_SETTLE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [storageKey]);
  const storageState: StorageState =
    storageKey === null
      ? { state: "idle" }
      : storage === null
        ? { state: "pricing" }
        : storage.lamports !== null
          ? { state: "ready", lamports: storage.lamports }
          : storage.key === storageKey
            ? { state: "missing" }
            : { state: "pricing" };
  const storageLamports = storageState.state === "ready" ? storageState.lamports : null;

  useEffect(() => {
    if (publicKey === null) {
      return;
    }
    let alive = true;
    let timer: number | undefined;
    const read = () => {
      connection.getBalance(publicKey, "confirmed").then(
        (lamports) => {
          if (alive) {
            setBalance({ wallet: publicKey.toBase58(), lamports });
            timer = window.setTimeout(read, BALANCE_POLL_MS);
          }
        },
        () => {
          // A missed read leaves the last real balance on screen and is asked again soon.
          if (alive) {
            timer = window.setTimeout(read, BALANCE_RETRY_MS);
          }
        }
      );
    };
    read();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [connection, publicKey, result]);

  const wantsStock = form.band && form.paying === "dollar";
  useEffect(() => {
    if (!wantsStock) {
      return;
    }
    const feed = form.feed;
    const mint = feedMints[feed];
    let alive = true;
    let timer: number | undefined;
    // A missed read is asked again soon; a good one is kept for a minute.
    const again = (ms: number) => {
      if (alive) {
        timer = window.setTimeout(read, ms);
      }
    };
    const read = () => {
      if (mint === null) {
        setStockAnswer({ feed, reading: null, reason: "This app has no sale on that feed to read its price through yet." });
        return;
      }
      fetch(`/api/price/${mint}`, { cache: "no-store" })
        .then(async (answer) => {
          const body = (await answer.json().catch(() => null)) as {
            priceDollars?: number;
            publishTime?: number;
            stale?: boolean;
            error?: string;
          } | null;
          if (!alive) {
            return;
          }
          if (!answer.ok || body === null || typeof body.priceDollars !== "number" || body.priceDollars <= 0) {
            setStockAnswer({
              feed,
              reading: null,
              reason: body?.error ?? "The stock price did not read. The ceiling is still set; the preview places it once the price reads.",
            });
            again(STOCK_RETRY_MS);
            return;
          }
          setStockAnswer({
            feed,
            reading: { price: body.priceDollars, publishTime: body.publishTime ?? null, stale: body.stale === true },
            reason: null,
          });
          again(STOCK_POLL_MS);
        })
        .catch(() => {
          if (alive) {
            setStockAnswer({ feed, reading: null, reason: "This page could not reach its own server for the stock price." });
            again(STOCK_RETRY_MS);
          }
        });
    };
    read();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [wantsStock, form.feed, feedMints]);

  const stock = useMemo<StockState>(
    () =>
      stockAnswer === null || stockAnswer.feed !== form.feed
        ? { state: "reading" }
        : stockAnswer.reading !== null
          ? { state: "ready", reading: stockAnswer.reading }
          : { state: "missing", reason: stockAnswer.reason ?? "The stock price did not read." },
    [stockAnswer, form.feed]
  );

  const lamports = balance !== null && balance.wallet === wallet ? balance.lamports : null;
  const plan = useMemo(
    () =>
      planLaunch(form, {
        stock: stock.state === "ready" ? stock.reading : null,
        lamports,
        now,
        storageLamports,
      }),
    [form, stock, lamports, now, storageLamports]
  );
  const resume = resumeState(progress, plan.terms);

  const panel = useRef<HTMLDivElement>(null);
  const turn = useRef(0);

  const launch = async () => {
    if (publicKey === null || signTransaction === undefined || plan.terms === null || logo.state === "preparing" || running) {
      return;
    }
    turn.current += 1;
    const mine = turn.current;
    const terms = plan.terms;
    const launchedForm = form;
    const launchedLogo = logo.state === "ready" ? logo.logo.file : null;
    setRunning(true);
    setResult(null);
    setSteps(IDLE_STEPS);
    setStoredAtLaunch(storing);
    let current: StepId = storing ? "metadata" : "template";
    const onStep = (id: StepId, state: StepState) => {
      if (turn.current !== mine) {
        return;
      }
      current = id;
      setSteps((before) => ({ ...before, [id]: state }));
    };
    try {
      const landed = await runLaunch(
        terms,
        launchedForm,
        launchedLogo,
        { publicKey, signTransaction, signAllTransactions, signMessage, sendTransaction },
        connection,
        onStep
      );
      if (turn.current === mine) {
        setResult(landed);
        setLaunchedAs({ name: terms.name, symbol: terms.symbol });
        window.requestAnimationFrame(() => panel.current?.scrollIntoView({ block: "start" }));
      }
    } catch (error) {
      if (turn.current !== mine) {
        return;
      }
      const saved = loadProgress(publicKey);
      if (error instanceof StepError) {
        setSteps((before) =>
          before[error.step].status === "failed"
            ? before
            : { ...before, [error.step]: { status: "failed", signature: null, failure: error.failure } }
        );
      } else {
        const text = error instanceof Error ? error.message : String(error);
        const landedTemplate = saved?.templateSignature ?? null;
        setSteps((before) => ({
          ...before,
          [current]: {
            status: "failed",
            signature: before[current].signature,
            failure: {
              sentence: /429|rate limit/i.test(text)
                ? "The public devnet node is rate limiting this browser."
                : `Devnet did not answer as expected: ${text}`,
              tag: null,
              onChain:
                landedTemplate === null
                  ? "Nothing from this launch is on chain yet."
                  : "The launch template is on chain. No pool and no sale yet.",
              onChainLink: landedTemplate === null ? null : explorerTx(landedTemplate),
              next: "Wait a moment and press Launch again; it checks the chain before sending anything.",
            },
          },
        }));
      }
    } finally {
      if (turn.current === mine) {
        setProgress(loadProgress(publicKey));
        setUpload(loadUpload(publicKey));
        setRunning(false);
      }
    }
  };

  const blocking = plan.refusals;
  const canSign = signTransaction !== undefined;
  const ready =
    wallet !== null && canSign && blocking.length === 0 && plan.terms !== null && logo.state !== "preparing" && !running;
  // While a launch runs, and after it stops, the list shows the steps that
  // launch had; before the first press it follows the form.
  const showStorage = running || steps !== IDLE_STEPS ? storedAtLaunch : storing;
  const cost = (LAUNCH_COST_LAMPORTS / LAMPORTS_PER_SOL).toFixed(4);
  const buttonWords = running
    ? "Launching"
    : resume.kind === "finish"
      ? "Finish the launch"
      : resume.kind === "check-sale"
        ? "Check the launch"
        : "Launch the sale";

  return (
    <section data-testid="launch-page" className="grain relative isolate overflow-hidden">
      <Motif still={still} />

      <div className="relative z-10 mx-auto w-full max-w-[1500px] px-[6vw] pb-28 pt-12 sm:pt-16">
        <header>
          <Reveal>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">for issuers, on devnet</p>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="-ml-[0.02em] mt-6 font-display text-[clamp(3rem,10vw,9rem)] font-semibold leading-[0.88] tracking-[-0.045em]">
              Launch
              <br />
              <span className="pl-[0.6em] sm:pl-[1.4em]">a sale</span>
            </h1>
          </Reveal>
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
            <Reveal delay={0.16}>
              <p className="max-w-[40ch] text-[17px] leading-[1.5] sm:text-[18px]">
                Describe the offering, set the rules, and watch the curve they make before you sign anything.
                Two transactions later the sale is live.
              </p>
            </Reveal>
            <Reveal delay={0.22}>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted lg:mt-2">
                {FACTS.map((fact) => (
                  <span key={fact} className="flex items-center gap-5">
                    {fact}
                    <span className="h-1 w-1 rounded-full bg-accent" />
                  </span>
                ))}
                <span>about {cost} SOL to launch</span>
              </div>
            </Reveal>
          </div>
        </header>

        <div className="mt-20 grid gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-x-16 lg:gap-y-20">
          <div className="lg:col-start-1 lg:row-start-1">
            <LaunchForm
              form={form}
              set={set}
              plan={plan}
              stock={stock}
              logo={logo}
              onLogo={pickLogo}
              onClearLogo={clearLogo}
              storage={storageState}
            />
          </div>

          <aside className="self-start lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <Reveal delay={0.1}>
              <LaunchPreview preview={plan.preview} form={form} logoUrl={logoUrl} />
            </Reveal>
          </aside>

          <div ref={panel} className="scroll-mt-24 lg:col-start-1 lg:row-start-2">
            {result !== null && launchedAs !== null ? (
              <LaunchDone result={result} name={launchedAs.name} symbol={launchedAs.symbol} />
            ) : (
              <Reveal>
                <div data-testid="launch-panel">
                  <div className="flex items-baseline gap-4 border-b border-line pb-4">
                    <span className="font-mono text-[11px] tracking-[0.18em] text-accent">04</span>
                    <h2 className="font-display text-[clamp(1.9rem,3.6vw,2.9rem)] font-semibold leading-none tracking-[-0.035em]">
                      Sign and launch
                    </h2>
                  </div>

                  <p className="mt-5 max-w-[56ch] text-[14px] leading-relaxed text-muted">
                    {storing &&
                      `First the ${logo.state === "ready" ? "logo and description go" : "description and links go"} to Irys: your wallet pays for the storage and signs ${logo.state === "ready" ? "each of the two files" : "the one file"}. `}
                    {storing ? "Then two" : "Two"} transactions, each tried against devnet first so a refusal shows before your wallet is asked, and the second needs the first on chain.
                    About {cost} SOL in all, most of it rent: the deposit Solana holds to keep the new accounts open.
                  </p>

                  {blocking.length > 0 && (
                    <div data-testid="launch-blocking" className="mt-6">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-refused">
                        {blocking.length === 1 ? "one thing to change first" : `${blocking.length} things to change first`}
                      </p>
                      {blocking.map((refusal) => (
                        <RefusalLine key={`${refusal.field}-${refusal.sentence}`} refusal={refusal} />
                      ))}
                    </div>
                  )}

                  {resume.kind === "finish" && !running && (
                    <p data-testid="launch-resume" className="mt-6 max-w-[56ch] border-l-2 border-accent pl-4 text-[14px] leading-relaxed">
                      Your last try left the launch template on chain. Launching again reuses it and only sends the second transaction.{" "}
                      <a
                        href={explorerTx(resume.templateSignature)}
                        target="_blank"
                        rel="noreferrer"
                        className="border-b border-line text-muted transition-colors hover:border-accent hover:text-accent"
                      >
                        see the template
                      </a>
                    </p>
                  )}
                  {upload?.stored != null && upload.stored.uri !== "" && resume.kind !== "check-sale" && !running && (
                    <p
                      data-testid="launch-upload-kept"
                      className="mt-6 max-w-[56ch] border-l-2 border-accent pl-4 text-[14px] leading-relaxed"
                    >
                      Your last try already stored a logo and description. Launching again uses them as they are, unpaid, unless you have changed them.
                    </p>
                  )}
                  {resume.kind === "new-curve" && !running && (
                    <p className="mt-6 max-w-[56ch] border-l-2 border-line pl-4 text-[14px] leading-relaxed text-muted">
                      Your last try left a launch template for different curve numbers. This launch makes a new one; the old one stays on chain unused.
                    </p>
                  )}

                  <div className="mt-8 flex flex-wrap items-center gap-4">
                    {wallet === null ? (
                      <>
                        <WalletButton />
                        <span className="text-[14px] text-muted">Connect a devnet wallet to launch.</span>
                      </>
                    ) : (
                      <motion.button
                        type="button"
                        data-testid="launch-go"
                        onClick={() => void launch()}
                        disabled={!ready}
                        whileHover={ready && !still ? { y: -2 } : undefined}
                        whileTap={ready && !still ? { scale: 0.98 } : undefined}
                        className="group inline-flex h-14 items-center gap-3 rounded-lg bg-accent px-7 text-[16px] font-medium text-accent-ink transition-opacity duration-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
                      >
                        {running && <Spinner />}
                        {buttonWords}
                        {!running && (
                          <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
                            &rarr;
                          </span>
                        )}
                      </motion.button>
                    )}
                    {wallet !== null && (
                      <span data-testid="launch-balance" className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                        {lamports === null ? "reading your balance" : `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} devnet SOL`}
                      </span>
                    )}
                    {wallet !== null && !canSign && (
                      <span className="text-[14px] text-muted">This wallet cannot sign transactions. Connect another.</span>
                    )}
                  </div>

                  <div className="mt-10">
                    <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                      {showStorage ? STEPS.length : STEPS.length - 1} steps, in order
                    </p>
                    <LaunchSteps steps={steps} storageLamports={storageLamports} withStorage={showStorage} />
                  </div>
                </div>
              </Reveal>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

let openedAt: number | null = null;

/**
 * When this page opened, in unix seconds, read once. The server has no answer:
 * the page is prerendered at build time, and a date written then would not
 * match the one the browser works out.
 */
function pageOpenedAt(): number {
  openedAt ??= Math.floor(Date.now() / 1000);
  return openedAt;
}

function neverChanges(): () => void {
  return () => {};
}

/** The curve again, faint and rising behind the page, the site's one repeated drawing. */
function Motif({ still }: { still: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <svg viewBox="0 0 1440 1600" preserveAspectRatio="none" className="h-full w-full" style={{ filter: "var(--motif-glow)" }}>
        <motion.path
          d="M -40 1560 C 360 1540, 760 1420, 1000 1080 C 1180 820, 1300 420, 1400 -20"
          fill="none"
          stroke="var(--motif-faint)"
          strokeWidth={2}
          initial={still ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={still ? { duration: 0 } : { duration: 2.4, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
    </div>
  );
}
