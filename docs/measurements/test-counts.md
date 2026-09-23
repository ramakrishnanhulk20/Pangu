# Test counts, every suite, 23 September 2026 (rules v2)

The numbers the README, the rubric and the proof section quote. Four suites
were run fresh on this date on the development machine after the rules v2
build (the fifth devnet deploy); the program's fork suite is quoted from its own
run of the same day because it needs a forked mainnet validator.

| Suite | Command | Result |
| --- | --- | --- |
| Program, Rust unit tests | `scripts/wsl/test.sh` (runs `cargo test -p pangu --lib`) | `test result: ok. 31 passed; 0 failed; 0 ignored` |
| Program, litesvm suite (mocha) | `scripts/wsl/test.sh` | `137 passing (57s)`, `TEST-OK` |
| SDK, `pangu-sdk` | `npx vitest run` in `packages/sdk` | `Test Files 11 passed (11)`, `Tests 146 passed (146)` |
| Scripts | `npx vitest run` in `packages/scripts` | `Test Files 11 passed (11)`, `Tests 109 passed (109)` |
| Forked mainnet, whole sale life against real Meteora programs, program suite | `scripts/wsl/fork-test.sh` | 37 steps passing, `FORK-TEST-OK`, recorded in `fork-test.md` under the run of 23 September 2026 (the v2 rules, including the offering period step) |
| Forked mainnet, SDK suite | `scripts/wsl/sdk-fork-test.sh` | not run on the v2 interface: the public mainnet node refused the validator's account clone on this date; the last recorded run in `sdk-fork-test.md` is on the previous interface |

Earlier write-ups carry smaller counts because they were taken before later
work added tests: the first `test-counts.md` of this date, before rules v2,
recorded 27 Rust, 125 litesvm, 117 SDK, 49 script and 36 fork; `price-band-pyth.md`
records 119 litesvm; `sdk-pyth.md` records 113 SDK and 24 script; `fork-test.md`'s
first run recorded 19 steps. The table above is the current state.
