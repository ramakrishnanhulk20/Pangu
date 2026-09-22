# pangu-scripts

The commands that run a Pangu sale on devnet. Every number they print comes back
off the chain after the transactions land. Nothing here touches mainnet: each
command checks the node's genesis hash first and refuses anything that is not
devnet.

## Before you run anything

Fill in `.env` at the repository root from `.env.example`:

- `DEVNET_PAYER_KEYPAIR`, the path to the keypair file that pays. The bytes
  never enter `.env` or the repository.
- `PYTH_API_KEY`, the Hermes key. Every read of a Pyth price update has needed
  one since 26 August 2026. It is read from the environment by the refresh,
  server side only, and is never printed.

Then install, which also builds the SDK the scripts import:

```bash
cd packages/sdk && npm install
cd ../scripts && npm install && npm run sdk:refresh
```

## The commands

```bash
npm run mint-dollars                               # a dollar token to price a sale in
npm run refresh-price                              # write a fresh stock price
npm run refresh-price -- --feed Crypto.AAPLX/USD   # a feed that trades all week
npm run launch -- --mode list --cap-share-bps 1000 # open a sale
npm run launch -- --mode open --band 500           # open one with a price band
npm run seed                                       # a few real buyers
npm run prove                                      # attack it, print every refusal
npm run graduate                                   # fill the curve and migrate
```

`prove` and `graduate` work on the last sale in `sales.json` unless you pass
`--mint`.

Run `mint-dollars` once before the first banded sale priced in dollars. Devnet
has no dollar token anybody can get in quantity, and a ceiling that is a dollar
price only means something when the paying token is one. It prints a mint
address; pass that address to `launch --quote`.

## What launch takes

| Flag | Default | What it does |
| --- | --- | --- |
| `--mode` | `list` | Who may buy: `open`, `list` for the issuer's list, `credential` for an attestation from a verifier. A credential sale also needs `--credential` and `--schema`. |
| `--cap-share-bps` | `1000` | The per wallet cap, in basis points of what the curve sells. 1000 is 10 percent. |
| `--band` | none | How far over the stock price the curve may go, in basis points. 500 is 5 percent. Leave it out and the sale has no band. |
| `--feed` | `Equity.US.AAPL/USD` | The Pyth feed the band reads. The `Equity.US.*` feeds only publish in US market hours, so those sales shut overnight. The `Crypto.*X` ones publish all week. |
| `--quote` | `wsol` | The token buyers pay in: `wsol`, or the address of a mint with 6 to 9 decimals. Use the mint from `mint-dollars` for a dollar priced sale. |
| `--threshold` | `0.1` | How much of the paying token the curve takes in before the sale graduates, in whole units of it. |
| `--base-decimals` | `6` | Decimals of the sale token. Ask for 9 when a share is priced in dollars: more raw units per share is what lets the curve carry a three figure opening price. |
| `--migration-percent` | `20` | The share of the supply carried to DAMM v2 at graduation, 10 to 40. The more kept back, the closer the opening price sits to the graduation price. |

A dollar priced sale with a band is the full set:

```bash
npm run launch -- --mode open --band 500 --quote <dollar mint> --threshold 360000000000 --base-decimals 9 --migration-percent 40
```

## Rebuilding the SDK

These scripts install `pangu-sdk` as a copied folder, not a symlink. A symlink
lets node resolve `@solana/web3.js` inside `packages/sdk` as well as here, and
two copies of `PublicKey` are not the same class, so every input check fails.
See `.npmrc`.

The cost of the copy is that npm leaves it alone when the SDK is rebuilt, since
the `file:../sdk` dependency has not changed. One command does both sides:

```bash
npm run sdk:refresh
```

It builds `packages/sdk`, throws the copy away, and installs again. When the
SDK's own dependency list has changed it reinstalls this package from scratch
instead, because npm will not re-resolve a file dependency's tree on its own.
Run it after any change to `packages/sdk/src`, and the scripts see it with no
folder to delete by hand.
