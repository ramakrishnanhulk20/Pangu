---
title: Contracts and addresses
description: Everything Pangu depends on, where it lives on chain, and how to check the demo is still live.
---

## The Pangu program, on Solana devnet

| Fact | Value |
| --- | --- |
| Program address | `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG` |
| Running since | 23 September 2026, 10:21:01 UTC, slot 502899538 |
| Explorer | https://explorer.solana.com/address/4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG?cluster=devnet |
| Upgrade authority | `Fwi8ejZ8kqF8PwcxssHFqJQZmVrkmBfoaXV5CTjqp5L`, the project's own devnet wallet, held by the team and stated openly |
| sha256 of the deployed build | `191e9cf1ab6f9ababc1fb50c1f279b7f19e305934fff0952f8155b4f85a10731` |

The program was deployed once and upgraded four times on devnet, always at this same address, each build checked byte for byte against the code that was tested before it went live.

| Deploy | Slot | When (UTC) | What went on chain |
| --- | --- | --- | --- |
| 1 | 502338042 | 22 September 2026, 08:30:39 | The first deploy |
| 2 | 502373496 | 22 September 2026, 10:08:31 | The program and SDK review fixes |
| 3 | 502436678 | 22 September 2026, 13:02:53 | The price ceiling moved to Pyth |
| 4 | 502476730 | 22 September 2026, 14:53:26 | The rules layout version, so a reader refuses rules written by another layout |
| 5 | 502899538 | 23 September 2026, 10:21:01 | Rules v2, an upgrade in place: the paying token is stored and checked, a banded sale must be priced in dollars, the cap stays below what the curve sells, every sale carries an offering period, and every event names its sale's mint. Signature `4GQ2J5s1QmypeiDfeRwCGpZN13TpmMTQoXNnWnQq3jtxFW88cudEr5fjyxA9c8qbBitT5JuC7AHRgtSCGaUpokZ4` |

The full history, including what each upgrade cost, is in `docs/deployments.md` in the repository.

## What Pangu depends on

| Program | Address | What it is |
| --- | --- | --- |
| Meteora Dynamic Bonding Curve | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | Finds the price and creates the sale token. Same address on mainnet and devnet. |
| Solana Attestation Service | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | Optional. The credential-based approval mode reads a buyer's attestation from here. Same address on mainnet and devnet. |
| Pyth price feed program | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` | Derives the account address a banded sale reads the real stock price from. |
| Pyth receiver program | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | The only program allowed to write a price feed account, and only after checking the signatures behind it. |

## The demo sales on devnet now

The app opens on the newest open sale, PBAND2. The first two below were opened in the sixth run on the rules v2 build. The two after them were opened under version 1 rules, which the new build still reads: they have no offering period and read as never ending.

| Sale | Mint | Mode | Price ceiling | Offering ends | Headline transactions |
| --- | --- | --- | --- | --- | --- |
| PBAND2, the demo sale a judge sees first | `5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo` | Open access, 10 percent cap, priced in the demo dollar | 5 percent over Apple | 7 October 2026, 10:38 UTC | opened https://explorer.solana.com/tx/5Biy9QvCFgYNEPWFNzEA31aYF5c7vLFBu48jmSUkXa2ocb2akDLjmF6ARQQaZkTY21ZgARMVERpYWqLAocES1KYD?cluster=devnet; a buy refused at the ceiling with `PriceOutsideBand` https://explorer.solana.com/tx/4LXby4FwaytfNkRtj6TwyMWsm92iZFbyTEG6mvf8iwMxMdbwgKFaczDWMuexBgiqmK58UDFJ6iusQQt51vaEAYRc?cluster=devnet |
| PVRFD, the credential sale | `7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn` | Verifier credential, 10 percent cap, priced in SOL | none | no end, holds until graduation | opened https://explorer.solana.com/tx/3NGu6WxguinVc8VyQSqA79kL3jkCXWhC5kAoaK2kdesSyP8ZHgcCwM8BhZgvLfVoAuZ9okAUbuwB8hwL7PEyVw5D?cluster=devnet; a buy with no attestation refused with `CredentialInvalid` https://explorer.solana.com/tx/2dvaB2gcFvwmdmQbYHV2wuuGKtQfTdPUk6yZNWXTMyrFHE9XVkeWZM2N7tGiwysNDx8jHUTrGxMkBFWDK3G3iPGi?cluster=devnet |
| PBAND, the fifth run's demo sale | `2dp5caL9PPVWafYkmNHBdHEX6zWfG42BmERcnLK75N4Y` | Open access, 10 percent cap, priced in the demo dollar | 5 percent over Apple | none, version 1 rules | a buy refused at the ceiling with `PriceOutsideBand` https://explorer.solana.com/tx/3FMhcSoCkFCp3PBMBjaejwEiXVmdDAREJCDaP2bYw2u2hGxanesdx5vi2cEU2ZMK1obRZhcUgWFKQ1tqMUy8sXDU?cluster=devnet |
| PLIST, the fourth run's list sale | `2ARD1KwvxyjLPwe46rivjxPRyMzvxSEPGvwKTqcNXpFR` | Issuer's approved list, 10 percent cap, priced in SOL | none | graduated to DAMM v2 pool `2cEAoE9zi53y736DsaPBzgfdrUqJnVgqwutZTGsmsSLc` | migration https://explorer.solana.com/tx/5CpV8KReoYeRqXzeLDvfxuGM2yp99Mex6bTKRjutccd9HcmzZ2b1X36fVsPeuVHb7sQA3PuCkLRE8RJHbogiEPVT?cluster=devnet |

Against PBAND2, 9 attacks were run in the sixth run, 8 refused and 1 allowed as expected, the cap and the ceiling both refused on the same sale. Against PVRFD, 10 attacks, 8 refused and 2 allowed as expected: the first time credential mode was attacked on the live program.

History: POPEN (`CBckMjBpHHQtcqxbTu5dUd3nQjyV8oVA4nfBZiTwYXo7`, opened at 400 dollars a share so every buy was refused at the ceiling) and a second list sale (`4kzCbpEZxyzwXno1ZVnTJ9BAGSjD1HVgSBSwikEsxeaE`) were retired on 23 September 2026. Four sales from the first three runs, among them the list sale `FToBcoyaCZtLpbaGFV8wdomngjwuQp5XShj6fHdzLyGv` that graduated into DAMM v2 pool `DLK2xF5i18rgXui9RN6urpAYg3bJxKNtkxiMYS5KECv`, were retired after the layout-version build, because its reader refuses rules another layout wrote.

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

On the credential sale, `npm run prove -- --mint 7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn`, the same run ended `10 attacks run, 8 refused as expected, 2 allowed as expected, 1 not applicable, 0 off the standard`.

## The status command

`npm run status`, run daily through judging, checks that the deployed program still hashes to what `docs/deployments.md` records, that every demo sale's rules account is still on chain, that each running banded sale has a Pyth price account and shows how old the price in it is, that the Pyth key still answers, and that both project wallets can still pay. It prints one row per check and exits non-zero if anything says FAIL. A WARN is for something worth a look that does not stop the demo, most often a stock price that has aged out because the US market is closed, which the row states plainly when that is the reason.

## Mainnet

Not deployed for this submission. The team's decision, 22 September 2026: a mainnet deploy costs about 4 SOL, most of it recoverable rent, and it was not the right call to spend it for this submission. The devnet program above is where the whole sale life, every rule, and every attack are proven on a live network with real transactions. The mainnet deploy script is written and ready; running it needs one command and a funded mainnet wallet, and nothing about the program or the SDK changes.
