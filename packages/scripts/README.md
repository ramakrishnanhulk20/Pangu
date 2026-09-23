# pangu-scripts

The commands that run a Pangu sale on devnet. Every number they print comes back
off the chain after the transactions land. Nothing here touches mainnet: each
command checks the node's genesis hash first and refuses anything that is not
devnet.

## Before you run anything

Fill in `.env` at the repository root from `.env.example`:

- `DEVNET_PAYER_KEYPAIR`, the path to the keypair file that pays. The bytes
  never enter `.env` or the repository. The file must be the JSON array of 64
  numbers `solana-keygen` writes; anything else is refused with one fixed
  sentence that names the path and the shape and never quotes the file.
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
npm run launch -- --mode open --band 500 --quote <dollar mint>  # one with a price band
npm run seed                                       # a few real buyers
npm run prove                                      # attack it, print every refusal
npm run graduate                                   # fill the curve and migrate
npm run status                                     # is the whole devnet demo still up
npm run retire -- --mint <mint>                    # take a sale out of the demo
```

## Checking the demo is still alive

`npm run status` is the one command to run daily through judging. It reads and
signs nothing: it checks that the deployed program still hashes to what
`docs/deployments.md` records, that every sale in `sales.json` still has its
rules account on chain, that the pool, the cap and the access mode `sales.json`
records for each sale are the ones on chain, that each running banded sale has
a Pyth price account and how old the price in it is, that the Pyth key still
answers with a price young enough for the sales, and that both wallets can
still pay. It prints one row per check and exits non-zero if any of them says
FAIL. Set `APP_URL` in `.env` to the live site and it checks that too: a 200
inside five seconds with the word Pangu on the page.

A price older than a sale allows is a FAIL while its market is open, because
Pyth is publishing and a working refresher would have kept it fresh, so a stale
price then means the refresher has stopped. With the US market shut it is a
WARN that says so: there is nothing newer to write. The `Crypto.*X` feeds
publish all week, so on those a stale price is always a FAIL. The Pyth key row
follows the same rule for the age of the price Hermes hands back, judged
against the strictest running banded sale. A WARN is only ever for something a
person should see that does not stop the demo.

Retired sales are not checked; the table counts them in one row.

`seed`, `prove` and `graduate` work on the newest sale in `sales.json` unless
you pass `--mint`. Newest means the latest `openedAt` time, not the last entry
in the file, and a retired sale is never picked.

## Retiring a sale

```bash
npm run retire -- --mint <mint>
```

Marks the entry in `sales.json` with a `retiredAt` time. After that no command
picks it by default, `--mint` refuses it with the time it was retired, and
`status` stops checking it. The entry stays, as the record that the sale was
opened. Use it for a sale an earlier build of the program opened, which
`status` points out, or one the demo no longer needs. It reads and sends
nothing.

## How sales.json is written

`launch` writes a sale's entry the moment the sale's transaction lands, from
what the run already knows, and only then reads the rules back to fill in the
cap. A read that fails after that point cannot lose a sale that is live on
chain: the entry is there without a cap, and `status` warns about it. A second
entry for a mint already in the file is refused. Each write goes to a file
beside it first and is swapped in, so a run killed mid-write leaves the old
list.

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
| `--migration-percent` | `20` | The share of the supply carried to DAMM v2 at graduation, 10 to 45. The more kept back, the closer the opening price sits to the graduation price, and the further up the curve a price ceiling bites. Meteora's own builder refuses 50. |
| `--supply` | `1000000000` | How many shares the sale ever mints. A three figure opening price on a billion shares needs a raise in the hundreds of billions; twenty shares reach the same price on a few thousand. |

A dollar priced sale with a band is the full set:

```bash
npm run launch -- --mode open --band 500 --quote <dollar mint> \
  --supply 20 --threshold 3710 --base-decimals 9 --migration-percent 45
```

`--band` needs `--quote` with a dollar token. A band compares the curve's price
in the paying token with a stock price in dollars, so a band on a sale paid in
SOL would compare a SOL price with a dollar ceiling. `launch` refuses it before
it reads or sends anything, and the program's next build refuses it as well.

The opening price is not something a launch sets directly. Meteora works it out
from the raise, the supply and the share kept back: threshold times migration
share, over supply times the square of what is left to sell. Those four flags
are how a sale is aimed at a price, and `launch` prints the price it will open
at, the price it would end at, and how far up the curve the ceiling bites,
before it sends anything.

## What seed takes

| Flag | Default | What it does |
| --- | --- | --- |
| `--mint` | the last sale opened | Which sale to seed. |
| `--seed-to-share` | none | Buy until this percentage of the curve's shares have sold, in eight buys of different sizes. Left out, the run makes six buys of one size, which is what a sale priced in SOL wants. |

A banded sale is seeded with a target, because what the demo needs is a place on
the curve: sell enough of it and the price sits just under the ceiling, where
the next honest buy is the one that breaks it.

```bash
npm run seed -- --seed-to-share 58
```

Every amount of the paying token is scaled with the decimals read off the
paying token's own mint, never off the sale's rules, which only record them on
a banded sale and hold zero otherwise.

## What prove and graduate spend

`prove` sizes each cap attack in sale tokens: the wallet's room under the cap
plus one raw unit, the smallest buy that breaks it. When the curve has fewer
tokens left than that, or Meteora's quote says it cannot fill it, the row is
skipped and says why. A request the node fails is tried once more and then
stops the run, so a rate limit is never read as the curve being full. The
ceiling attack is sized the same way: the smallest buy whose landing price is
over the ceiling, found with the quote the SDK's preflight uses, checked with
that preflight, and sent at that size. When the curve cannot reach the ceiling
the row is skipped with the reason: the curve ends below it, or the sale is paid
in SOL.

`prove` has no credential rows yet. The scripts have no way to issue a devnet
attestation, so on a credential sale its access rows are wrong and the run
exits non-zero. Run it on open and list sales.

`graduate` hands each throwaway buyer what its buy spends in the sale's own
paying token, plus the devnet SOL the accounts and fees need. Whatever the run
does, including stopping partway, every throwaway wallet's SOL is swept back to
the paying key before the command exits.

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
