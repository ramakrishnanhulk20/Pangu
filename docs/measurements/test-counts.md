# Test counts, every suite, 23 September 2026 (the SBPF v3 build)

The numbers the README, the rubric and the proof section quote. Every suite
below was run fresh on this date on the development machine, the program suites
after the shipped binary moved to SBPF v3. The two fork suites ran on a forked
mainnet validator that cloned Meteora's accounts through a keyed mainnet node.

Which binary each program suite runs: `scripts/wsl/build.sh` makes two files
from one source. `target/deploy/pangu.so` is SBPF v3, the binary devnet runs,
and the fork suites and the mainnet rehearsal load it. The unit suite runs on
solana-bankrun 0.4.0, which cannot load SBPF v3, so it runs
`target/deploy/pangu-v0-for-unit-tests.so`, the same source built as v0, which
nothing deploys.

| Suite | Command | Binary | Result |
| --- | --- | --- | --- |
| Program, Rust unit tests | `scripts/wsl/test.sh` (runs `cargo test -p pangu --lib`) | none, host build | `test result: ok. 31 passed; 0 failed; 0 ignored` |
| Program, bankrun suite (mocha) | `scripts/wsl/test.sh` | v0 unit-test build, sha256 `e40ab680...` | `141 passing (1m)`, `TEST-OK` |
| SDK, `pangu-sdk` | `npx vitest run` in `packages/sdk` | none | `Test Files 14 passed (14)`, `Tests 178 passed (178)` |
| Scripts | `npx vitest run` in `packages/scripts` | none | `Test Files 12 passed (12)`, `Tests 126 passed (126)` |
| Forked mainnet, whole sale life against real Meteora programs, program suite | `scripts/wsl/fork-test.sh` | v3, sha256 `7082897...` | `38 passing (5m)`, `FORK-TEST-OK`, recorded in `fork-test.md` under the SBPF v3 run |
| Forked mainnet, SDK suite | `scripts/wsl/sdk-fork-test.sh` | v3, sha256 `7082897...` | 16 steps passing, a to p, `SDK-FORK-OK`, recorded in `sdk-fork-test.md` under the SBPF v3 run |
| Mainnet rehearsal on forked mainnet with mainnet's feature gates | `scripts/wsl/mainnet-rehearsal.sh` | the verified v3 mainnet build | `MAINNET-REHEARSAL-OK`, recorded in `mainnet-rehearsal.md` under the SBPF v3 run |

Earlier write-ups carry smaller counts because they were taken before later
work added tests: the rules v2 count of this date recorded 31 Rust, 137
bankrun, 146 SDK, 109 script, 37 fork and 15 SDK fork steps; the first
`test-counts.md` of this date, before rules v2, recorded 27 Rust, 125 bankrun,
117 SDK, 49 script and 36 fork; `price-band-pyth.md` records 119 bankrun;
`sdk-pyth.md` records 113 SDK and 24 script; `fork-test.md`'s first run
recorded 19 steps. Those earlier write-ups called the unit suite litesvm; it
has always run on solana-bankrun. The table above is the current state.
