/**
 * The table `prove` prints, and the exit code that goes with it.
 *
 * Kept apart from the attacks themselves so the shape of the report can be
 * tested without a network: what counts as a deviation, what the summary line
 * says, and when the command fails.
 */

/** What the chain did with one attempt. */
export type Verdict = "refused" | "allowed" | "skipped";

export interface AttackReport {
  /** What was tried, in the words a judge would use. */
  attack: string;
  /** The invariant from docs/security/threat-model.md section C that this exercises. */
  invariant: string;
  /** What the rules promise: a refusal by name, or that it goes through. */
  expected: string;
  /** What actually happened, read back from the chain. */
  actual: string;
  verdict: Verdict;
  signature: string | null;
  link: string | null;
}

export interface Summary {
  attempted: number;
  refusedAsExpected: number;
  allowedAsExpected: number;
  skipped: number;
  deviations: number;
}

/**
 * Whether one line is a deviation from what the rules promise.
 *
 * A skipped attack is never a deviation: it was not run, and the line says why.
 * Everything else is judged on the one thing that matters, whether what
 * happened matches what was expected.
 */
export function deviated(report: AttackReport): boolean {
  return report.verdict !== "skipped" && report.actual !== report.expected;
}

export function summarise(reports: readonly AttackReport[]): Summary {
  const run = reports.filter((report) => report.verdict !== "skipped");
  const bad = run.filter(deviated);
  return {
    attempted: run.length,
    refusedAsExpected: run.filter(
      (report) => report.verdict === "refused" && !deviated(report)
    ).length,
    allowedAsExpected: run.filter(
      (report) => report.verdict === "allowed" && !deviated(report)
    ).length,
    skipped: reports.length - run.length,
    deviations: bad.length,
  };
}

export function summaryLine(summary: Summary): string {
  return (
    `${summary.attempted} attacks run, ` +
    `${summary.refusedAsExpected} refused as expected, ` +
    `${summary.allowedAsExpected} allowed as expected, ` +
    `${summary.skipped} not applicable, ` +
    `${summary.deviations} off the standard`
  );
}

/** Zero only when every attack that ran did what the rules promise. */
export function exitCode(reports: readonly AttackReport[]): number {
  return summarise(reports).deviations === 0 ? 0 : 1;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function proofOf(report: AttackReport): string {
  if (report.signature !== null) {
    return report.signature;
  }
  return report.verdict === "skipped" ? "not run" : "no signature";
}

/**
 * The table itself, as fixed width columns.
 *
 * The result column says `ok` or `DEVIATION`, so a reader scanning the output
 * does not have to compare the expected and actual columns themselves.
 */
export function renderTable(reports: readonly AttackReport[]): string {
  const rows = reports.map((report) => [
    report.attack,
    report.invariant,
    report.expected,
    report.actual,
    report.verdict === "skipped" ? "skipped" : deviated(report) ? "DEVIATION" : "ok",
    proofOf(report),
  ]);
  const head = ["Attack", "Invariant", "Expected", "Actual", "Result", "Proof"];
  const widths = head.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length))
  );

  const line = (cells: string[]): string =>
    cells.map((cell, column) => pad(cell, widths[column] ?? 0)).join("  ").trimEnd();

  return [
    line(head),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

/** The explorer links, one per line, for the attacks that landed on chain. */
export function renderLinks(reports: readonly AttackReport[]): string {
  return reports
    .filter((report) => report.link !== null)
    .map((report) => `${report.attack}: ${report.link}`)
    .join("\n");
}
