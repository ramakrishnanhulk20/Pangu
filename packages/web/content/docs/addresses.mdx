---
title: Contracts and addresses
description: Where Pangu lives on chain, every sale on devnet, what it depends on, and how to check the demo is still live.
---

## The Pangu program, on Solana devnet

| Fact | Value |
| --- | --- |
| Program address | `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG` |
| Running since | 23 September 2026, 14:08:42 UTC, slot 502981972, the sixth deploy |
| Explorer | https://explorer.solana.com/address/4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG?cluster=devnet |
| Upgrade authority | `Fwi8ejZ8kqF8PwcxssHFqJQZmVrkmBfoaXV5CTjqp5L`, the project's own devnet wallet, held by the team and stated openly |
| sha256 of the deployed build | `e40ab680c3ff8a806e51b66b014765674b95ccbd6ead553729689ab20c4cb59f`, 363,800 bytes |
| Program data account | `58UAoZWuoMpnV4HzydaVUai9U7DFzapFtN5KtAzkzDpY` |

The program was deployed once and upgraded five times on devnet, always at this same address, each build checked byte for byte against the code that was tested before it went live.

| Deploy | Slot | When (UTC) | What went on chain |
| --- | --- | --- | --- |
| 1 | 502338042 | 22 September 2026, 08:30:39 | The first deploy |
| 2 | 502373496 | 22 September 2026, 10:08:31 | The program and SDK review fixes |
| 3 | 502436678 | 22 September 2026, 13:02:53 | The price ceiling moved to Pyth |
| 4 | 502476730 | 22 September 2026, 14:53:26 | The rules layout version, so a reader refuses rules written by another layout |
| 5 | 502899538 | 23 September 2026, 10:21:01 | Rules v2, an upgrade in place: the paying token is stored and checked, a banded sale must be priced in dollars, the cap stays below what the curve sells, every sale carries an offering period, and every event names its sale's mint. Signature `4GQ2J5s1QmypeiDfeRwCGpZN13TpmMTQoXNnWnQq3jtxFW88cudEr5fjyxA9c8qbBitT5JuC7AHRgtSCGaUpokZ4` |
| 6 | 502981972 | 23 September 2026, 14:08:42 | A price ceiling only when buyers pay in a dollar the program lists for its network: devnet USDC and the demo dollar on this build, USDC alone on the mainnet build. Signature `4ep1rYGmZJXns7Efu22HmR1fHfKZQrnhznoMj3vjA7ZYxQi27yqkPPvix6fqv72ZHyrSVmFNiU6Kf4a4btauEPZ6` |

The full history, including what each upgrade cost, is in `docs/deployments.md` in the repository.

## What Pangu depends on

