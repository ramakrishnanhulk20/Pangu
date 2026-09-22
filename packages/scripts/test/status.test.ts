// The table `status` prints, the exit code that goes with it, the market clock
// behind the stale-price note, and how the deployment record is read.
//
// Does NOT cover: any of the checks themselves. Every one of those is a read of
// devnet, of Hermes or of the live site, and only the command against the real
// network says whether the demo is up.

import { describe, expect, it } from "vitest";
import { PanguInputError, PanguLayoutError } from "pangu-sdk";
import {
  earlierBuildReason,
  exitCode,
  readDeployedBuild,
  renderTable,
  summaryLine,
  usMarketOpen,
  type CheckRow,
} from "../src/status.js";

const rows: CheckRow[] = [
  { check: "program 4Nd46mDi...", result: "PASS", detail: "executable, sha256 as recorded" },
  { check: "band PBAND 4vyCQRLe...", result: "WARN", detail: "published 26000 seconds ago" },
  { check: "app", result: "SKIP", detail: "APP_URL is not set in .env" },
];

const DEPLOYMENTS = `# Deployments

## Devnet (live)

| Fact | Value |
| --- | --- |
| Program id | \`4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG\` |
| Program data account | \`58UAoZWuoMpnV4HzydaVUai9U7DFzapFtN5KtAzkzDpY\` |
| Upgrade authority (public key) | \`Fwi8ejZ8kqF8PwcxssHFqJQZmVrkmBfoaXV5CTjqp5L\` |
| Build size | 356,200 bytes |
| sha256 of the deployed build | \`08746FAA7B4AC83ADA7BFA0CD2FCF0B04AABC9C335EBFC310FD2A06D486D3A7C\` |

## Mainnet

| Fact | Value |
| --- | --- |
| Program id | not deployed |
| Build size | not deployed |
| sha256 of the deployed build | not deployed |
`;

describe("the table", () => {
  it("keeps a row per check and puts every result in the same column", () => {
    const lines = renderTable(rows).split("\n");
    expect(lines).toHaveLength(rows.length + 2);

    const column = lines[0]?.indexOf("Result") ?? -1;
    expect(column).toBeGreaterThan(0);
    for (const [index, each] of rows.entries()) {
      const line = lines[index + 2] ?? "";
      expect(line.slice(column, column + each.result.length)).toBe(each.result);
      expect(line).toContain(each.check);
      expect(line).toContain(each.detail);
    }
  });
});

describe("the summary", () => {
  it("counts each result and says when it was read, in UTC", () => {
    const line = summaryLine(rows, new Date("2026-10-01T06:15:09.412Z"));
    expect(line).toBe(
      "1 passed, 1 warned, 0 failed, 1 not checked, at 2026-10-01T06:15:09Z"
    );
  });
});

describe("the exit code", () => {
  it("is zero when nothing failed, and a warning is not a failure", () => {
    expect(exitCode(rows)).toBe(0);
  });

  it("is one as soon as a single check failed", () => {
    expect(exitCode([...rows, { check: "pyth key", result: "FAIL", detail: "HTTP 401" }])).toBe(1);
  });
});

describe("the US market clock", () => {
  it("is open on a weekday inside the pre-market to after-hours window", () => {
    // 14:00 UTC on Tuesday 22 September 2026 is 10:00 in New York.
    expect(usMarketOpen(new Date("2026-09-22T14:00:00Z"))).toBe(true);
  });

  it("is shut overnight and at the weekend, which is when a price ages out", () => {
    expect(usMarketOpen(new Date("2026-09-22T03:00:00Z"))).toBe(false);
    expect(usMarketOpen(new Date("2026-09-26T16:00:00Z"))).toBe(false);
  });

  it("follows New York through daylight saving rather than a fixed offset", () => {
    // 08:30 UTC is 04:30 in New York in September and 03:30 in January.
    expect(usMarketOpen(new Date("2026-09-22T08:30:00Z"))).toBe(true);
    expect(usMarketOpen(new Date("2026-01-20T08:30:00Z"))).toBe(false);
  });
});

describe("the deployment record", () => {
  it("reads the devnet build's size and hash, and lowercases the hash", () => {
    const build = readDeployedBuild(DEPLOYMENTS);
    expect(build.programId).toBe("4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG");
    expect(build.programData).toBe("58UAoZWuoMpnV4HzydaVUai9U7DFzapFtN5KtAzkzDpY");
    expect(build.upgradeAuthority).toBe("Fwi8ejZ8kqF8PwcxssHFqJQZmVrkmBfoaXV5CTjqp5L");
    expect(build.buildBytes).toBe(356_200);
    expect(build.sha256).toBe(
      "08746faa7b4ac83ada7bfa0cd2fcf0b04aabc9c335ebfc310fd2a06d486d3a7c"
    );
  });

  it("never lets the mainnet table answer for devnet", () => {
    const onlyMainnet = DEPLOYMENTS.slice(DEPLOYMENTS.indexOf("## Mainnet"));
    expect(() => readDeployedBuild(onlyMainnet)).toThrow(/Devnet \(live\)/);
  });

  it("refuses a record whose hash is not a hash", () => {
    expect(() => readDeployedBuild(DEPLOYMENTS.replace(/08746FAA[0-9A-F]+/, "unknown"))).toThrow(
      /not a sha256/
    );
  });
});

describe("a sale from an earlier build", () => {
  it("passes on the layout reason the SDK gave, so it is the first thing printed", () => {
    const thrown = new PanguLayoutError(
      "a SaleRules account is 362 bytes and these are 427, so they were written by another build of the program"
    );
    expect(earlierBuildReason(thrown)).toContain("427");
  });

  it("leaves every other failure to be reported as a failure", () => {
    expect(earlierBuildReason(new PanguInputError("mint must be a PublicKey"))).toBeNull();
    expect(earlierBuildReason(new Error("the RPC timed out"))).toBeNull();
    expect(earlierBuildReason("not even an error")).toBeNull();
  });
});
