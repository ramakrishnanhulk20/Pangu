# pangu-sdk against the real Meteora programs

Date: 22 September 2026.

This is the run from the morning of that day, when the price band still read
Switchboard. The band moved to Pyth the same afternoon, and the run that proves
the band as it stands now is in `sdk-pyth.md`: same fork, Pyth's price update
account, `PriceOutsideBand` and `PriceStale` both predicted and then refused by
the chain. Everything below about the sale itself, the caps, the bytes and the
compute units still holds, because none of that changed. The devnet price
refresh recorded further down is the Switchboard one, kept as the record of what
was measured; the Pyth refresh replacing it is in `sdk-pyth.md`.

A whole sale run on a local validator holding Meteora's real mainnet Dynamic
Bonding Curve and DAMM v2 programs, driven only by the `pangu-sdk` package plus
web3.js. Nothing was sent to mainnet. The price refresh is proven on devnet with
real transactions.

Run the fork proof with:

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/sdk-fork-test.sh
```

Result: `SDK-FORK-OK`. Unit tests: 85 pass across 7 files.

## Versions

| Thing | Value |
|---|---|
| Meteora SDK | `@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12, pinned exactly |
| Price feed | `@pythnetwork/pyth-solana-receiver` 0.16.0, the one package the `pangu-sdk/price` entry adds. On the morning of this run it was `@switchboard-xyz/on-demand` 3.10.6 and `@switchboard-xyz/common` 5.8.5, and the fork test has run on Pyth since. |
| web3.js | 1.98.4, a peer dependency |
| Entry points | `pangu-sdk` (browser safe), `pangu-sdk/dbc`, `pangu-sdk/price` |

## What ran

Part one, a mode 1 sale priced in SOL, every step through the package:

1. The partner opened a launch template. The package forced Token-2022, Pangu as
   the hook, graduation to DAMM v2 and fees in the paying token only.
2. The creator opened the pool and the sale's rules in one transaction, with the
   cap given as `capShareBps: 1000`, a tenth of what the curve sells, worked out
   from the template rather than typed in.
3. `preflightBuy` said `BuyerRecordMissing`, then `NotApproved` after the record
   was opened, both before anything was signed.
4. The issuer approved the buyer and the buy went through. The tokens received
   matched Meteora's own quote exactly.
5. `preflightBuy` predicted `OverCap` with 49,007,450,880,445 raw units of room
   left, and the real transaction was then refused with `OverCap`, read out of
   the logs by `panguErrorFromLogs`.
6. The holder sold back to the pool. Both fee claims landed, and no sale token
   moved on either, which is C11.
7. Fourteen fresh approved buyers filled the curve, the last one through a
   partial fill. Raised 5,000,000,001 of 5,000,000,000 lamports.
8. Anyone migrated the graduated pool to DAMM v2, `saleProgress` reported the new
   pool, `saleStanding` reported 15 buyers with the largest holding 10.00 percent
   against a cap share of 10.00 percent, and a buyer closed their record.

Part two, a banded sale on the same fork, using the quote accounts and the writer
program the program package's own band tests use:

9. Three buys walked the curve up. On the fourth, `preflightBuy` predicted
   `PriceOutsideBand` before signing, and the chain refused the same transaction
   with `PriceOutsideBand`.
10. A second banded sale whose market clock was pushed two hours back: the
    preflight predicted `MarketClosed`, and `readPrice` reported the same quote as
    unusable for the same reason while still carrying a good price.

## What each action costs

Transaction size limit is 1232 bytes. Every swap carries a compute budget
instruction, which is what a real client sends.

| Action | Bytes | Compute units |
|---|---|---|
| Launch template | 662 | 30,854 |
| Pool plus the sale's rules, one transaction | 1,001 | 91,322 |
| Open a buyer record | 310 | 11,961 |
| Approve a buyer | 342 | 9,808 to 16,658 |
| First buy | 910 | 114,166 |
| A later buy | 910 | 103,679 to 125,361 |
| Sell back to the pool | 878 | 79,355 |
| Partner fee claim | 886 | 62,692 |
| Creator fee claim | 853 | 51,742 |
| Migrate to DAMM v2 | 1,139 | 147,633 |
| Close a buyer record | 244 | 4,478 |
| Banded pool plus rules | 1,030 | 104,845 |
| A buy in a banded sale | 978 to 988 | 126,446 to 145,474 |
| Price refresh, devnet | 717 | 928 |