| Program | Address | What it is |
| --- | --- | --- |
| Meteora Dynamic Bonding Curve | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | Finds the price and creates the sale token. Same address on mainnet and devnet. |
| Solana Attestation Service | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | Optional. The credential-based approval mode reads a buyer's attestation from here. Same address on mainnet and devnet. |
| Pyth price feed program | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` | Derives the account address a banded sale reads the real stock price from. |
| Pyth receiver program | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | The only program allowed to write a price feed account, and only after checking the signatures behind it. |

## Every sale on devnet now

`/sales` in the app reads this list off the program itself, so it is always current. The front page leads with the banded demo sale that can take a buy right now: PBAND2 while Pyth is publishing Apple's exchange price, and PAAPLX, banded on AAPLx which trades all week, when it is not.

The demo sales, opened from the command line:

| Sale | Mint | Who may buy | Paid in | Ceiling follows | Offering ends | Headline transactions |
| --- | --- | --- | --- | --- | --- | --- |
| PBAND2, Pangu Priced Share, second offering | `5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo` | anyone, 10 percent cap | the demo dollar | Apple's exchange price (`Equity.US.AAPL/USD`), 5 percent over | 7 October 2026, 10:38 UTC | opened https://explorer.solana.com/tx/5Biy9QvCFgYNEPWFNzEA31aYF5c7vLFBu48jmSUkXa2ocb2akDLjmF6ARQQaZkTY21ZgARMVERpYWqLAocES1KYD?cluster=devnet; a buy refused at the ceiling with `PriceOutsideBand` https://explorer.solana.com/tx/4LXby4FwaytfNkRtj6TwyMWsm92iZFbyTEG6mvf8iwMxMdbwgKFaczDWMuexBgiqmK58UDFJ6iusQQt51vaEAYRc?cluster=devnet |
| PAAPLX, Pangu Priced Share, round the clock | `8FaBUEjMfkpYAzZLmLKwYHxd15BNC1ZBFkgTgN2WCQvK` | anyone, 10 percent cap | the demo dollar | AAPLx, the tokenized Apple that trades all week (`Crypto.AAPLX/USD`), 5 percent over | 7 October 2026, 13:05 UTC | opened https://explorer.solana.com/tx/4HN35oFemvfijyrNMwiS6vSeNU4BEvTd56NBGdScK9wzCTQ1vcgHJ4Gpj9Ze9eTXRbMjUEHJkYgPuy8yCbpVkSjZ?cluster=devnet; a buy refused at the ceiling with `PriceOutsideBand` https://explorer.solana.com/tx/5TbBnGrVHCkEj2GkdpRR7cR5p5TMUFrwubhqub5GVYQrTK3QsSTmhoLGYTZ1fEQ5diUm4C6M6acVAu6aUNTUGm8v?cluster=devnet |
| PVRFD, Pangu Verified Share | `7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn` | wallets the demo verifier attested, 10 percent cap | SOL | no ceiling | no end, holds until graduation | opened https://explorer.solana.com/tx/3NGu6WxguinVc8VyQSqA79kL3jkCXWhC5kAoaK2kdesSyP8ZHgcCwM8BhZgvLfVoAuZ9okAUbuwB8hwL7PEyVw5D?cluster=devnet; a buy with no attestation refused with `CredentialInvalid` https://explorer.solana.com/tx/2dvaB2gcFvwmdmQbYHV2wuuGKtQfTdPUk6yZNWXTMyrFHE9XVkeWZM2N7tGiwysNDx8jHUTrGxMkBFWDK3G3iPGi?cluster=devnet |
| PBAND, Pangu Priced Share | `2dp5caL9PPVWafYkmNHBdHEX6zWfG42BmERcnLK75N4Y` | anyone, 10 percent cap | the demo dollar | Apple's exchange price, 5 percent over | none: opened under version 1 rules, which the current build reads as never ending | a buy refused at the ceiling with `PriceOutsideBand` https://explorer.solana.com/tx/3FMhcSoCkFCp3PBMBjaejwEiXVmdDAREJCDaP2bYw2u2hGxanesdx5vi2cEU2ZMK1obRZhcUgWFKQ1tqMUy8sXDU?cluster=devnet |
| PLIST, Pangu Listed Share | `2ARD1KwvxyjLPwe46rivjxPRyMzvxSEPGvwKTqcNXpFR` | the issuer's approved list, 10 percent cap | SOL | no ceiling | graduated into DAMM v2 pool `2cEAoE9zi53y736DsaPBzgfdrUqJnVgqwutZTGsmsSLc` | migration https://explorer.solana.com/tx/5CpV8KReoYeRqXzeLDvfxuGM2yp99Mex6bTKRjutccd9HcmzZ2b1X36fVsPeuVHb7sQA3PuCkLRE8RJHbogiEPVT?cluster=devnet |

Against PBAND2, 9 attacks were run in the sixth run, 8 refused and 1 allowed as expected, the cap and the ceiling both refused on the same sale. Against PAAPLX, in the seventh run, the same 9 with the same result, against a price that publishes all week. Against PVRFD, 10 attacks, 8 refused and 2 allowed as expected: the first time credential mode was attacked on the live program.

The sales opened from the launch page, each by a throwaway issuer wallet in a recorded run (`packages/web/lab-evidence/launch-devnet.txt`, `metadata-devnet.txt` and `metadata-test-wallet.txt` in the repository):

| Sale | Mint | Who may buy | Paid in | Ceiling follows | Offering ends |
| --- | --- | --- | --- | --- | --- |
| PLAUNCH, Pangu Launch Page Share | `4HFYeRrCmPER6T1LcKWaThF4MNejzzRfLFsRdv5GDt1d` | anyone, 10 percent cap | the demo dollar | AAPLx, 5 percent over | 7 October 2026, 14:12 UTC |
| PLAUNCH, with a logo | `DKDhn1ZypcNtb1h4Y9kKmrzh9LthZcx5NCoeRPTREiPh` | anyone, 10 percent cap | the demo dollar | AAPLx, 5 percent over | 7 October 2026, 15:29 UTC |
| PLAUNCHL, Pangu Launch Page List | `CbqVFjNMJndSfVy36DR9uPZBSTfNvVf5LSbNeqX9qpG1` | the issuer's approved list, 10 percent cap | SOL | no ceiling | no end |
| PLAUNCHL, second run | `GTVaKD5rS59enGmAGLe3JPNFLx6s5xKB6tcnAufdnYMx` | the issuer's approved list, 10 percent cap | SOL | no ceiling | no end |
| PLOGO, Pangu Logo Proof Share | `DHg1rV6WUNYahX31jvXioTMSDrkd2eKJtK7JBppBoucK` | anyone, 10 percent cap | SOL | no ceiling | 30 September 2026, 7 days after launch |
| PLOGO, earlier run | `34d5bc9FeuE6wQK867W2zv9kiuoFzAvfLGAo8pZeBtN4` | anyone, 10 percent cap | SOL | no ceiling | 30 September 2026, 7 days after launch |

History, kept for the record. POPEN (`CBckMjBpHHQtcqxbTu5dUd3nQjyV8oVA4nfBZiTwYXo7`, opened at 400 dollars a share so every buy was refused at the ceiling) and a second list sale (`4kzCbpEZxyzwXno1ZVnTJ9BAGSjD1HVgSBSwikEsxeaE`) were retired on 23 September 2026; `/sales` hides them behind a switch. Four sales from the first three runs, among them the list sale `FToBcoyaCZtLpbaGFV8wdomngjwuQp5XShj6fHdzLyGv` that graduated into DAMM v2 pool `DLK2xF5i18rgXui9RN6urpAYg3bJxKNtkxiMYS5KECv`, were retired after the layout-version build, because its reader refuses rules another layout wrote. The eighth run opened no sale at all: its banded pool and rules, on a token that is not a listed dollar, were refused with `BandNeedsDollarQuote` in one transaction, https://explorer.solana.com/tx/M9GmvWbFTHCPBJnPbX1k2hmHUzqdBgAQnf7LevymftEjcjTbfM6wy3YXrUieCg2NWsfNdoP9qXESgQP4C9wcYCG?cluster=devnet, leaving only the token and its launch template behind.

Full transaction-by-transaction detail, including every attack and its signature, is in `docs/measurements/devnet-run.md` and `docs/measurements/sdk-pyth.md` in the repository.

## Run the proof yourself

All Rust and TypeScript tests, no network needed:

```bash
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/test.sh
```

Prints `rust: test result: ok. 31 passed` and a mocha summary of 137 tests passing, then exits 0. The counts for every suite are in `docs/measurements/test-counts.md`.

The devnet prove command, against the live program:

```bash
cd packages/scripts && npm run prove
```

Prints a table of attacks, an exit code, and the largest holder's share against the cap. The sixth devnet run, against the banded dollar sale (PBAND2), ended:

```
proof    : the largest wallet holds 16.93 percent of the 6229218448 raw units sold, against a cap worth 17.66 percent of them
cost     : 0.011317 SOL, after 0.033344 SOL came back from the attacking wallets

