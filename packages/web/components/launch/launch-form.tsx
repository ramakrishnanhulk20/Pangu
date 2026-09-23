"use client";

import { shares as whole } from "@/components/readout/format";
import { feedWords } from "@/lib/feeds";
import {
  FEED_IDS,
  type FieldName,
  type LaunchForm as Form,
  type LaunchPlan,
  type Refusal,
} from "@/lib/launch";
import { Reveal } from "@/components/break/strike";
import { PAYING_TOKENS, isListedDollar, payingToken, type PayingToken } from "@/lib/network";
import { MAX_DESCRIPTION, STORAGE_WORDS } from "@/lib/token-metadata";

import { Choice, Field, Tag, TextArea, TextInput } from "./fields";
import type { StockState, StorageState } from "./launch-page";
import { LogoDrop, type LogoPick } from "./logo-drop";

type Set = <K extends keyof Form>(key: K, value: Form[K]) => void;

function refusalsFor(plan: LaunchPlan, ...fields: FieldName[]): Refusal[] {
  return plan.refusals.filter((refusal) => fields.includes(refusal.field));
}


/**
 * The issuer's side of the page: the offering, how it looks, then the rules, in plain
 * words. Every number it shows beside a field is computed by the plan, never
 * typed.
 */
export function LaunchForm({
  form,
  set,
  plan,
  stock,
  logo,
  onLogo,
  onClearLogo,
  storage,
  offered,
  stocksReading,
}: {
  form: Form;
  set: Set;
  plan: LaunchPlan;
  stock: StockState;
  logo: LogoPick;
  onLogo: (file: File) => void;
  onClearLogo: () => void;
  storage: StorageState;
  /** The paying tokens this network offers, less any stock whose badge is not on chain. */
  offered: readonly PayingToken[];
  /** True while the stock tokens' badges are still being read. */
  stocksReading: boolean;
}) {
  const preview = plan.preview;
  const paying = payingToken(form.paying);
  const money = paying?.unit ?? "dollars";
  const priced = paying !== null && isListedDollar(paying.mint);
  const dollar = PAYING_TOKENS.find((token) => isListedDollar(token.mint)) ?? null;
  const soldOnCurve = Number.isFinite(Number(form.keptBack)) ? 100 - Number(form.keptBack) : null;

  return (
    <div className="space-y-20">
      <Reveal>
        <Section index="01" title="The offering">
          <div className="grid gap-8 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Field id="launch-name" label="Token name" refusals={refusalsFor(plan, "name")}>
              <TextInput
                id="launch-name"
                value={form.name}
                onChange={(value) => set("name", value)}
                placeholder="Apple Series A Share"
                maxLength={48}
                invalid={refusalsFor(plan, "name").length > 0 && form.name !== ""}
              />
            </Field>
            <Field id="launch-symbol" label="Symbol" refusals={refusalsFor(plan, "symbol")}>
              <TextInput
                id="launch-symbol"
                value={form.symbol}
                onChange={(value) => set("symbol", value.toUpperCase())}
                placeholder="AAPLS"
                maxLength={12}
                invalid={refusalsFor(plan, "symbol").length > 0 && form.symbol !== ""}
              />
            </Field>
          </div>

          <Field
            id="launch-supply"
            label="Shares in this sale"
            refusals={refusalsFor(plan, "supply")}
            helper={
              soldOnCurve !== null && preview !== null
                ? `Every share this token will ever have. The curve sells ${whole(preview.curveShares)} of them, ${soldOnCurve} percent; the rest go into the trading pool when the sale graduates.`
                : "Every share this token will ever have. Most are sold on the curve; the rest go into the trading pool when the sale graduates."
            }
          >
            <TextInput
              id="launch-supply"
              value={form.supply}
              onChange={(value) => set("supply", value)}
              inputMode="numeric"
              suffix="shares"
              invalid={refusalsFor(plan, "supply").length > 0}
            />
          </Field>

          <Field
            id="launch-paying"
            label="Buyers pay in"
            refusals={refusalsFor(plan, "paying")}
            helper={
              stocksReading
                ? `${paying?.about ?? ""} Reading which stock tokens Meteora takes as payment.`.trim()
                : paying?.about
            }
          >
            <Choice
              id="launch-paying"
              value={form.paying}
              onPick={(value) => {
                set("paying", value);
                if (!isListedDollar(payingToken(value)?.mint)) {
                  set("band", false);
                }
              }}
              options={offered.map((token) => ({ value: token.id, label: token.label }))}
            />
          </Field>

          <div className="grid gap-8 sm:grid-cols-2">
            <Field
              id="launch-raise"
              label="Raise target"
              refusals={refusalsFor(plan, "raise")}
              helper="What the curve takes in before the sale graduates to a Meteora trading pool."
            >
              <TextInput
                id="launch-raise"
                value={form.raise}
                onChange={(value) => set("raise", value)}
                inputMode="decimal"
                suffix={money}
                invalid={refusalsFor(plan, "raise").length > 0}
              />
            </Field>
            <Field
              id="launch-kept"
              label="Kept for the trading pool"
              refusals={refusalsFor(plan, "keptBack")}
              helper="The share of all shares set aside for trading after graduation, 10 to 45. More kept back makes a flatter curve that opens closer to where it ends."
            >
              <TextInput
                id="launch-kept"
                value={form.keptBack}
                onChange={(value) => set("keptBack", value)}
                inputMode="numeric"
                suffix="percent"
                invalid={refusalsFor(plan, "keptBack").length > 0}
              />
            </Field>
          </div>

          <div data-testid="launch-discount" className="border-t border-line pt-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              the opening discount, worked out
            </p>
            {preview === null ? (
              <p className="mt-3 text-[15px] text-muted">Fix the numbers above and the discount appears here.</p>
            ) : (
              <p className="mt-3 max-w-[48ch] text-[17px] leading-[1.45]">
                The first share sells{" "}
                <span className="font-display text-[1.6em] font-semibold tracking-[-0.03em] text-accent">
                  {(preview.underGraduation * 100).toFixed(1)}%
                </span>{" "}
                under the graduation price
                {preview.underStock !== null && form.band && (
                  <>
                    {", and "}
                    <span className="font-semibold">
                      {Math.abs(preview.underStock * 100).toFixed(1)}% {preview.underStock >= 0 ? "under" : "over"}
                    </span>{" "}
                    {feedWords(FEED_IDS[form.feed]).price} right now
                  </>
                )}
                .
              </p>
            )}
          </div>
        </Section>
      </Reveal>

      <Reveal>
        <Section
          index="02"
          title="How it looks"
          note="What wallets, explorers and every Pangu screen show for this token. The mint carries the address of these, written at launch."
        >
          <Field
            id="launch-logo"
            label="Logo, optional"
            refusals={[]}
            helper={logo.state === "ready" ? undefined : "Without a logo, wallets show a blank icon for this token."}
          >
            <LogoDrop
              pick={logo}
              name={form.name}
              onFile={onLogo}
              onClear={onClearLogo}
              invalid={logo.state === "refused"}
            />
          </Field>

          <Field
            id="launch-description"
            label="Description, optional"
            refusals={refusalsFor(plan, "description")}
            helper="One paragraph a buyer reads in their wallet: what the token is and who stands behind it."
          >
            <TextArea
              id="launch-description"
              value={form.description}
              onChange={(value) => set("description", value)}
              placeholder="Series A preferred shares in Apple, offered to verified buyers at a discount to the listed price."
              limit={MAX_DESCRIPTION}
              invalid={refusalsFor(plan, "description").length > 0 && form.description !== ""}
            />
          </Field>

          <div className="grid gap-8 sm:grid-cols-2">
            <Field id="launch-website" label="Website, optional" refusals={refusalsFor(plan, "website")}>
              <TextInput
                id="launch-website"
                value={form.website}
                onChange={(value) => set("website", value)}
                placeholder="https://yourcompany.com"
                maxLength={200}
                invalid={refusalsFor(plan, "website").length > 0}
              />
            </Field>
            <Field id="launch-x" label="X profile, optional" refusals={refusalsFor(plan, "x")}>
              <TextInput
                id="launch-x"
                value={form.x}
                onChange={(value) => set("x", value)}
                placeholder="@yourcompany"
                maxLength={200}
                invalid={refusalsFor(plan, "x").length > 0}
              />
            </Field>
          </div>

          <div data-testid="launch-storage" className="border-t border-line pt-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">where it is kept</p>
            <p className="mt-3 max-w-[52ch] text-[15px] leading-[1.5]">
              {storage.state === "ready" ? (
                <>
                  Storing {logo.state === "ready" ? "the logo and these words" : "these words"} costs{" "}
                  <span className="font-display text-[1.35em] font-semibold tracking-[-0.03em] text-accent">
                    {(storage.lamports / 1e9).toFixed(6)} SOL
                  </span>
                  , priced by Irys just now.
                </>
              ) : storage.state === "pricing" ? (
                "Asking Irys what storing these costs."
              ) : storage.state === "missing" ? (
                "Irys did not give a price just now. It is asked again when you launch, before anything is paid."
              ) : (
                "Nothing to store: with no logo, description or link the token launches with an empty metadata link, and nothing is paid to Irys."
              )}
            </p>
            <p className="mt-2 max-w-[56ch] text-[13px] leading-relaxed text-muted">
              {STORAGE_WORDS} Your wallet tops up its Irys balance only by what it lacks, then signs each file.
            </p>
          </div>
        </Section>
      </Reveal>

      <Reveal>
        <Section index="03" title="The rules" note="Enforced by the Pangu program on every transfer, named in its own words beside each one.">
          <Field
            id="launch-cap"
            label="Most one wallet can hold"
            tag="OverCap"
            refusals={refusalsFor(plan, "capPercent")}
            helper={
              preview !== null && preview.capShares > 0
                ? `${whole(preview.capShares)} shares on this curve, counted across every buy and every account the wallet opens. 1 to 49 percent.`
                : "Counted across every buy and every account the wallet opens. 1 to 49 percent."
            }
          >
            <TextInput
              id="launch-cap"
              value={form.capPercent}
              onChange={(value) => set("capPercent", value)}
              inputMode="numeric"
              suffix="% of the curve"
              invalid={refusalsFor(plan, "capPercent").length > 0}
              className="max-w-[18rem]"
            />
          </Field>

          <Field
            id="launch-access"
            label="Who may buy"
            tag={form.access === "open" ? "open" : form.access === "list" ? "NotApproved" : "CredentialInvalid"}
            refusals={refusalsFor(plan, "credential", "schema")}
            helper={
              form.access === "open"
                ? "Anyone with a wallet, up to the cap."
                : form.access === "list"
                  ? "Only wallets you approve. You add them after launch, one transaction each, and can take them off again."
                  : "Only wallets holding a credential from a verifier you trust, such as a KYC provider on Solana's attestation service. Paste its two addresses."
            }
          >
            <Choice
              id="launch-access"
              value={form.access}
              onPick={(value) => set("access", value)}
              options={[
                { value: "open", label: "Anyone" },
                { value: "list", label: "Your approved list" },
                { value: "credential", label: "Credential holders" },
              ]}
            />
            {form.access === "credential" && (
              <div className="mt-4 grid gap-4">
                <TextInput
                  id="launch-credential"
                  value={form.credential}
                  onChange={(value) => set("credential", value.trim())}
                  placeholder="the verifier's credential address"
                  invalid={refusalsFor(plan, "credential").length > 0 && form.credential !== ""}
                />
                <TextInput
                  id="launch-schema"
                  value={form.schema}
                  onChange={(value) => set("schema", value.trim())}
                  placeholder="the credential's schema address"
                  invalid={refusalsFor(plan, "schema").length > 0 && form.schema !== ""}
                />
              </div>
            )}
          </Field>

          <Field
            id="launch-band"
            label="Price ceiling"
            tag="PriceOutsideBand"
            refusals={refusalsFor(plan, "band", "bandPercent")}
          >
            {!priced ? (
              <p data-testid="launch-band-sol" className="max-w-[54ch] text-[14px] leading-relaxed text-muted">
                Off. A ceiling compares the curve with a stock price in dollars, so the program refuses one on a sale paid in {paying?.called ?? "this token"} <Tag>BandNeedsDollarQuote</Tag>.
                {dollar !== null && ` Pick ${dollar.called} above to set one.`}
              </p>
            ) : (
              <>
                <Choice
                  id="launch-band"
                  value={form.band ? "on" : "off"}
                  onPick={(value) => set("band", value === "on")}
                  options={[
                    { value: "off", label: "Off" },
                    { value: "on", label: "Follow a stock" },
                  ]}
                />
                {form.band && (
                  <div className="mt-5 grid gap-6">
                    <Choice
                      id="launch-feed"
                      value={form.feed}
                      onPick={(value) => set("feed", value)}
                      options={[
                        { value: "aaplx", label: "AAPLx, trades all week" },
                        { value: "apple", label: "Apple, exchange hours" },
                      ]}
                    />
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                      <TextInput
                        id="launch-band-percent"
                        value={form.bandPercent}
                        onChange={(value) => set("bandPercent", value)}
                        inputMode="numeric"
                        suffix="% over the stock"
                        invalid={refusalsFor(plan, "bandPercent").length > 0}
                        className="w-[15rem]"
                      />
                      <StockLine stock={stock} feed={form.feed} />
                    </div>
                    <p className="max-w-[54ch] text-[13px] leading-relaxed text-muted">
                      No buy may leave the curve more than this far over {feedWords(FEED_IDS[form.feed]).price}, read from Pyth at the moment of the buy. 1 to 20 percent.
                    </p>
                  </div>
                )}
              </>
            )}
          </Field>

          <Field
            id="launch-end"
            label="Offering period"
            tag="ends_at"
            refusals={refusalsFor(plan, "days")}
            helper={
              form.endless
                ? "No end: every rule lasts until the curve fills and the sale graduates."
                : "Every rule lifts at the end, cap and access included, and the token then moves freely. 1 to 60 days."
            }
          >
            <div className="flex flex-wrap items-center gap-4">
              <Choice
                id="launch-end"
                value={form.endless ? "none" : "days"}
                onPick={(value) => set("endless", value === "none")}
                options={[
                  { value: "days", label: "Ends after" },
                  { value: "none", label: "No end" },
                ]}
              />
              {!form.endless && (
                <TextInput
                  id="launch-days"
                  value={form.days}
                  onChange={(value) => set("days", value)}
                  inputMode="numeric"
                  suffix="days"
                  invalid={refusalsFor(plan, "days").length > 0}
                  className="w-[10rem]"
                />
              )}
            </div>
          </Field>
        </Section>
      </Reveal>
    </div>
  );
}

