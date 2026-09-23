---
title: Security
description: The threat model, the rules the code must always uphold, an attack that was actually tried, and what this does not protect against.
---

## The threat model, in plain words

Pangu is called by another program (Meteora's token program) on every single movement of the sale token, so the biggest risks are the same shape as any program that gets handed accounts by a caller it does not fully trust: a look-alike account standing in for the real one, someone calling the hook directly instead of through a real transfer, many wallets or many token accounts used to get around the cap, and a price account that is stale, missing, or faked. The other big risk is the mirror image of all of that: a rule that misfires on a sell and traps a holder's money. Pangu treats a blocked sell as the worst possible failure and is built so nothing can cause one.

Attackers in this model can create unlimited wallets for free, choose which accounts to pass into a transaction, and control the timing of everything except what Pangu itself checks. The privileged parties are the issuer (who decides who is approved) and the holder of Pangu's upgrade key (the team, stated openly), who could in theory change the program's code while a sale is live.

## The rules the code must always uphold

Each of the first fourteen rules on the program (C1 to C14) is proven by a named test, and most are also proven by a real, refused transaction on Solana devnet. The three rules on the app (C15 to C17) are proven by recorded devnet runs or, for C17, by inspection of the code. The four program rules added in the rules v2 build (C18 to C21) are proven by named tests and by the sixth devnet run, which opened both of its sales under them. None of their refusals has been sent on devnet, since the demo sales were set up to pass them.

| Rule | In plain words | Proven by |
| --- | --- | --- |
| C1 | Calling the hook directly, outside a real transfer, changes nothing. | devnet transaction, `NotTransferring` |
| C2 | Every account the decision depends on is checked to be the genuine one, never a look-alike. | devnet transaction, `BuyerRecordMissing` |
| C3 | A wallet's net tokens bought never exceeds its cap, no matter how many token accounts it uses. | devnet transactions, `OverCap`, plus 6,000 randomized attack sequences with no break found |
| C4 | Tokens can only move between a wallet and the pool, never wallet to wallet, while the sale runs. | devnet transaction, `WalletToWalletDuringSale` |
| C5 | A holder can always sell back to the pool. Nothing can block an exit. | devnet transaction, a revoked wallet still sells successfully; 1,330 simulated exit sells in the randomized tests |
| C6 | With the approved-list on, only a currently approved wallet can buy. | devnet transaction, `NotApproved` |
| C7 | A sale's rules can only be created once, by the pool's own creator, in the same transaction as the pool. | tests confirming a second attempt and an outside caller are both refused |
| C8 | Rules that affect buyers cannot change invisibly; the cap can never change after the first trade. | there is no instruction that could change it, proven by the absence of one in the program's interface |
| C9 | A banded buy only succeeds with a fresh, correctly sourced price inside the ceiling; any doubt refuses the buy, never the sell. | devnet transactions, `PriceStale` and `PriceOutsideBand` |
| C10 | All the counters are checked; a sell larger than a wallet's recorded buys floors at zero rather than going negative. | test plus the randomized sequences |
| C11 | The sale's launch settings must pay fees in the paying token only, never the sale token. | on-chain check added after a code review, tested against real Meteora template bytes |
| C12 | The scripts never hold or print a private key, and every address paid is shown before signing and read back after. | script test suite |
| C13 | Tokens can only leave the pool into a token account whose owner can never change. | devnet transaction, `ReceivingAccountOwnerCanChange` |
| C14 | No sale token can be created outside the pool; a sale refuses to open on a token whose minting power is still live. | devnet transaction, `MintAuthorityStillSet`, found and fixed in a code review before this submission |
| C15 | The devnet demo key is the only key server code holds, used by two routes. The demo dollars button mints only the demo dollar, at most once a wallet an hour and ten times a minute. The price refresh posts only Pyth price updates for the app's own banded sales, at most one a minute and only when the stored price is over ten minutes old. The key never leaves the server. | a race of 12 wallets on devnet: 10 let through the reservation, the other 2 refused; two price refresh calls in a row on devnet, one post then none |
| C16 | A transaction the app builds for a visitor moves value only between that visitor and the pool, or to an account the visitor owns, and every row states its cost before the wallet signs. | a devnet run of every row, each row's promise equal to the chain's answer |
| C17 | No public route lets an outsider spend the app's network budget: the price route answers only for the app's own sales, from a ten second cache, and the readout and price refresh answer only for sales on the chain's own list, which is read at most once every thirty seconds. | by inspection of the code |
| C18 | A sale with a price ceiling is priced in a dollar token, and every sale's paying token is checked and stored. | tests refusing a band on a sale priced in SOL; the demo sale PBAND2 opened banded and dollar-priced on devnet |
| C19 | The issuer cannot pick a paying token they are able to freeze, so they can never stop sellers being paid. | tests refusing a paying token the issuer can freeze; both sixth run sales opened past the check |
| C20 | The per-wallet cap sits below what the curve sells, so no wallet can buy the whole sale. | tests refusing a cap equal to the curve's supply; PBAND2's cap is a tenth of it, and held on devnet with `OverCap` |
| C21 | The offering period is fixed when the sale opens. While it runs every rule holds; when it ends every rule lifts. | five offering period tests; PBAND2 opened with an end of 7 October 2026 and every rule held on it afterwards |

## An attack that was actually tried

The price ceiling depends on a price account that anyone can refresh. Before trusting that account, four real attempts were made on Solana devnet to write a forged or stale price into it: signing with a key that was not a real price-oracle key, altering the price bytes after a real signature, redirecting a genuine price meant for a different stock onto this account, and replaying an old, genuine update after it had aged out. All four were refused by the oracle network's own program, none of them cost more than a transaction fee, and none of them changed the account. Two extra checks were then added to Pangu itself as a second line of defence, in case a future version of that oracle network's program were ever less careful. Full write-up: `docs/security/attacks/forged-quote.md` in the repository.

## What a code review found and fixed

A full code review was run on the program and the SDK before this submission. It found eight issues; all were fixed or, where the fix was a product decision, brought to the founder to decide. The most serious: an issuer who still held the power to mint more of the sale token could have minted straight into any wallet, past the cap and past any approval, since minting is not a transfer and the hook never sees it. The decision: revoke the minting power at launch, and a sale now refuses to open on any token that still has it (C14 above). The other seven were smaller: an on-chain gap in the fee check (C11) that used to only be enforced by the client software, a preflight check that did not account for an expired or de-authorized credential, buyer records that could not be closed and their rent recovered until a sale fully ended, and a few housekeeping fixes. Full detail: `docs/measurements/review-fixes.md` in the repository.

## What this does not protect against, stated plainly

- **One person, many wallets.** The cap is per wallet. Without a real identity check behind the approved-buyer list, a determined buyer can still split a purchase across wallets they control. The issuer-list mode has no identity check at all; the credential mode is only as good as whoever issues the credential.
- **The issuer's own approval power.** An issuer can approve their friends first. Every approval is public on chain, but Pangu does not judge who gets approved.
- **The stock token issuer's own powers.** A tokenised stock such as Apple's AAPLx carries a permanent delegate that can move the token out of any account, including the pool itself, and a pause switch that can stop every trade. Those powers belong to the stock token's own issuer, not to Pangu, and Pangu cannot defend against them. Any sale priced in a stock token discloses this.
- **The upgrade key.** Pangu's upgrade key is held by the team's wallet and stated openly. In theory it could be used to change the program's code during a live sale. This trade-off, and why it was chosen (so a bug found during judging can be fixed, and so the deposit stays recoverable), is recorded in the project's own planning documents.
- **This has not been independently audited by a third party.** It has been reviewed by an automated code-review pass and by the team building it, tested with 31 Rust tests, 137 litesvm tests, 37 steps against real cloned Meteora and attestation programs, 146 SDK tests, 109 script tests, and 6,000 randomized attack operations, and proven with real refused transactions on a live network. That is a strong bar for a hackathon submission, but it is not the same thing as a paid third-party security audit.
