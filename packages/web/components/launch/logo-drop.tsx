"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRef, useState } from "react";

import { LogoFrame } from "@/components/token-logo";
import { LOGO_EDGE, type Logo } from "@/lib/token-metadata";

const EASE = [0.22, 1, 0.36, 1] as const;
const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg";

export type LogoPick =
  | { state: "empty" }
  | { state: "preparing" }
  | { state: "ready"; logo: Logo; url: string; restored: boolean }
  | { state: "refused"; sentence: string };

function kilobytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The logo box: drop a file on the circle or press it to choose one. The
 * circle is how wallets and every Pangu screen will draw the logo, so what is
 * seen here is what buyers see.
 */
export function LogoDrop({
  pick,
  name,
  onFile,
  onClear,
  invalid,
}: {
  pick: LogoPick;
  name: string;
  onFile: (file: File) => void;
  onClear: () => void;
  invalid: boolean;
}) {
  const still = useReducedMotion() === true;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const ready = pick.state === "ready" ? pick : null;
  const square = ready !== null && ready.logo.width !== null && ready.logo.width === ready.logo.height;

  const choose = () => input.current?.click();

  return (
    <div className="grid items-center gap-x-8 gap-y-5 sm:grid-cols-[auto_minmax(0,1fr)]">
      <motion.button
        type="button"
        data-testid="launch-logo-drop"
        aria-label={ready === null ? "Choose the token's logo" : "Replace the token's logo"}
        onClick={choose}
        onDragEnter={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const file = event.dataTransfer.files[0];
          if (file !== undefined) {
            onFile(file);
          }
        }}
        animate={{ scale: over && !still ? 1.05 : 1 }}
        whileHover={still ? undefined : { scale: 1.03 }}
        whileTap={still ? undefined : { scale: 0.98 }}
        transition={{ duration: 0.35, ease: EASE }}
        className="group relative grid h-40 w-40 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        {/* The ring turns slowly while the box waits for a file, and closes up solid while one is held over it. */}
        <motion.svg
          aria-hidden="true"
          viewBox="0 0 160 160"
          className="pointer-events-none absolute inset-0 h-full w-full"
          animate={still || ready !== null || over ? { rotate: 0 } : { rotate: 360 }}
          transition={still || ready !== null || over ? { duration: 0.4 } : { duration: 40, repeat: Infinity, ease: "linear" }}
        >
          <circle
            cx="80"
            cy="80"
            r="78.5"
            fill="none"
            strokeWidth={over ? 2 : 1.25}
            strokeDasharray={over || ready !== null ? undefined : "3 7"}
            className={`transition-colors duration-300 ${
              over ? "stroke-accent" : invalid ? "stroke-refused" : ready !== null ? "stroke-accent/70" : "stroke-muted/60 group-hover:stroke-ink/60"
            }`}
          />
        </motion.svg>
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-3 rounded-full bg-accent blur-2xl transition-opacity duration-500 ${
            over || ready !== null ? "opacity-20" : "opacity-0 group-hover:opacity-10"
          }`}
        />

        <AnimatePresence mode="wait" initial={false}>
          {ready !== null ? (
            <motion.span
              key={ready.url}
              className="relative"
              initial={still ? false : { opacity: 0, scale: 1.14, filter: "blur(6px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={still ? undefined : { opacity: 0, scale: 0.92 }}
              transition={still ? { duration: 0 } : { duration: 0.7, ease: EASE }}
            >
              <LogoFrame image={ready.url} name={name.trim() === "" ? "The token's logo" : name.trim()} size={136} />
            </motion.span>
          ) : (
            <motion.span
              key="empty"
              className="relative flex flex-col items-center gap-2 px-6 text-center"
              initial={still ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={still ? undefined : { opacity: 0 }}
              transition={still ? { duration: 0 } : { duration: 0.4, ease: EASE }}
            >
              {pick.state === "preparing" ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-pending">reading it</span>
              ) : (
                <>
                  <span className="font-display text-[32px] leading-none tracking-[-0.04em] text-muted transition-colors duration-200 group-hover:text-accent">
                    +
                  </span>
                  <span className="font-mono text-[10px] uppercase leading-snug tracking-[0.18em] text-muted">
                    {over ? "let go" : "drop the logo"}
                  </span>
                </>
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <input
        ref={input}
        id="launch-logo"
        data-testid="launch-logo"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) {
            onFile(file);
          }
        }}
      />

      <div className="min-w-0">
        {ready !== null ? (
          <>
            <p data-testid="launch-logo-facts" className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
              {ready.logo.type.slice("image/".length).replace("svg+xml", "svg").replace("jpeg", "jpg")}
              {ready.logo.width !== null && ready.logo.height !== null && ` · ${ready.logo.width} × ${ready.logo.height}`}
              {` · ${kilobytes(ready.logo.bytes)}`}
            </p>
            <p className="mt-2 max-w-[46ch] text-[13px] leading-relaxed text-muted">
              {ready.restored
                ? "Already stored by your last try at this launch, and used again unless you pick another."
                : ready.logo.shrunkFrom !== null
                  ? `Shrunk from ${ready.logo.shrunkFrom} px to ${LOGO_EDGE} px on this machine before anything is stored.`
                  : "Stored exactly as picked."}{" "}
              {!square && ready.logo.width !== null && "Not square, so the circle wallets draw it in will cut its edges."}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              <button
                type="button"
                onClick={choose}
                className="border-b border-line pb-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              >
                replace
              </button>
              <button
                type="button"
                data-testid="launch-logo-remove"
                onClick={onClear}
                className="border-b border-line pb-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-refused hover:text-refused focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              >
                remove
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[15px] leading-snug">
              Drop it on the circle, or{" "}
              <button
                type="button"
                onClick={choose}
                className="border-b border-accent text-accent transition-colors hover:border-ink hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              >
                choose a file
              </button>
              .
            </p>
            <p className="mt-2 max-w-[46ch] text-[13px] leading-relaxed text-muted">
              PNG, JPEG, WEBP or SVG, up to 1 MB. Square works best: wallets draw it in a circle. A larger picture is shrunk to {LOGO_EDGE} px here first.
            </p>
          </>
        )}
        {pick.state === "refused" && (
          <p
            data-testid="launch-logo-refused"
            className="mt-3 max-w-[46ch] border-l-2 border-refused pl-3 text-[13px] leading-relaxed"
          >
            {pick.sentence}
          </p>
        )}
      </div>
    </div>
  );
}
