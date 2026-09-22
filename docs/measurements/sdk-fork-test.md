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
