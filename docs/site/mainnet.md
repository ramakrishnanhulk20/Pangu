---
title: Mainnet
description: Where Pangu stands on mainnet, what changes for buyers and issuers there, what the deploy costs, and who holds the upgrade key.
---

## Where it stands

Pangu is not on mainnet yet. It is ready for it. The mainnet build is made reproducibly and its hash recorded; the deploy is one guarded command that a person runs with their own key; and every step of it was rehearsed on 23 September 2026 against a forked copy of mainnet holding Meteora's real Dynamic Bonding Curve and DAMM v2 programs, USDC, AAPLx with its Meteora badge, and Squads v4.

The whole procedure, in order, is the runbook in the repository: [`docs/deploy/mainnet.md`](https://github.com/ramakrishnanhulk20/Pangu/blob/main/docs/deploy/mainnet.md). The hash of the verified mainnet build is recorded there and in `docs/deployments.md`, and the deploy script refuses a binary whose hash differs from the one it is given.

## One program, two builds

The devnet and mainnet programs are built from the same source and differ in one list: the dollar tokens a price ceiling may be paid in. The mainnet build lists USDC and nothing else. The devnet build lists devnet USDC and the demo dollar. A ceiling compares the curve's price with a stock price in dollars, so a sale that carries one must be paid in a dollar the program recognises, and anything else is refused with `BandNeedsDollarQuote`. A sale with no ceiling can be paid in any token, including a tokenized stock.

## What changes for a buyer and an issuer

One setting turns the web app into the mainnet product. Everything else follows from it:

| | Devnet today | Mainnet |
| --- | --- | --- |
| Paying tokens at launch | the demo dollar, devnet SOL | USDC, and the tokenized stocks AAPLx, TSLAx, NVDAx and SPYx, each offered only while its Meteora token badge reads back from the chain |
| Price ceiling | on the demo dollar | on USDC only |
| Demo dollars and the faucet | yes | none; the demo dollars route answers 404 |
| The "Try to break it" ledger | simulate, or send for real | simulate only: a refusal sent on purpose would cost real money, and the page says so |
| Who pays for price refreshes | the demo key | a mainnet key kept for that one job, about 0.000035 SOL a refresh and at most one a minute |
| Where a logo is kept | Irys's devnet node, about 60 days | Arweave through Irys, for good |

The server checks the network it is talking to, by the hash of the chain's first block, before its first read. On the wrong network it refuses every read rather than show one network's numbers under the other's name, and the browser holds a "wrong network" line at the foot of every page.

## A sale paid in a tokenized stock

Meteora only lets a tokenized stock pay into a curve once one of its operators has issued a token badge for it. AAPLx had one on mainnet when it was read on 23 September 2026. The launch page offers each of the four stocks only while its badge reads back from the chain, so a stock without one is never offered.

A tokenized stock such as AAPLx carries powers that belong to its own issuer, not to Pangu: a permanent delegate that can move it out of any account, the pool's included, and a pause switch that can stop every trade. Pangu cannot defend against them, and the app discloses them for any sale priced in a stock.

## What it costs

The deploy's cost is worked out in the runbook from mainnet's own rent figures. Almost all of it is rent that stays locked in the program's account for as long as the program exists, and the upload's temporary deposit comes back in the same transaction that puts the code in place. The deploy script refuses to start unless the deployer's wallet holds enough for the peak.

After the deploy, the running costs are small and paid by whoever acts:

| What | Paid by | Cost |
| --- | --- | --- |
| Opening a sale | the issuer | 10,000 lamports in fees for each of its two transactions, plus the rent the new accounts need; about 0.019 SOL in all, measured on devnet |
| A buy or a sell | the buyer | Solana's 5,000 lamport network fee, before any priority fee a busy network asks for |
| A price refresh | the refresher key | about 0.000035 SOL |
| A Squads v4 multisig for the upgrade key | the team | about 0.0025 SOL of rent |

## Who holds the upgrade key

The upgrade key can replace the program's code, including during a live sale. The plan has three steps:

1. At launch the team keeps the key, in the deployer's wallet, and says so openly in the README, these docs and the app.
2. Then it moves to a Squads v4 multisig, two of three members, each a key held by a different person or device, so no single key can change the code. This was rehearsed on the fork against Squads' real mainnet program: one approval could not carry an upgrade (`InvalidProposalStatus`), two did, and the old key alone was refused (`Incorrect authority provided`).
3. Once an independent audit is done and the program has run quietly for a stretch, the multisig freezes it for good. That cannot be undone: after it, a bug can only be fixed by a new program at a new address.

## Proven on devnet

The dollar list went on chain with the sixth devnet deploy, [`4ep1rYGm`](https://explorer.solana.com/tx/4ep1rYGmZJXns7Efu22HmR1fHfKZQrnhznoMj3vjA7ZYxQi27yqkPPvix6fqv72ZHyrSVmFNiU6Kf4a4btauEPZ6?cluster=devnet). A price ceiling on a fresh six-decimal token with no freeze authority, which looks exactly like a dollar and is not on the list, was then refused by the program with `BandNeedsDollarQuote`: [`M9GmvWbF`](https://explorer.solana.com/tx/M9GmvWbFTHCPBJnPbX1k2hmHUzqdBgAQnf7LevymftEjcjTbfM6wy3YXrUieCg2NWsfNdoP9qXESgQP4C9wcYCG?cluster=devnet) (`docs/measurements/devnet-run.md`, the eighth run).

On the forked copy of mainnet, from `packages/web/lab-evidence/network-fork.txt`, the web app built for mainnet ran its launch, sale and portfolio pages: a USDC sale with a 5 percent ceiling on Apple launched from `/launch`, a buy under the cap landed, a further buy still under the cap was refused by the ceiling before signing, and the shares sold back; an AAPLx-paid sale with no ceiling launched and took a buy paid in AAPLx; the attack ledger offered simulate only; the demo dollars route answered 404; and `/portfolio` showed both issued sales. Those sales exist only on that fork (mints `9m1Sur8ZUFRb4vr1JFcHuohJvphty9JgKtjzAdRND6gX` and `8rogTETC8247CKrcWcipDKBTJTJf6DkaHNR6mZf8WoRA`), so they have no explorer page. The rehearsed deploy itself ended `HASH MATCH: YES` and `DEPLOY-MAINNET-OK`, and the multisig upgrade `SQUADS-UPGRADE-OK` (`docs/measurements/mainnet-rehearsal.md`).
