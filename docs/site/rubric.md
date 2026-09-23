---
title: Rubric
description: Meteora bounty text mapped line by line to Pangu code, tests, and live devnet transactions.
---

This page is copied as is from the repository's own rubric file, so nothing in it is trimmed or softened for a judge reading it here.

# Rubric: Meteora's bounty, checked line by line

Pangu is a rules program that Meteora's Dynamic Bonding Curve (DBC) attaches to a
new stock token for the length of its first sale. DBC finds the price. Pangu
decides who may receive tokens and how many, then DBC removes Pangu from the
token for good when the sale fills, or lifts every rule when the sale's
offering period ends, whichever comes first. One line pitch: we help stock token issuers
run a fair first sale on Meteora DBC, where the curve finds the price and no bot
or whale can take more than their share.

## 1. Meteora's bounty, line by line

Source: the program page's "Meteora: $5,000, Best Use of Meteora DBC" section,
copied verbatim.

| Their words | What Pangu does | Where in the code | Test | Live transaction |
|---|---|---|---|---|
| "you control the curve shape, fee schedule, quote token" | Pangu does not change any DBC curve setting. It reads the pool's own launch template and refuses only what would hurt buyers: fees paid out in the sale token instead of the paying token (see row below), a paying token the issuer can freeze, and a price band on a sale not priced in a dollar token. Every other curve, fee and quote choice stays the issuer's. | `packages/scripts/src/curve.ts` builds the DBC template; `programs/pangu/src/instructions/create_sale.rs` reads it back | `tests/create_sale.ts` "reads the same launch template the Meteora SDK does" | template tx [`526NJoSp`](https://explorer.solana.com/tx/526NJoSpZHxJWy95YEwet2b3gUyKDXSW5rBRGjs3nDTtBuNgB3h2tFwafLHXvSNDdvjsRQtn3s9uzGzvD2ZScmGq?cluster=devnet), devnet-run.md. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "graduation threshold, and how the pool migrates into Meteora DAMM v2 liquidity" | Pangu leaves graduation entirely to DBC. It only removes itself as a side effect: when the curve fills, DBC's own migration strips the transfer hook from the mint in the same trade. | `docs/measurements/fork-test.md` (migration step); no Pangu code runs here by design | `fork-tests/life.ts` "k. fresh buyers fill the curve and DBC takes the hook off the mint" and "l. anyone can migrate the graduated pool to DAMM v2" | migration tx [`5CpV8KRe`](https://explorer.solana.com/tx/5CpV8KReoYeRqXzeLDvfxuGM2yp99Mex6bTKRjutccd9HcmzZ2b1X36fVsPeuVHb7sQA3PuCkLRE8RJHbogiEPVT?cluster=devnet) of the graduated list sale PLIST, mint `2ARD1KwvxyjLPwe46rivjxPRyMzvxSEPGvwKTqcNXpFR`, into DAMM v2 pool `2cEAoE9zi53y736DsaPBzgfdrUqJnVgqwutZTGsmsSLc`, `docs/measurements/devnet-run.md`, "The fourth run". mainnet: not deployed for this submission, one script and about 4 SOL away |
| "We want to see what it looks like for tokenized stocks" | The sale rules are stock-sale specific: a per-wallet cap so no single buyer takes the float, an optional approved-buyer gate, and an optional price ceiling measured against the stock's real market price, not just a curve number. | `programs/pangu/src/instructions/execute.rs` (the hook decision) | `tests/buys.ts`, `tests/approvals.ts`, `tests/credential.ts`, `tests/band.ts` | sixth run: on PBAND2 (mint `5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo`) the cap refused [`2jbjpk64`](https://explorer.solana.com/tx/2jbjpk64u5KUS9pZ5cFJfrwj1A95akaJYW95guv7FC2wrUC5Qh2tHueDYgxNsECKqsrmPszGDcH6BDPMsXMEKBXw?cluster=devnet) OverCap and the ceiling refused [`4LXby4Fw`](https://explorer.solana.com/tx/4LXby4FwaytfNkRtj6TwyMWsm92iZFbyTEG6mvf8iwMxMdbwgKFaczDWMuexBgiqmK58UDFJ6iusQQt51vaEAYRc?cluster=devnet) PriceOutsideBand; on PVRFD (mint `7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn`) the verifier gate refused [`2dvaB2gc`](https://explorer.solana.com/tx/2dvaB2gcFvwmdmQbYHV2wuuGKtQfTdPUk6yZNWXTMyrFHE9XVkeWZM2N7tGiwysNDx8jHUTrGxMkBFWDK3G3iPGi?cluster=devnet) CredentialInvalid. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "Build something on DBC that outlasts the current meme-stock meta" | Meteora's own push this quarter (DAMM v2 0.2.4, DBC stock tokens as the paying token, StockLaunch on 15 Sep) is toward stock-paired launches generally, not one memecoin. Pangu is indifferent to which token pays: the same rules program covers a dollar-priced sale and a stock-paired one, and a launchpad like StockLaunch is a second kind of customer for it, not only an issuer. | fork test buys with real AAPLx | `fork-tests/stock-quote.ts` "a. the partner creates a template quoted in AAPLx" and "d. an approved buyer buys under the cap, paying in AAPLx"; `docs/measurements/fork-test.md`, "launched and bought with real AAPLx as the paying token" | fork test only, not yet run live on devnet or mainnet. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "launch mechanics tuned for equity-like assets (price discovery for thinly traded or newly tokenized stock pairs)" | The price band is the equity-specific mechanic: a buy is refused if it would push the curve price more than `band_bps` above the live stock price, so early illiquidity cannot be used to print a runaway price against latecomers. Sells are never blocked by the band. | `programs/pangu/src/instructions/execute.rs` band check; `programs/pangu/src/price.rs` | `tests/band.ts`, threat model C9 | demo sale mint [`5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo`](https://explorer.solana.com/address/5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo?cluster=devnet) (PBAND2), open, priced in a demo dollar, offering period to 7 October 2026: a buy past the ceiling refused live on devnet with `PriceOutsideBand`, [`4LXby4Fw`](https://explorer.solana.com/tx/4LXby4FwaytfNkRtj6TwyMWsm92iZFbyTEG6mvf8iwMxMdbwgKFaczDWMuexBgiqmK58UDFJ6iusQQt51vaEAYRc?cluster=devnet), `docs/measurements/devnet-run.md`, "The sixth run". The fifth run's PBAND was refused the same way, [`3FMhcSoC`](https://explorer.solana.com/tx/3FMhcSoCkFCp3PBMBjaejwEiXVmdDAREJCDaP2bYw2u2hGxanesdx5vi2cEU2ZMK1obRZhcUgWFKQ1tqMUy8sXDU?cluster=devnet). The same refusal is also proven in the fork test, `docs/measurements/sdk-fork-test.md`. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "novel curve or fee configurations" | Partly. Pangu invents no curve shape; it fixes the configuration a stock sale needs and refuses anything else: fees collected only in the paying token so no fee movement ever passes through the rules, minting power revoked at launch so the supply buyers see is final, a Token-2022 base with Pangu as its hook, graduation into DAMM v2. The novelty Pangu claims is in the graduation rules, not the curve. | `packages/sdk/src/dbc/template.ts` `FORCED` and `withoutMintAuthority`; `create_sale.rs` `handle_create_sale` (fee mode and mint authority proven on chain) | `packages/sdk/test/dbc.test.ts` "the settings a Pangu sale forces"; `tests/create_sale.ts` "refuses a template that collects fees in the sale token" and "refuses a mint that can still be minted" | devnet: every sale in `docs/measurements/devnet-run.md` was opened through this template; mainnet: not deployed for this submission, one script and about 4 SOL away |
| "creative graduation rules" | Pangu's "creative" part sits before graduation, not at it: the per-wallet cap, the two approval modes (issuer list or a Solana Attestation Service credential), and the price band are the graduation-time state Pangu leaves behind for DBC to migrate cleanly, since a fair pre-graduation sale means a fair set of DAMM v2 holders on day one. | `ARCHITECTURE.md`, "The rules program, in plain words" | `fork-tests/life.ts`, steps d to o and "p. once the offering period ends, every rule lifts before graduation" | the PLIST migration tx above. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "tooling that helps issuers configure and monitor DBC pools" | The TypeScript package and the five scripts (launch, seed, prove, graduate, refresh-price) are that tooling: one command creates a template, pool and rules together, one command runs and prints every attack against a live sale. | `packages/sdk`, `packages/scripts/src` | 146 SDK tests, 109 script tests | devnet-run.md, every command in section 5 below. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "Working code on mainnet beats slides" | Devnet is fully proven (program deployed, upgraded, and run end to end with real transactions across six recorded runs). The mainnet deploy script is written and waits only on a funded mainnet wallet and a go from the team. | `scripts/wsl/deploy.sh` | `program-info.sh` hash check | devnet program `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG`, docs/deployments.md. mainnet: not deployed for this submission, one script and about 4 SOL away, this is the one bounty line not yet true |
| Judging: "originality of the DBC configuration or use case" | The hook-pool rules layer plus the equity price band is not something the fork test or the mainnet pool listing shows elsewhere. | none | none, a research finding not a test | none |
| Judging: "technical soundness" | 31 Rust tests, 137 litesvm tests, 37 forked mainnet steps (the program's full sale life against real cloned DBC, DAMM v2 and attestation programs; the SDK's own fork suite could not copy its accounts from the public mainnet node on 23 September 2026 and is not counted), 146 SDK tests, 109 script tests, 10 randomized attack sequences of 6,000 operations, six live devnet runs with every refusal landed as a real transaction and all three access modes attacked on the live program, a full code review with findings fixed, and the program audit of 23 September that added C18 to C21. | see section 5 for exact commands | all of the above | test-counts.md, devnet-run.md, fork-test.md, random-sequences.md |
| Judging: "whether the idea has a life after the hackathon" | On the roadmap: a launchpad like StockLaunch is a second customer type, the upgrade key stays with the team so a bug found after judging can be fixed, and Dynamic Fee Sharing is scoped as a next step to give a verifier a reason to keep approving buyers. | none | none, a roadmap statement | none |

## 2. Threat model section C, invariant by invariant

Source: `docs/security/threat-model.md` section C. Devnet transactions are from
the second run in `docs/measurements/devnet-run.md` (the upgraded, reviewed
build), unless marked otherwise. C18 to C21 came with the rules v2 build, the
fifth deploy, and their evidence is from the sixth run.

| # | Invariant, plain sentence | File and function | Test | Devnet transaction |
|---|---|---|---|---|
| C1 | Calling the hook directly, outside a real token transfer, changes nothing and fails. | `execute.rs`, the "genuinely mid-transfer" check at the top of the function | `tests/direct_call.ts` "fails and moves no counter when nothing is being transferred" | [`3PUW1bT9`](https://explorer.solana.com/tx/3PUW1bT9iKM5pLSGpRqdKe9HkrcaFGkGdmEG4wLk7DvtbVKsD6Vqzz9WZrBkXU6tRbN7PS5HNjc2EUdtJwdsJ7kg?cluster=devnet), NotTransferring |
| C2 | Every account the decision reads is proven to be the real one for its role, not a look-alike. | `execute.rs` account derivation checks | `tests/create_sale.ts` "refuses a pool account that is not owned by DBC"; `tests/credential.ts` "refuses an attestation owned by another program" and "refuses another wallet's attestation, wherever it is put"; `tests/band.ts` "refuses a price account owned by another program" and "refuses a pool account swapped for another DBC pool" | [`4HnSQqse`](https://explorer.solana.com/tx/4HnSQqsevXgaPTaPwEeB8YC2C1L8Ax6zLotHoSxVgWig5Lf5AxhdWCrjAgU5TRYhSf5XVnU8ZL3BCf2AGNptRUYd?cluster=devnet), BuyerRecordMissing. Credential mode, now landed on devnet: [`2dvaB2gc`](https://explorer.solana.com/tx/2dvaB2gcFvwmdmQbYHV2wuuGKtQfTdPUk6yZNWXTMyrFHE9XVkeWZM2N7tGiwysNDx8jHUTrGxMkBFWDK3G3iPGi?cluster=devnet), CredentialInvalid, a buyer with no attestation from the sale's verifier, sixth run (table below) |
| C3 | A wallet's net tokens bought never exceeds the cap, however many token accounts it uses. | `execute.rs`, `net_bought + amount <= cap` check keyed on wallet owner, not token account | `tests/buys.ts` "refuses a buy one unit over the cap", "adds buys together, so two small ones cannot pass the cap" and "counts two token accounts of one wallet against one cap"; `tests/random.ts`, the randomized sequences in `docs/measurements/random-sequences.md` | [`2PJuHfzp`](https://explorer.solana.com/tx/2PJuHfzpkM1rbeyUw8ZeYSm7TXKQFDPqjatw8j8WEPM4xxJoubYxJ7XpEdZGnnCEFzwB6HLfdheotRGJuqhU19Px?cluster=devnet), and a second-account attempt [`2zK4gSTC`](https://explorer.solana.com/tx/2zK4gSTC4xWLev4tMV27cLUn8ubrnhRS2HQ3k6Kpcf1aP4UjKp1duZ75KBnXNvQf1HDEbNv2eAmHswMxZWHJZU9M?cluster=devnet), both OverCap |
| C4 | During the sale a token can only move between a wallet and the pool vault, never wallet to wallet. | `execute.rs`, the wallet-to-wallet branch | `tests/transfers.ts` "refuses a move from one wallet to another" | [`4k9Aiot3`](https://explorer.solana.com/tx/4k9Aiot33BububatD31ku3DzVJgDTyXuHchACXbk2Ebfi7LXFRR7xfZcUhtEcJRu6kD2WrmYUTSkUy9euowYnLAP?cluster=devnet), WalletToWalletDuringSale |
| C5 | A holder can always sell back to the pool. No missing account or stale rule can block a sell. | `execute.rs`, the sell branch reads only the source owner's record if it exists | `tests/sells.ts` "lets a revoked wallet sell everything it holds" and "lets a wallet with no record at all sell"; `tests/random.ts`, the 1,330 simulated exit sells in `docs/measurements/random-sequences.md` | [`WiANjhTm`](https://explorer.solana.com/tx/WiANjhTmTM6H9K1N23axK8GX5oEnYnFhqkgzNBHSdkUo4Gr2arvhqBsz8vequdXxPjNGpPgd1eQ8XPTwToj6BXo?cluster=devnet), a revoked wallet's sell goes through |
| C6 | With the approved-buyer list on, tokens leave the pool only to a wallet approved at that moment. | `execute.rs` mode 1 branch, `approve_buyer.rs`, `revoke_buyer.rs` | `tests/buys.ts` "refuses an unapproved wallet when the issuer's list is in force" and "stops a revoked wallet from buying again" | [`549vJCdN`](https://explorer.solana.com/tx/549vJCdNFguFHCEGEkNTPRBxSHrXLapbDZq5mFzhhkBf5e2WEZUABjoGwFBryFEgA6W72xhFbEcA4y7Bt8L1Kx75?cluster=devnet), NotApproved |
| C7 | The sale rules and the extra-accounts list for a mint are created once, only by the pool's creator, in the same transaction as the pool. | `create_sale.rs`, `creator == signer` check, `init` constraint | `tests/create_sale.ts` "refuses a signer who did not create the pool" and "cannot be run twice for the same mint" | pool and rules transaction [`23s4BVPA`](https://explorer.solana.com/tx/23s4BVPAH32bSTM9QphHZMucrikhj1ixyqGcE7hB3LJftVHGMbf5tVPydxrHQDVzicYYBJRowLoUAYsSfE32eUJ9?cluster=devnet) |
| C8 | Rules that affect buyers cannot change invisibly; the cap can never change after the first trade. | `create_sale.rs` (rules set once, no update instruction), `SaleCreated` event | no test: the proof is an absence, `lib.rs` declares no instruction that changes a sale's rules; `tests/create_sale.ts` "cannot be run twice for the same mint" | none needed, absence of an instruction is proven by the IDL, not a transaction |
| C9 | A banded buy only succeeds with a fresh, positive, correctly-sourced price inside the band; a doubtful price refuses the buy and never the sell. | `execute.rs` band branch, `price.rs` | `tests/band.ts` | [`4LXby4Fw`](https://explorer.solana.com/tx/4LXby4FwaytfNkRtj6TwyMWsm92iZFbyTEG6mvf8iwMxMdbwgKFaczDWMuexBgiqmK58UDFJ6iusQQt51vaEAYRc?cluster=devnet), PriceOutsideBand, a buy past the ceiling on the sixth run's demo sale PBAND2, `docs/measurements/devnet-run.md`, "The sixth run", and [`3FMhcSoC`](https://explorer.solana.com/tx/3FMhcSoCkFCp3PBMBjaejwEiXVmdDAREJCDaP2bYw2u2hGxanesdx5vi2cEU2ZMK1obRZhcUgWFKQ1tqMUy8sXDU?cluster=devnet), the same refusal on the fifth run's PBAND; also proven in the fork test, `docs/measurements/sdk-fork-test.md`. Earlier, [`7pNLsop6`](https://explorer.solana.com/tx/7pNLsop6fy65BiSncecGnF9nAcEuD6GaXmoATW7xGvqpc8UQpRFcVQbSRNY5oQyQ83K4WkgxT2nnJoCS6ZqkaNq?cluster=devnet), PriceStale (no live gateway that morning) |
| C10 | All counter math is checked; a sell larger than a wallet's recorded buys floors the record at zero, never underflows. | `execute.rs`, `saturating_sub` on the sell path | `tests/sells.ts` "floors the record at zero when the sell is larger than it"; `tests/random.ts`, the randomized sequences in `docs/measurements/random-sequences.md` | none isolated on devnet, covered by the 1,330 simulated exit sells in those sequences |
| C11 | The launch template must pay fees in the paying token only, never the sale token. | `create_sale.rs`, `collect_fee_mode == QuoteToken` check (byte 232 of the template) | `tests/create_sale.ts` "refuses a template that collects fees in the sale token", Rust test against the real mainnet template bytes | none live (every devnet launch already uses QuoteToken by construction) |
| C12 | Scripts never hold or print a private key; every address that receives money is shown to the signer before signing and read back after. | `packages/scripts/src/wallets.ts`, `chain.ts` | `packages/scripts/test/environment.test.ts` "never quotes a base58 secret back", `packages/scripts/test/wallets.test.ts` "brings every wallet's SOL back when the run throws partway", and the rest of the scripts suite (109 tests) | devnet-run.md, no key ever printed in any of the five commands' output |
| C13 | Tokens leave the pool vault only into a token account whose owner can never change (an associated token account). | `execute.rs`, `ImmutableOwner` extension check on the destination | `tests/buys.ts` "refuses a buy into an account whose owner can still change" | [`5mKWFBtb`](https://explorer.solana.com/tx/5mKWFBtbUQi6S1dk92c26AiuPDRtQYZy3kiRWKSAG1n4ySYrLD1wR67gxQLDqMu9eGcEy9ZLwQDwtYeZWixL26pq?cluster=devnet), ReceivingAccountOwnerCanChange |
| C14 | No sale token can come into existence except from the pool vault; `create_sale` refuses a mint whose minting power is still live. | `create_sale.rs`, mint authority check | `tests/create_sale.ts` "refuses a mint that can still be minted" | first launch attempt against the upgraded program was refused with MintAuthorityStillSet (error 6021), see devnet-run.md "The new rule bit first" |
| C15 | The demo dollars route is the one server path that holds a key: it mints only the demo dollar, at most one grant per wallet per hour and ten a minute, with both slots reserved before any await, and the key never reaches a client, a response or a log. | `packages/web/lib/demo-dollars.ts`, `reserve`, `keep`, `release` and `mintAuthority`, imported only by `app/api/break/dollars/route.ts` | `packages/web/lab-evidence/break-dollars.txt`, 23 Sep 2026: a second call from the same wallet refused with 429, and a race of 12 fresh wallets at the same moment where 10 got past the reservation and 2 were refused with 429 | the grant in that file, [`Vs83nVSS`](https://explorer.solana.com/tx/Vs83nVSS6UKY19H6C3SYSFu82CvPBaWz3zkHw18htjfgsYA8ws9L5fxggiQfKRWRqJNV2vHW6pnWrbVwi8c3rEB?cluster=devnet) |
| C16 | A transaction the app builds for a visitor moves value only between that visitor and the pool vault, or to an account the visitor owns, never to a party the page chose, and every row states its cost before the wallet is asked to sign. | `packages/web/lib/break.ts`, the row builders | `packages/web/lab-evidence/break-simulations.txt`, 23 Sep 2026: all nine rows run on PBAND, every row's promise equal to the chain's answer, 0 off the standard | the honest buy sent in that run, [`3LGW2KfH`](https://explorer.solana.com/tx/3LGW2KfHqL5N4GRZza37rsL5wZR2p51LE6KSoc2MFqDFU3kFk6yJzgEpr3quPe2b4QF1bVhLtqz7HooEY2LzzuRh?cluster=devnet) |
| C17 | No public route lets an outsider spend the RPC budget the live numbers depend on: the price route answers only for mints in the app's own sale list, from a ten second cache. | `packages/web/app/api/price/[mint]/route.ts`, the `openedSales` check and the ten second cache; `packages/web/lib/pulse.ts`, the shared reading | by inspection | none, an off-chain limit |
| C18 | A banded sale is priced in a dollar token. The paying token is the one the launch template names, checked and stored for every sale. | `create_sale.rs`, `check_band` and `handle_create_sale` | `tests/band.ts` "refuses a band on a sale priced in wrapped SOL" and "refuses a paying token the template does not name" | PBAND2 opened on the rules v2 build banded and priced in the demo dollar `2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5`, which its rules now store: sale [`5Biy9QvC`](https://explorer.solana.com/tx/5Biy9QvCFgYNEPWFNzEA31aYF5c7vLFBu48jmSUkXa2ocb2akDLjmF6ARQQaZkTY21ZgARMVERpYWqLAocES1KYD?cluster=devnet), sixth run. No devnet transaction has been refused with `BandNeedsDollarQuote` |
| C19 | The issuer cannot freeze the paying token, so the exit in C5 is never the issuer's to close. | `create_sale.rs`, `handle_create_sale` | `tests/create_sale.ts` "refuses a paying token the issuer can freeze" and "opens on the same kind of paying token with no freeze authority" | both sixth run sales passed this check to open: PBAND2 [`5Biy9QvC`](https://explorer.solana.com/tx/5Biy9QvCFgYNEPWFNzEA31aYF5c7vLFBu48jmSUkXa2ocb2akDLjmF6ARQQaZkTY21ZgARMVERpYWqLAocES1KYD?cluster=devnet) and PVRFD [`3NGu6Wxg`](https://explorer.solana.com/tx/3NGu6WxguinVc8VyQSqA79kL3jkCXWhC5kAoaK2kdesSyP8ZHgcCwM8BhZgvLfVoAuZ9okAUbuwB8hwL7PEyVw5D?cluster=devnet). No devnet transaction has been refused with `IssuerControlsPayingToken` |
| C20 | The cap is below what the curve sells, so no single wallet can buy the whole sale. | `create_sale.rs`, `handle_create_sale` and `read_swap_base_amount` | `tests/create_sale.ts` "refuses a cap equal to everything the curve sells" and "opens with a cap one unit below what the curve sells" | PBAND2's cap is 1,099,999,999 raw units against the 10,999,999,990 its curve sells, sale [`5Biy9QvC`](https://explorer.solana.com/tx/5Biy9QvCFgYNEPWFNzEA31aYF5c7vLFBu48jmSUkXa2ocb2akDLjmF6ARQQaZkTY21ZgARMVERpYWqLAocES1KYD?cluster=devnet), and the cap held on devnet: [`2jbjpk64`](https://explorer.solana.com/tx/2jbjpk64u5KUS9pZ5cFJfrwj1A95akaJYW95guv7FC2wrUC5Qh2tHueDYgxNsECKqsrmPszGDcH6BDPMsXMEKBXw?cluster=devnet), OverCap, sixth run. No devnet transaction has been refused with `CapCoversWholeSale` |
| C21 | The offering period is fixed when the sale opens and cannot change. While it runs every rule holds; when it ends every rule lifts, so a curve that never fills cannot lock the token for good. | `create_sale.rs` `handle_create_sale` (`EndInThePast`), `execute.rs` `handle_execute`, `state.rs` `SaleRules::offering_is_over`, `close_buyer_record.rs` `handle_close_buyer_record` | `tests/offering.ts`, all five cases; the Rust test `the_offering_is_over_only_from_a_real_end_time_on_a_readable_layout` in `state.rs` | PBAND2 opened with its offering ending 7 October 2026 at 10:38:05 UTC, sale [`5Biy9QvC`](https://explorer.solana.com/tx/5Biy9QvCFgYNEPWFNzEA31aYF5c7vLFBu48jmSUkXa2ocb2akDLjmF6ARQQaZkTY21ZgARMVERpYWqLAocES1KYD?cluster=devnet), and every rule held on it afterwards: [`2jbjpk64`](https://explorer.solana.com/tx/2jbjpk64u5KUS9pZ5cFJfrwj1A95akaJYW95guv7FC2wrUC5Qh2tHueDYgxNsECKqsrmPszGDcH6BDPMsXMEKBXw?cluster=devnet) OverCap and [`4LXby4Fw`](https://explorer.solana.com/tx/4LXby4FwaytfNkRtj6TwyMWsm92iZFbyTEG6mvf8iwMxMdbwgKFaczDWMuexBgiqmK58UDFJ6iusQQt51vaEAYRc?cluster=devnet) PriceOutsideBand, sixth run. The lift itself has not happened on devnet: it falls after judging |

### Credential mode, now landed on devnet

Until the sixth run, credential mode was proven in the unit tests and the fork
test only. The sixth run opened a credential sale on the live program, PVRFD,
mint `7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn`, sale [`3NGu6Wxg`](https://explorer.solana.com/tx/3NGu6WxguinVc8VyQSqA79kL3jkCXWhC5kAoaK2kdesSyP8ZHgcCwM8BhZgvLfVoAuZ9okAUbuwB8hwL7PEyVw5D?cluster=devnet), and
attacked it. 10 attacks run, 8 refused as expected, 2 allowed as expected, 1 not
applicable (the ceiling, since this sale has no band), 0 off the standard.

| Attack | Invariant | Result | Devnet transaction |
|---|---|---|---|
| buy with no buyer record | C2 | BuyerRecordMissing | [`4jtZjc3K`](https://explorer.solana.com/tx/4jtZjc3Kk84ZTUKf4JNhvPG54mXe3mjvRY6hNVq7YTqhnPLWBZWjfKXKokvPH7dYcCDjJ9PyvcbPRK2rBjdfSYVD?cluster=devnet) |
| buy with no attestation from the sale's verifier | C2 | CredentialInvalid | [`2dvaB2gc`](https://explorer.solana.com/tx/2dvaB2gcFvwmdmQbYHV2wuuGKtQfTdPUk6yZNWXTMyrFHE9XVkeWZM2N7tGiwysNDx8jHUTrGxMkBFWDK3G3iPGi?cluster=devnet) |
| an attested wallet buys under the cap | C3 | goes through | [`3ym4DSTu`](https://explorer.solana.com/tx/3ym4DSTuYLPZztEKQwGyA231RB6pfq5MAw7TUWWj6mw1EWHNH3k3v87aBEM1G2kvfKEW21gPdCSYKbchHYZmti4X?cluster=devnet) |
| buy past the cap in one go | C3 | OverCap | [`3dg8z3XT`](https://explorer.solana.com/tx/3dg8z3XTWhjcw2CoXpgcFX1ogJ8qhrm6oQkYhxnL7mFAZFEU9Gj5ZXKoDiJwBJdm9rH94Bd4nQPtaoyGXixgSX9D?cluster=devnet) |
| a second buy that crosses the cap | C3 | OverCap | [`4EkrP5iH`](https://explorer.solana.com/tx/4EkrP5iHRSSvchWrqDdmyiZTmk8UyvwBp8fWXBzuzqwtcyKaNW8GHZeGNerBA13M38xRtPd9YcQWi9xgjh8LBV9i?cluster=devnet) |
| buy into a second token account of the same wallet | C3 | OverCap | [`wjCE8fHG`](https://explorer.solana.com/tx/wjCE8fHGgRWes49Gf98a8vfYGPfDYZDUT4gaxtkJzmLytMBwFpXr9KfheVc4pCHXi6HReQXo7GoqwJqkceDkhMD?cluster=devnet) |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | [`492nnf4q`](https://explorer.solana.com/tx/492nnf4qjMdwF8nfoqTGydTRZ7328rQRxdw1fHYTNWWTXxiT4XY7nqGGD5nNgbjfriccpiBRz4BEsADy25WrNa2z?cluster=devnet) |
| send tokens straight to another wallet | C4 | WalletToWalletDuringSale | [`48ruUbgr`](https://explorer.solana.com/tx/48ruUbgr1vBFuuQ1n64MokNvDikAxtmFHzgtLM1Lq8qw7hT5cDzutSFTtYHMe6aQPFsHGYZbZSmSiGVxBTUTwdVh?cluster=devnet) |
| call the hook on its own, with no transfer | C1 | NotTransferring | [`5KZe7mM3`](https://explorer.solana.com/tx/5KZe7mM34d79h9EZ7xPav18LuQ9W8SKaWL22w3A1zNKtShgCmpQgAFiGDFyiWYRP7TD2J6zqrAwz4c1nSqaLj9Y2?cluster=devnet) |
| an attested wallet sells back to the pool | C5 | goes through | [`2p97iWgJ`](https://explorer.solana.com/tx/2p97iWgJTshgZVo9M3H1rfngqZcL1NpdCbK4ZpmLGTUKHe8UqhE1iP7jXqgjqEyBeRiAJ6f1TeCFpEN6rVEWtYZ1?cluster=devnet) |

## 3. Why not Meteora's own Alpha Vault or Presale Vault

- Alpha Vault only sits in front of DLMM and DAMM pools. It cannot attach to a
  bonding curve at all, so it cannot run during price discovery, which is where
  a stock token's first buyers need protecting.
- Alpha Vault sells at one fixed price. Pangu's rules run inside a live curve,
  so the price is still discovered, not fixed.
- Presale Vault (beta, program `presSVxnf9UU8jMxhgSMqaRwNiT36qeBdNeTRKjTdbj`) is a
  standalone sale before any market exists: fixed price, first come, or pro
  rata. No curve, no price discovery.
- Pangu's rules run inside the DBC curve all the way to graduation, and selling
  back to the pool is always allowed, which neither Meteora product guarantees
  because neither is built for an ongoing curve.

## 4. Run the proof yourself

All Rust and TypeScript tests, no network needed:
```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/test.sh
```
Prints `rust: test result: ok. 31 passed` and a mocha summary of 137 passing, then
exits 0.

Full sale life against real cloned Meteora and attestation programs, on a forked
validator:
```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/fork-test.sh
```
Prints 37 passing fork tests, including the AAPLx-paid launch and the DAMM v2
migration, and exits 0. Takes about 4 minutes; run detached and tail the log for
anything longer, per the script's own header comment.

The devnet prove command, against the live program:
```
cd packages/scripts && npm run prove
```
Prints a table of attacks, an exit code, and the largest holder's share against
the cap. The sixth devnet run, against the banded dollar sale (PBAND2), ended:
```
proof    : the largest wallet holds 16.93 percent of the 6229218448 raw units sold, against a cap worth 17.66 percent of them
cost     : 0.011317 SOL, after 0.033344 SOL came back from the attacking wallets

9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
```
and exited 0. The same run against the credential sale (PVRFD), with
`--mint 7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn`, ended
`10 attacks run, 8 refused as expected, 2 allowed as expected, 1 not applicable, 0 off the standard`
and exited 0. `npm run launch`, `npm run seed`, and `npm run graduate` set up and
advance a sale the same way; `npm run refresh-price` refreshes the oracle quote
the band reads.

## 5. What this does not do

From `docs/security/threat-model.md`, "Non-goals, named", in plain words.

- One person can still hold many wallets. The cap is per wallet, and a cap is
  only as strong as the identity check behind the approved-buyer list. The
  issuer list mode has no identity check at all; the credential mode is as good
  as whoever issues the credential.
- After a sale graduates, Pangu's rules are gone for good. DBC removes the hook
  in the same trade that completes the curve. That is by design.
- When a sale's offering period ends, every rule lifts too, cap and approvals
  included, whether or not the curve filled. That is by design as well: a curve
  that never fills should not lock its buyers in. The end is fixed when the sale
  opens and nobody can move it. PBAND2's falls on 7 October 2026, after
  judging, so the lift has been proven by `tests/offering.ts` and not yet seen
  on devnet.
- The dollar check behind the ceiling recognises wrapped SOL, under both token
  programs, as not a dollar. Any other token that is not a dollar is not
  recognised, so an issuer could still band a sale priced in one.
- The freeze check covers the issuer's own key. A freeze authority held by
  another wallet the issuer controls cannot be told apart from a stablecoin
  issuer's.
- Pangu never checks that a token is actually backed by real shares. That is the
  issuer's claim, not something this program can see on chain.
- The upgrade key holder (the team, stated openly) can change the program while a
  sale is live, unless the key is later given up. That trade-off and its reasons
  are in `docs/security/threat-model.md`.
- A stock token such as AAPLx carries a permanent delegate that can move it out
  of any account, including the pool's vault, and a pause switch that can stop
  every trade. Those powers belong to the stock token's own issuer, and Pangu
  cannot defend against them. Any sale priced in a stock token discloses this.
- The cap limits what a wallet receives, not its live share of what remains.
  When other holders sell back, one wallet's share of tokens still held can rise
  above the cap's share of the original sale. The app reports share of tokens
  sold, not share of tokens held, and says so.
- Front-running between buyers who are all under the cap is not addressed here;
  DBC's own decaying fee is the tool for that, not Pangu.
- The price band first shipped on Switchboard On-Demand (forgery attempts
  refused on devnet, see `docs/security/attacks/forged-quote.md`), then was
  rebuilt on Pyth after Switchboard announced it shuts down on 25 September 2026.
  Those forgery attempts ran against the retired Switchboard build. The banded
  devnet runs from the fourth run on, in `docs/measurements/devnet-run.md`, are
  on the Pyth build.
- The Pyth price key the team holds is trial access, extended by Pyth support to 5
  October 2026, which covers judging but not a production issuer. A real issuer
  would need its own Pyth key.
- `PriceOutsideBand` (a buy refused for going above the ceiling) has landed live
  on devnet only on the team's own demo sales, PBAND in the fifth run and PBAND2
  in the sixth, whose holders the team seeded, not on a sale with outside
  trading volume. See `docs/measurements/devnet-run.md`, "The fifth run: the
  demo sale" and "The sixth run", and the fork test in
  `docs/measurements/sdk-fork-test.md`. Nothing has run on mainnet.
- The demo credential used for the attestation approval mode is self-issued.
  No real KYC or verifier company has published a credential address for Pangu
  to point at, so the demo issues its own and says so plainly in the app and
  here.
- Mainnet deploy has not happened. Every "mainnet: not deployed for this submission, one script and about 4 SOL away" cell in section 1 is
  honest about that; the program is proven end to end on devnet only as of this
  writing.

## 6. Pages read for this rubric

`ARCHITECTURE.md`,
`docs/security/threat-model.md`, `docs/measurements/devnet-run.md`,
`docs/measurements/fork-test.md`, `docs/measurements/credential-mode.md`,
`docs/measurements/price-band.md`, `docs/measurements/price-band-pyth.md`,
`docs/measurements/random-sequences.md`, `docs/measurements/review-fixes.md`,
`docs/measurements/sdk-fork-test.md`, `docs/security/attacks/forged-quote.md`,
`docs/measurements/test-counts.md`, `docs/deployments.md`,
`packages/scripts/package.json`,
`.env.example`, `scripts/wsl/test.sh`, `scripts/wsl/fork-test.sh`.
