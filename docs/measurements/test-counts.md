# Test counts, every suite, 23 September 2026

The numbers the README, the rubric and the proof section quote. Four suites
were run fresh on this date on the development machine; the fork suite is
quoted from its own recorded run because it needs a forked mainnet validator.

| Suite | Command | Result |
| --- | --- | --- |
| Program, Rust unit tests | `scripts/wsl/test.sh` (runs `cargo test -p pangu --lib`) | `test result: ok. 27 passed; 0 failed; 0 ignored` |
| Program, litesvm suite (mocha) | `scripts/wsl/test.sh` | `125 passing (1m)`, `TEST-OK` |
| SDK, `pangu-sdk` | `npx vitest run` in `packages/sdk` | `Test Files 9 passed (9)`, `Tests 117 passed (117)` |
| Scripts | `npx vitest run` in `packages/scripts` | `Test Files 5 passed (5)`, `Tests 49 passed (49)` |
| Forked mainnet, whole sale life against real Meteora programs | `scripts/wsl/fork-test.sh` | 36 steps passing, recorded in `price-band-pyth.md` on 21 September 2026; not re-run on this date |

Two earlier write-ups carry smaller counts because they were taken before later
work added tests: `price-band-pyth.md` records 119 litesvm tests, and
`sdk-pyth.md` records 113 SDK and 24 script tests. `fork-test.md` records the
first fork suite at 19 steps before the SDK fork steps and the band steps were
added. The table above is the current state.
