"use client";

import type { ReactNode } from "react";

import type { Refusal } from "@/lib/launch";

/** The name the program gives a rule, small and apart from the sentence, the way the ledger tags its rows. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded border border-line px-1.5 py-0.5 align-middle font-mono text-[10px] leading-none tracking-[0.04em] text-muted">
      {children}
    </span>
  );
}

/** A labelled field, with the helper line under it and any refusal that names it. */
export function Field({
  id,
  label,
  helper,
  refusals,
  children,
  tag,
}: {
  id: string;
  label: string;
  helper?: ReactNode;
  refusals: Refusal[];
  children: ReactNode;
  tag?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2.5">
        <label
          htmlFor={id}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted"
        >
          {label}
        </label>
        {tag !== undefined && <Tag>{tag}</Tag>}
      </div>
      <div className="mt-2.5">{children}</div>
      {helper !== undefined && (
        <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-muted">{helper}</p>
      )}
      {refusals.map((refusal) => (
        <RefusalLine key={`${refusal.field}-${refusal.sentence}`} refusal={refusal} />
      ))}
    </div>
  );
}

export function RefusalLine({ refusal }: { refusal: Refusal }) {
  return (
    <p
      data-testid={`launch-refusal-${refusal.field}`}
      className="mt-2.5 max-w-[56ch] border-l-2 border-refused pl-3 text-[13px] leading-relaxed"
    >
      <span className="text-ink">{refusal.sentence}</span>{" "}
      <span className="text-muted">{refusal.change}</span>
      {refusal.tag !== null && (
        <>
          {" "}
          <Tag>{refusal.tag}</Tag>
        </>
      )}
    </p>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  inputMode,
  suffix,
  invalid,
  maxLength,
  className = "",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal";
  suffix?: string;
  invalid: boolean;
  maxLength?: number;
  className?: string;
}) {
  return (
    <div
      className={`group flex h-12 items-center rounded-lg border bg-raised transition-colors duration-200 focus-within:border-accent hover:border-ink/40 ${
        invalid ? "border-refused/70" : "border-line"
      } ${className}`}
    >
      <input
        id={id}
        name={id}
        data-testid={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
        className="h-full min-w-0 flex-1 bg-transparent px-4 text-[16px] tabular-nums text-ink outline-none placeholder:text-muted/60"
      />
      {suffix !== undefined && (
        <span className="shrink-0 pr-4 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          {suffix}
        </span>
      )}
    </div>
  );
}

/** A few lines of text with a running count against the limit. */
export function TextArea({
  id,
  value,
  onChange,
  placeholder,
  limit,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  limit: number;
  invalid: boolean;
}) {
  const used = value.trim().length;
  return (
    <div
      className={`group relative rounded-lg border bg-raised transition-colors duration-200 focus-within:border-accent hover:border-ink/40 ${
        invalid ? "border-refused/70" : "border-line"
      }`}
    >
      <textarea
        id={id}
        name={id}
        data-testid={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={limit}
        rows={4}
        aria-invalid={invalid}
        aria-describedby={`${id}-count`}
        className="block w-full resize-y bg-transparent px-4 pb-8 pt-3 text-[16px] leading-relaxed text-ink outline-none placeholder:text-muted/60"
      />
      <span
        id={`${id}-count`}
        aria-live="polite"
        className={`pointer-events-none absolute bottom-2.5 right-4 font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums ${
          used >= limit ? "text-refused" : used >= limit * 0.9 ? "text-pending" : "text-muted"
        }`}
      >
        {used} / {limit}
      </span>
    </div>
  );
}

/** A small set of choices where exactly one is on, as a row of buttons. */
export function Choice<T extends string>({
  id,
  value,
  options,
  onPick,
}: {
  id: string;
  value: T;
  options: { value: T; label: string }[];
  onPick: (value: T) => void;
}) {
  return (
    <div id={id} role="radiogroup" className="inline-flex max-w-full flex-wrap rounded-lg border border-line p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          data-testid={`${id}-${option.value}`}
          onClick={() => onPick(option.value)}
          className={`rounded-md px-3.5 py-2 text-[14px] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            value === option.value ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
