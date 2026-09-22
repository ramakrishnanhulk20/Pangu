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
