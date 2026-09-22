---
title: Contracts and addresses
description: Everything Pangu depends on, where it lives on chain, and how to check the demo is still live.
---

## The Pangu program, on Solana devnet

| Fact | Value |
| --- | --- |
| Program address | `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG` |
| Running since | 22 September 2026, 13:02:53 UTC, slot 502436678 |
| Explorer | https://explorer.solana.com/address/4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG?cluster=devnet |
| Upgrade authority | `Fwi8ejZ8kqF8PwcxssHFqJQZmVrkmBfoaXV5CTjqp5L`, the project's own devnet wallet, held by the team and stated openly |
| sha256 of the deployed build | `08746faa7b4ac83ada7bfa0cd2fcf0b04aabc9c335ebfc310fd2a06d486d3a7c` |

The program has been deployed and upgraded three times on devnet, always at this same address, each one checked byte for byte against the code that was tested before it went live. The full history, including what each upgrade cost, is in `docs/deployments.md` in the repository.

## What Pangu depends on

| Program | Address | What it is |
| --- | --- | --- |
| Meteora Dynamic Bonding Curve | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | Finds the price and creates the sale token. Same address on mainnet and devnet. |
| Solana Attestation Service | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | Optional. The credential-based approval mode reads a buyer's attestation from here. Same address on mainnet and devnet. |
| Pyth price feed program | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` | Derives the account address a banded sale reads the real stock price from. |
| Pyth receiver program | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | The only program allowed to write a price feed account, and only after checking the signatures behind it. |

## The demo sales run so far

Three sales have run end to end on the current, Pyth-based build of the program.

- **A list-mode sale** (an issuer's own approved-buyer list, 10 percent cap): mint `FToBcoyaCZtLpbaGFV8wdomngjwuQp5XShj6fHdzLyGv`, template transaction `526NJoSp...` (https://explorer.solana.com/tx/526NJoSpZHxJWy95YEwet2b3gUyKDXSW5rBRGjs3nDTtBuNgB3h2tFwafLHXvSNDdvjsRQtn3s9uzGzvD2ZScmGq?cluster=devnet). Six real buyers seeded it, nine attacks were run against it (eight refused, one allowed, as expected), and it was filled and migrated to a Meteora DAMM v2 pool at `DLK2xF5i18rgXui9RN6urpAYg3bJxKNtkxiMYS5KECv`.
- **A banded sale priced in Apple's stock price**, open access, mint `E1PSmsUoxvwJas6e1UY8soQq3nhSTUsaP3oBS9eLws4f`, price account `9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb`. Nine attacks run, eight refused as expected. Later graduated to DAMM v2 pool `4NYMEmSNcUQ4n3r1Q1jT9W3Lupfxcvw5Z3W2f3oVy116`.
- **A banded sale priced in a dollar token, deliberately opened above Apple's real price** to prove the ceiling actually refuses a buy on chain, not only in a test: mint `4vyCQRLeowhSzaZqbPVpdNy7upxVtqaCZdono2z8JeoT`, opened at 400 dollars a share while Apple traded at 344.64. Every buy was refused with the program's own `PriceOutsideBand` error, including this one: https://explorer.solana.com/tx/2iJnchxoJLgyixCS56VcxB1Aac1pRfoLhXywyK2RYmQvQmx6wYM97cZRW5R2ss7AFjPjZ27oCC9VAJeC13aEKb3B?cluster=devnet

Full transaction-by-transaction detail, including every attack and its signature, is in `docs/measurements/devnet-run.md` and `docs/measurements/sdk-pyth.md` in the repository.

## Run the proof yourself

All Rust and TypeScript tests, no network needed:

```bash
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/test.sh
```

Prints `rust: test result: ok. 26 passed` and a mocha summary of 118 tests passing, then exits 0.

The devnet prove command, against the live program:

```bash
cd packages/scripts && npm run prove
```

Prints a table of attacks, an exit code, and the largest holder's share against the cap, for example:

```
proof    : the largest wallet holds 16.76 percent of the 467347859706336 raw units
           sold, against a cap worth 17.12 percent of them
9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
```

## The status command

`npm run status`, run daily through judging, checks that the deployed program still hashes to what `docs/deployments.md` records, that every demo sale's rules account is still on chain, that each running banded sale has a Pyth price account and shows how old the price in it is, that the Pyth key still answers, and that both project wallets can still pay. It prints one row per check and exits non-zero if anything says FAIL. A WARN is for something worth a look that does not stop the demo, most often a stock price that has aged out because the US market is closed, which the row states plainly when that is the reason.

## Mainnet

Not deployed for this submission. The team's decision, 22 September 2026: a mainnet deploy costs about 4 SOL, most of it recoverable rent, and it was not the right call to spend it for this submission. The devnet program above is where the whole sale life, every rule, and every attack are proven on a live network with real transactions. The mainnet deploy script is written and ready; running it needs one command and a funded mainnet wallet, and nothing about the program or the SDK changes.