The compute limits the package asks for, each about double what the action
measured: 300,000 for a swap, 150,000 for a fee claim, 200,000 for a price
refresh. Migration asks for none on purpose: it used 147,633 against the 200,000
a single instruction gets by default, and the transaction is already 1,139 bytes.

The two numbers that matter. The pool and the rules fit in one transaction with
231 bytes to spare even for a banded sale, so nobody but the pool's creator can
ever set the rules. And a buy costs about 115,000 units, or 145,000 in a banded
sale, against a 1.4 million limit.

## Devnet: the price refresh, on Switchboard

This is the Switchboard refresh, kept as the measurement it was. The Pyth one
that replaced it, with its own fees and compute units, is in `sdk-pyth.md`.

The production AAPL feeds, queue `EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7`,
quote account `7uPLLyB29H9sATzjKi1DKWgqD2YXrjp8YS8QpEZi5b1Z`. Sent twice from
`packages/sdk/scripts/refresh-devnet.ts`, then read back with `readPrice`'s own
decoder, which uses no Switchboard package.

| Run | Signature | Quote slot | AAPL | Fee |
|---|---|---|---|---|
| 1 | `2zSi9CMeXbJ4FJVdXvRgUbkNYiTETbs66bFViw4zh9n6vaZBRCz4EWHVFuMWDjg8hsmjS4EQM8BS5dzie2YeXwB9` | 502,034,846 | 338.67 dollars | 14,000 lamports |
| 2 | `2FSgdf2j18zNsTAtJxEuzFp2zgnX2yqqca5zgRg6TKyWyiYSZ6AEMChDwJ2PSThFZhBqfbBsCykXGH37thbqQ2v` | 502,034,927 | 338.76 dollars | 14,000 lamports |

Same address both times, 81 slots fresher the second time, 928 compute units each
and 28,000 lamports in total. The payer is a throwaway devnet key outside the
repository.

## What this does not prove

- The credential access mode through the package. The published account list
  carries its three extra accounts the same way a band's four are carried, and the
  program package's own fork tests cover the mode itself.
- The oracle signature and slot hash checks. No local chain runs Switchboard's
  quote program, so the fork's quotes are written by a stand-in. The devnet
  refresh above is the live half of that proof.
- DAMM v2's behaviour after migration, which is Meteora's, not ours.

## Two things learned about the SDK

1. **A transfer hook template is not a `poolConfig`.** `createConfigWithTransferHook`
   writes a `configWithTransferHook` account with the ordinary config nested
   inside, so reading it as a `poolConfig` fails on the discriminator. The package
   reads it through Meteora's own state service, which knows both shapes.
2. **Exact-in cannot finish a curve.** The tokens run out before the paying side
   does, and Meteora's own quote then refuses an exact-in swap with "Insufficient
   Liquidity", so the last buyer of every sale needs a partial fill. That is why
   `buyTransaction` takes `fill: "partial"`. Without it a sale can stop one
   lamport short of graduation and stay there.

## Run of 23 September 2026: the v2 rules

Same command, against the build whose rules store the paying token and the end
of the offering period. Binary SHA256
`191e9cf1ab6f9ababc1fb50c1f279b7f19e305934fff0952f8155b4f85a10731`, IDL SHA256
`48836ab193d10b8a58321a9f6777640bc43873f207a6210f2de18c1a47032772`.

Result: all 15 steps pass, a to o, `SDK-FORK-OK`. Nothing was sent to mainnet.

What changed since the run above:

- The package builds the v2 instructions. The sale's rules carry the paying
  token's mint and an optional end of the offering period, and closing a buyer
  record passes the sale's rules.
- A banded sale's cap was the whole curve, which the program now refuses. It is
  half the curve, and the walk up to the ceiling is spread over three wallets,
  each kept under the cap. The preflight predicted `PriceOutsideBand` on the
  fourth buy and the chain refused it with the same error.
- The validator cloned Meteora's accounts through a keyed mainnet node read from
  `MAINNET_RPC_URL` in the root `.env`. The public node had refused the clone
  earlier the same day, which is why this suite had not yet run on the v2
  interface. The URL carries a key and appears in no log.

The proof numbers hold: the curve raised 5,000,000,001 of 5,000,000,000
lamports, 15 buyers, the largest holding 10.00 percent against a cap share of
10.00 percent. `PriceStale` was predicted and then refused on the shut market.

