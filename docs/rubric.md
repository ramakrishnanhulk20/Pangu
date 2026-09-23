# Rubric: Meteora's bounty, checked line by line

Pangu is a rules program that Meteora's Dynamic Bonding Curve (DBC) attaches to a
new stock token for the length of its first sale. DBC finds the price. Pangu
decides who may receive tokens and how many, then DBC removes Pangu from the
token for good when the sale fills. One line pitch: we help stock token issuers
run a fair first sale on Meteora DBC, where the curve finds the price and no bot
or whale can take more than their share.

## 1. Meteora's bounty, line by line

Source: the program page's "Meteora: $5,000, Best Use of Meteora DBC" section,
copied verbatim.

| Their words | What Pangu does | Where in the code | Test | Live transaction |
|---|---|---|---|---|
| "you control the curve shape, fee schedule, quote token" | Pangu does not change any DBC curve setting. It reads the pool's own launch template and only refuses one thing: fees paid out in the sale token instead of the paying token (see row below). Every curve, fee and quote choice stays the issuer's. | `packages/scripts/src/curve.ts` builds the DBC template; `programs/pangu/src/instructions/create_sale.rs` reads it back | `tests/create-sale.ts` | template tx [`526NJoSp`](https://explorer.solana.com/tx/526NJoSpZHxJWy95YEwet2b3gUyKDXSW5rBRGjs3nDTtBuNgB3h2tFwafLHXvSNDdvjsRQtn3s9uzGzvD2ZScmGq?cluster=devnet), devnet-run.md. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "graduation threshold, and how the pool migrates into Meteora DAMM v2 liquidity" | Pangu leaves graduation entirely to DBC. It only removes itself as a side effect: when the curve fills, DBC's own migration strips the transfer hook from the mint in the same trade. | `docs/measurements/fork-test.md` (migration step); no Pangu code runs here by design | `fork-tests/full-life.ts`, migration assertion | migration tx [`JRKFXfga`](https://explorer.solana.com/tx/JRKFXfgaZFbyfc2qM3BUYWp9Gj5ZnbLVYmkS3oWneaUy1KH7oXUuL3bcbdUr5A5khL296GagQNz4oPc74Ca37F4?cluster=devnet), DAMM v2 pool `DLK2xF5i18rgXui9RN6urpAYg3bJxKNtkxiMYS5KECv`. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "We want to see what it looks like for tokenized stocks" | The sale rules are stock-sale specific: a per-wallet cap so no single buyer takes the float, an optional approved-buyer gate, and an optional price ceiling measured against the stock's real market price, not just a curve number. | `programs/pangu/src/instructions/execute.rs` (the hook decision) | `tests/execute.ts`, `tests/band.ts` | list-mode sale mint [`FToBcoyaCZtLpbaGFV8wdomngjwuQp5XShj6fHdzLyGv`](https://explorer.solana.com/address/FToBcoyaCZtLpbaGFV8wdomngjwuQp5XShj6fHdzLyGv?cluster=devnet). mainnet: not deployed for this submission, one script and about 4 SOL away |
| "Build something on DBC that outlasts the current meme-stock meta" | Meteora's own push this quarter (DAMM v2 0.2.4, DBC stock tokens as the paying token, StockLaunch on 15 Sep) is toward stock-paired launches generally, not one memecoin. Pangu is indifferent to which token pays: the same rules program covers a dollar-priced sale and a stock-paired one, and a launchpad like StockLaunch is a second kind of customer for it, not only an issuer. | fork test buys with real AAPLx | `docs/measurements/fork-test.md`, "launched and bought with real AAPLx as the paying token" | fork test only, not yet run live on devnet or mainnet. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "launch mechanics tuned for equity-like assets (price discovery for thinly traded or newly tokenized stock pairs)" | The price band is the equity-specific mechanic: a buy is refused if it would push the curve price more than `band_bps` above the live stock price, so early illiquidity cannot be used to print a runaway price against latecomers. Sells are never blocked by the band. | `programs/pangu/src/instructions/execute.rs` band check; `programs/pangu/src/price.rs` | `tests/band.ts`, threat model C9 | demo sale mint [`2dp5caL9PPVWafYkmNHBdHEX6zWfG42BmERcnLK75N4Y`](https://explorer.solana.com/address/2dp5caL9PPVWafYkmNHBdHEX6zWfG42BmERcnLK75N4Y?cluster=devnet), open and priced in a demo dollar: a buy past the ceiling refused live on devnet with `PriceOutsideBand`, [`3FMhcSoC`](https://explorer.solana.com/tx/3FMhcSoCkFCp3PBMBjaejwEiXVmdDAREJCDaP2bYw2u2hGxanesdx5vi2cEU2ZMK1obRZhcUgWFKQ1tqMUy8sXDU?cluster=devnet), `docs/measurements/devnet-run.md`, "The fifth run: the demo sale". The same refusal is also proven in the fork test, `docs/measurements/sdk-fork-test.md`. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "novel curve or fee configurations" | Partly. Pangu invents no curve shape; it fixes the configuration a stock sale needs and refuses anything else: fees collected only in the paying token so no fee movement ever passes through the rules, minting power revoked at launch so the supply buyers see is final, a Token-2022 base with Pangu as its hook, graduation into DAMM v2. The novelty Pangu claims is in the graduation rules, not the curve. | `packages/sdk/src/dbc/template.ts` `FORCED` and `withoutMintAuthority`; `create_sale.rs` `handle_create_sale` (fee mode and mint authority proven on chain) | `packages/sdk/test/dbc.test.ts` forced-setting tests; `tests/create_sale.ts` FeesNotInQuoteToken and MintAuthorityStillSet cases | devnet: every sale in `docs/measurements/devnet-run.md` was opened through this template; mainnet: not deployed for this submission, one script and about 4 SOL away |
| "creative graduation rules" | Pangu's "creative" part sits before graduation, not at it: the per-wallet cap, the two approval modes (issuer list or a Solana Attestation Service credential), and the price band are the graduation-time state Pangu leaves behind for DBC to migrate cleanly, since a fair pre-graduation sale means a fair set of DAMM v2 holders on day one. | `ARCHITECTURE.md`, "The rules program, in plain words" | `fork-tests/full-life.ts` | migration tx above. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "tooling that helps issuers configure and monitor DBC pools" | The TypeScript package and the five scripts (launch, seed, prove, graduate, refresh-price) are that tooling: one command creates a template, pool and rules together, one command runs and prints every attack against a live sale. | `packages/sdk`, `packages/scripts/src` | 117 SDK tests, 49 script tests | devnet-run.md, every command in section 5 below. mainnet: not deployed for this submission, one script and about 4 SOL away |
| "Working code on mainnet beats slides" | Devnet is fully proven (program deployed, upgraded, and run end to end with real transactions across five recorded runs). The mainnet deploy script is written and waits only on a funded mainnet wallet and a go from the team. | `scripts/wsl/deploy.sh` | `program-info.sh` hash check | devnet program `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG`, docs/deployments.md. mainnet: not deployed for this submission, one script and about 4 SOL away, this is the one bounty line not yet true |
| Judging: "originality of the DBC configuration or use case" | The hook-pool rules layer plus the equity price band is not something the fork test or the mainnet pool listing shows elsewhere. | none | none, a research finding not a test | none |
| Judging: "technical soundness" | 27 Rust tests, 125 mocha tests, 36 fork tests (full sale life against real cloned DBC, DAMM v2 and attestation programs), 117 SDK tests, 49 script tests, 10 randomized attack sequences of 6,000 operations, a live devnet run with every refusal landed as a real transaction, a full code review with findings fixed. | see section 5 for exact commands | all of the above | test-counts.md, devnet-run.md, fork-test.md, random-sequences.md |
| Judging: "whether the idea has a life after the hackathon" | On the roadmap: a launchpad like StockLaunch is a second customer type, the upgrade key stays with the team so a bug found after judging can be fixed, and Dynamic Fee Sharing is scoped as a next step to give a verifier a reason to keep approving buyers. | none | none, a roadmap statement | none |

## 2. Threat model section C, invariant by invariant

Source: `docs/security/threat-model.md` section C. Devnet transactions are from
the second run in `docs/measurements/devnet-run.md` (the upgraded, reviewed
build), unless marked otherwise.

| # | Invariant, plain sentence | File and function | Test | Devnet transaction |
|---|---|---|---|---|
| C1 | Calling the hook directly, outside a real token transfer, changes nothing and fails. | `execute.rs`, the "genuinely mid-transfer" check at the top of the function | `tests/execute.ts` "direct call" case | [`3PUW1bT9`](https://explorer.solana.com/tx/3PUW1bT9iKM5pLSGpRqdKe9HkrcaFGkGdmEG4wLk7DvtbVKsD6Vqzz9WZrBkXU6tRbN7PS5HNjc2EUdtJwdsJ7kg?cluster=devnet), NotTransferring |
| C2 | Every account the decision reads is proven to be the real one for its role, not a look-alike. | `execute.rs` account derivation checks | `tests/execute.ts` "fake account" cases | [`4HnSQqse`](https://explorer.solana.com/tx/4HnSQqsevXgaPTaPwEeB8YC2C1L8Ax6zLotHoSxVgWig5Lf5AxhdWCrjAgU5TRYhSf5XVnU8ZL3BCf2AGNptRUYd?cluster=devnet), BuyerRecordMissing |
| C3 | A wallet's net tokens bought never exceeds the cap, however many token accounts it uses. | `execute.rs`, `net_bought + amount <= cap` check keyed on wallet owner, not token account | `tests/execute.ts` cap cases, the randomized sequences in `docs/measurements/random-sequences.md` | [`2PJuHfzp`](https://explorer.solana.com/tx/2PJuHfzpkM1rbeyUw8ZeYSm7TXKQFDPqjatw8j8WEPM4xxJoubYxJ7XpEdZGnnCEFzwB6HLfdheotRGJuqhU19Px?cluster=devnet), and a second-account attempt [`2zK4gSTC`](https://explorer.solana.com/tx/2zK4gSTC4xWLev4tMV27cLUn8ubrnhRS2HQ3k6Kpcf1aP4UjKp1duZ75KBnXNvQf1HDEbNv2eAmHswMxZWHJZU9M?cluster=devnet), both OverCap |
| C4 | During the sale a token can only move between a wallet and the pool vault, never wallet to wallet. | `execute.rs`, the wallet-to-wallet branch | `tests/execute.ts` "side transfer" case | [`4k9Aiot3`](https://explorer.solana.com/tx/4k9Aiot33BububatD31ku3DzVJgDTyXuHchACXbk2Ebfi7LXFRR7xfZcUhtEcJRu6kD2WrmYUTSkUy9euowYnLAP?cluster=devnet), WalletToWalletDuringSale |
| C5 | A holder can always sell back to the pool. No missing account or stale rule can block a sell. | `execute.rs`, the sell branch reads only the source owner's record if it exists | `tests/execute.ts` sell cases, the 1,330 simulated exit sells in `docs/measurements/random-sequences.md` | [`WiANjhTm`](https://explorer.solana.com/tx/WiANjhTmTM6H9K1N23axK8GX5oEnYnFhqkgzNBHSdkUo4Gr2arvhqBsz8vequdXxPjNGpPgd1eQ8XPTwToj6BXo?cluster=devnet), a revoked wallet's sell goes through |
| C6 | With the approved-buyer list on, tokens leave the pool only to a wallet approved at that moment. | `execute.rs` mode 1 branch, `approve_buyer.rs`, `revoke_buyer.rs` | `tests/execute.ts` "not approved" case | [`549vJCdN`](https://explorer.solana.com/tx/549vJCdNFguFHCEGEkNTPRBxSHrXLapbDZq5mFzhhkBf5e2WEZUABjoGwFBryFEgA6W72xhFbEcA4y7Bt8L1Kx75?cluster=devnet), NotApproved |
| C7 | The sale rules and the extra-accounts list for a mint are created once, only by the pool's creator, in the same transaction as the pool. | `create_sale.rs`, `creator == signer` check, `init` constraint | `tests/create-sale.ts` "not the creator" and "twice" cases | pool and rules transaction [`23s4BVPA`](https://explorer.solana.com/tx/23s4BVPAH32bSTM9QphHZMucrikhj1ixyqGcE7hB3LJftVHGMbf5tVPydxrHQDVzicYYBJRowLoUAYsSfE32eUJ9?cluster=devnet) |
| C8 | Rules that affect buyers cannot change invisibly; the cap can never change after the first trade. | `create_sale.rs` (rules set once, no update instruction), `SaleCreated` event | `tests/create-sale.ts` "no update instruction exists" | none needed, absence of an instruction is proven by the IDL, not a transaction |
| C9 | A banded buy only succeeds with a fresh, positive, correctly-sourced price inside the band; a doubtful price refuses the buy and never the sell. | `execute.rs` band branch, `price.rs` | `tests/band.ts` | [`3FMhcSoC`](https://explorer.solana.com/tx/3FMhcSoCkFCp3PBMBjaejwEiXVmdDAREJCDaP2bYw2u2hGxanesdx5vi2cEU2ZMK1obRZhcUgWFKQ1tqMUy8sXDU?cluster=devnet), PriceOutsideBand, a buy past the ceiling on the fifth run's demo sale, `docs/measurements/devnet-run.md`, "The fifth run: the demo sale"; also proven in the fork test, `docs/measurements/sdk-fork-test.md`. Earlier, [`7pNLsop6`](https://explorer.solana.com/tx/7pNLsop6fy65BiSncecGnF9nAcEuD6GaXmoATW7xGvqpc8UQpRFcVQbSRNY5oQyQ83K4WkgxT2nnJoCS6ZqkaNq?cluster=devnet), PriceStale (no live gateway that morning) |
| C10 | All counter math is checked; a sell larger than a wallet's recorded buys floors the record at zero, never underflows. | `execute.rs`, `saturating_sub` on the sell path | `tests/execute.ts` "sell more than bought" case, the randomized sequences in `docs/measurements/random-sequences.md` | none isolated on devnet, covered by the 1,330 simulated exit sells in those sequences |
| C11 | The launch template must pay fees in the paying token only, never the sale token. | `create_sale.rs`, `collect_fee_mode == QuoteToken` check (byte 232 of the template) | `tests/create-sale.ts` "OutputToken refused" case, Rust test against the real mainnet template bytes | none live (every devnet launch already uses QuoteToken by construction) |
| C12 | Scripts never hold or print a private key; every address that receives money is shown to the signer before signing and read back after. | `packages/scripts/src/wallets.ts`, `chain.ts` | `packages/scripts` test suite (49 tests) | devnet-run.md, no key ever printed in any of the five commands' output |
| C13 | Tokens leave the pool vault only into a token account whose owner can never change (an associated token account). | `execute.rs`, `ImmutableOwner` extension check on the destination | `tests/execute.ts` "owner can change" case | [`5mKWFBtb`](https://explorer.solana.com/tx/5mKWFBtbUQi6S1dk92c26AiuPDRtQYZy3kiRWKSAG1n4ySYrLD1wR67gxQLDqMu9eGcEy9ZLwQDwtYeZWixL26pq?cluster=devnet), ReceivingAccountOwnerCanChange |
| C14 | No sale token can come into existence except from the pool vault; `create_sale` refuses a mint whose minting power is still live. | `create_sale.rs`, mint authority check | `tests/create-sale.ts` "mint authority still set" case | first launch attempt against the upgraded program was refused with MintAuthorityStillSet (error 6021), see devnet-run.md "The new rule bit first" |

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
Prints `rust: test result: ok. 27 passed` and a mocha summary of 125 passing, then
exits 0.

Full sale life against real cloned Meteora and attestation programs, on a forked
validator:
```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/fork-test.sh
```
Prints 36 passing fork tests, including the AAPLx-paid launch and the DAMM v2
migration, and exits 0. Takes about 4 minutes; run detached and tail the log for
anything longer, per the script's own header comment.

The devnet prove command, against the live program:
```
cd packages/scripts && npm run prove
```
Prints a table of attacks, an exit code, and the largest holder's share against
the cap. The fifth devnet run, against the banded dollar sale (PBAND), ended:
```
9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
cost     : 0.011307 SOL, after 0.029169 SOL came back from the attacking wallets
```
and exited 0. Read off the chain right after it, the largest of the sale's 14
holders had 15.18 percent of everything sold, against a cap worth 15.83 percent
of it. `npm run launch`, `npm run seed`, and `npm run graduate` set up and
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
  on devnet only on the team's own demo sale, whose holders the team seeded, not
  on a sale with outside trading volume. See `docs/measurements/devnet-run.md`,
  "The fifth run: the demo sale", and the fork test in
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
`docs/deployments.md`, `packages/scripts/package.json`,
`.env.example`, `scripts/wsl/test.sh`, `scripts/wsl/fork-test.sh`.