9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
```

On the credential sale, `npm run prove -- --mint 7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn`, the same run ended `10 attacks run, 8 refused as expected, 2 allowed as expected, 1 not applicable, 0 off the standard`. On the round-the-clock sale, `npm run prove -- --mint 8FaBUEjMfkpYAzZLmLKwYHxd15BNC1ZBFkgTgN2WCQvK`, the seventh run ended `9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard`.

The four doors of the app have their own recorded runs on devnet, each a script that drives the real page with a throwaway wallet and checks every line against the chain: `launch-devnet.txt`, `metadata-devnet.txt`, `sale-devnet.txt`, `verify-devnet.txt` and `portfolio-devnet.txt` in `packages/web/lab-evidence`. The signatures from each are at the foot of the Launch a sale, Buy and sell, Verify buyers and Your portfolio pages.

## The status command

`npm run status`, run daily through judging, checks that the deployed program still hashes to what `docs/deployments.md` records, that every demo sale's rules account is still on chain, that each running banded sale has a Pyth price account and shows how old the price in it is, that the Pyth key still answers, and that both project wallets can still pay. It prints one row per check and exits non-zero if anything says FAIL. A WARN is for something worth a look that does not stop the demo, most often a stock price that has aged out because the US market is closed, which the row states plainly when that is the reason.

## Mainnet

Not deployed. Ready: the mainnet build is made reproducibly and its hash recorded in `docs/deployments.md`, the deploy is one guarded command a person runs with their own key, and every step was rehearsed on a forked copy of mainnet on 23 September 2026. The program keypair fixes the address, so on mainnet it will sit at the same `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG`. What changes on mainnet, the costs and the upgrade key plan are on the mainnet page; the runbook is `docs/deploy/mainnet.md` in the repository.