function StockLine({ stock, feed }: { stock: StockState; feed: "apple" | "aaplx" }) {
  const words = feedWords(FEED_IDS[feed]);
  if (stock.state === "reading") {
    return <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-pending">reading {words.price}</span>;
  }
  if (stock.state === "missing") {
    return <span className="max-w-[34ch] text-[13px] text-muted">{stock.reason}</span>;
  }
  return (
    <span data-testid="launch-stock" className="text-[14px] tabular-nums">
      {words.label}: <span className="font-semibold">${stock.reading.price.toFixed(2)}</span>
      {stock.reading.stale && <span className="text-muted">, last published price</span>}
    </span>
  );
}

function Section({
  index,
  title,
  note,
  children,
}: {
  index: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-4 border-b border-line pb-4">
        <span className="font-mono text-[11px] tracking-[0.18em] text-accent">{index}</span>
        <h2 className="font-display text-[clamp(1.9rem,3.6vw,2.9rem)] font-semibold leading-none tracking-[-0.035em]">
          {title}
        </h2>
      </div>
      {note !== undefined && (
        <p className="mt-4 max-w-[56ch] text-[13px] leading-relaxed text-muted">{note}</p>
      )}
      <div className="mt-9 space-y-10">{children}</div>
    </section>
  );
}