| Action | Bytes | Compute units |
|---|---|---|
| Pool plus the sale's rules, one transaction | 943 | 93,264 |
| First buy | 910 | 114,341 |
| A later buy | 910 | 112,831 to 126,343 |
| Sell back to the pool | 878 | 84,033 |
| Migrate to DAMM v2 | 1,139 | 152,120 |
| Close a buyer record, now with the rules | 277 | 6,320 |
| Banded pool plus rules | 940 | 99,530 |
| A buy in a banded sale | 912 to 922 | 103,426 to 125,465 |

Migration still asks for no compute limit of its own: 152,120 units against the
200,000 a single instruction gets by default.

## Run of 23 September 2026: the dollar list

Same command, against the sixth devnet deploy's build, which sets a price
ceiling only when buyers pay in a dollar on the build's list. Binary SHA256
`e40ab680c3ff8a806e51b66b014765674b95ccbd6ead553729689ab20c4cb59f`, IDL SHA256
`0395b2857f9e1015ceda0ef990afce8deac2a98792f631948a7a6406fe35d5b1`. The build
check found devnet USDC and the demo dollar in the binary and mainnet USDC not
in it.

Result: all 16 steps pass, a to p, `SDK-FORK-OK`. Nothing was sent to mainnet.

What changed since the run above:

- The banded sales pay in the demo dollar
  `2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5`, not a token the test makes.
  The fork validator already plants it before genesis for the program's own
  suite, with a throwaway mint authority kept outside the repo, and step l
  checks the planted mint (six decimals, that authority, no freeze authority)
  and that the package's `dollarMints("devnet")` lists it before minting to the
  buyers.
- Step p is new. A fresh token with six decimals and no freeze authority, which
  looks exactly like a dollar and is not on the list, gets a launch template,
  and the banded pool and rules on it are refused with `BandNeedsDollarQuote`.
  The refused transaction left no pool and no rules behind: the pool and the
  rules go in one transaction, so both are refused together.

The proof numbers hold: the curve raised 5,000,000,001 of 5,000,000,000
lamports, 15 buyers, the largest holding 10.00 percent against a cap share of
10.00 percent. `OverCap`, `PriceOutsideBand` and `PriceStale` were each
predicted and then refused by the chain.

| Action | Bytes | Compute units |
|---|---|---|
| Pool plus the sale's rules, one transaction | 943 | 99,256 |
| First buy | 910 | 132,341 |
| A later buy | 910 | 124,850 to 153,354 |
| Sell back to the pool | 878 | 103,533 |
| Migrate to DAMM v2 | 1,139 | 144,612 |
| Close a buyer record | 277 | 7,820 |
| Banded pool plus rules, paid in the demo dollar | 940 | 108,541 |
| A buy in a banded sale | 912 to 922 | 113,926 to 131,465 |

## Run of 23 September 2026: the SBPF v3 build

Same command, against the same source built as SBPF v3, the format that stays
deployable once SIMD-0500 is active. Binary SHA256
`7082897943e68901f85c8c93e2581a8a3571af41491ac9f242286592f4b388f8`, 339,848
bytes, IDL SHA256
`0395b2857f9e1015ceda0ef990afce8deac2a98792f631948a7a6406fe35d5b1`, unchanged
from the dollar list run above. `sdk-fork-test.sh` now refuses anything but a
v3 binary:

```
fork suite binary: /home/ram/pangu-build/target/deploy/pangu.so, SBPF v3, sha256 7082897943e68901f85c8c93e2581a8a3571af41491ac9f242286592f4b388f8
SDK-FORK-OK
```

Result: all 16 steps pass, a to p, `SDK-FORK-OK`, with no change to the
package. Nothing was sent to mainnet. The proof numbers hold: the curve raised
5,000,000,001 of 5,000,000,000 lamports, 15 buyers, the largest holding 10.00
percent against a cap share of 10.00 percent.

Compute units, whole transactions, the dollar list run (v0) against v3:

| Action | v0 | v3 |
|---|---|---|
| First buy | 132,341 | 120,318 |
| A later buy | 124,850 to 153,354 | 112,811 to 147,315 |
| Sell back to the pool | 103,533 | 90,010 |
| Migrate to DAMM v2 | 144,612 | 149,112 |
| Close a buyer record | 7,820 | 9,313 |
| Banded pool plus rules, paid in the demo dollar | 108,541 | 99,498 |
| A buy in a banded sale | 113,926 to 131,465 | 106,390 to 123,929 |

One sample each, DBC's work included, and a figure moves by up to about 15,000
units with the wallet, so read the direction rather than any one row: buys and
sells came in lower on v3.
