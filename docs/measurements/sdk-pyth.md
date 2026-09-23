# pangu-sdk and the devnet scripts on Pyth

Date: 22 September 2026. Every number here came out of a command that ran.

The program's price band moved from Switchboard to Pyth first. This is the same
move on the package side: `pangu-sdk` and `packages/scripts` now speak Pyth,
and the word Switchboard is gone from both.

## What the band looks like to a caller now

Opening a banded sale takes four values instead of seven:

```ts
band: {
  bps: 500,
  priceFeedId: "49f6b65c...5688",   // Pyth's Equity.US.AAPL/USD
  maxPriceAgeSecs: 3_600,
  maxConfBps: 100,
}
```

The shard is optional and defaults to 7700, the one Pangu refreshes itself. The
price account is not asked for: `createSaleInstruction` derives it from the
shard and the feed id under Pyth's price feed program, which is the same
derivation `create_sale` runs before it will store it. The queue, the second
feed id, the slot-based age and the oracle quorum are gone, and so is
`MarketClosed`.

## The three pieces

| Piece | Where | What it does |
|---|---|---|
| `priceFeedAddress(feedId, shard)` | `src/addresses.ts` | The one account a shard and a feed can produce. Nothing else derives it. |
| `decodePriceUpdate` and `readPrice` | `src/feed.ts` | Reads a `PriceUpdateV2` off the chain and answers with the program's own refusal. No Pyth package, browser safe. |
| `refreshPriceTransaction` | `src/price.ts`, the `pangu-sdk/price` entry | Fetches a guardian-signed update from Hermes and builds the two transactions that write it. Server only. |

`readPrice` runs the hook's checks in the hook's order: the address the rules
carry is derived again from the shard and feed id in those same rules, the owner
must be Pyth's receiver program, the bytes must be a price update, two thirds of
the guardians must have signed it, the feed id inside it must be this sale's,
it must be no older than the sale allows against the chain's own clock, it must
not be published in the future, the price must be above zero, and Pyth's
confidence interval must be inside the sale's limit. Anything else comes back
`usable: false` with the error name the buy would really hit.

## The Hermes key never reaches a browser

Every Hermes read has needed an API key since 26 August 2026. The key is read
from `PYTH_API_KEY` in the server's environment by `refreshPriceTransaction`,
which lives behind the `pangu-sdk/price` entry point and nowhere else. If Hermes
answers with an error, the key is scrubbed out of the body before the message is
built, because an error text ends up in a log. The import-safety test asserts
that neither `@pythnetwork` nor `@meteora-ag` appears in the core bundle, so a
page that only reads a sale downloads neither the package nor a path to the key.

`.env.example` lists `PYTH_API_KEY` with a one-line note. No key is in the
repository.

## Test counts

| Suite | Command | Result |
|---|---|---|
| pangu-sdk unit tests | `npm test` in packages/sdk | 113 passing across 8 files |
| devnet script tests | `npm test` in packages/scripts | 24 passing across 3 files |
| SDK against real Meteora programs | `scripts/wsl/sdk-fork-test.sh` | `SDK-FORK-OK` |

The band tests in `packages/sdk/test/price.test.ts` read the real bytes Pyth's
receiver program wrote on devnet, saved at `packages/program/feeds/live-price.bin`,
through the same decoder the app uses.

## The fork run

A whole sale on a local validator holding Meteora's real mainnet Dynamic Bonding
Curve, driven only by the package. The banded part:

| Action | Bytes of 1232 | Compute units |
|---|---|---|
| Banded pool plus `create_sale` | 932 | 105,302 |
| First banded buy | 922 | 125,095 |
| Later banded buy | 912 | 104,556 |

What it proved: the preflight predicted `PriceOutsideBand` on round 4 and the
chain refused that exact buy with `PriceOutsideBand`; the curve never passed the
ceiling; and on a second sale whose price nobody refreshed, the preflight
predicted `PriceStale` after the account aged past that sale's own four minute
limit and the chain refused the buy with `PriceStale`. The sale next door, on a
different shard with an hour's limit, went on working.

What it does not prove: the Wormhole guardian signatures. Pyth's receiver
program is not on a local chain. That is proven on devnet below, where the real
program wrote the account.

## Devnet, end to end

The program was upgraded to the Pyth build first, because the Switchboard build
that was live refused the new `create_sale` argument outright
(`InstructionDidNotDeserialize`).

| Fact | Value |
|---|---|
| Build | `pangu.so`, 356,200 bytes, sha256 `08746faa7b4ac83ada7bfa0cd2fcf0b04aabc9c335ebfc310fd2a06d486d3a7c` |
| Upgrade slot | 502436678 |
| Upgrade signature | `4RdQw1FvbULYtnyjY2mxBoj8Q9XpGCwygnJuDz7qXVwLSLqbVd8tp8BvHoxDwJKd3qVsBegt76PB3MiWHtm5pq7L` |
| Cost | 0.001775 SOL, all fees. No new rent: the account was sized on the first deploy. |

### The refresh

```
npm run refresh-price
feed      : Equity.US.AAPL/USD (Apple)
account   : 9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb
signature : 2xiHPArYKpXTFR2cU81maow3KSB2VuN2BNqrXuEXdvfSTZLzdDuJaNUFMKARVPLKc34rmNu9kfYFiVJqNhyKQsu4
signature : vf232DYgcwfgETHg5998J6SJaNgaziZCZxBBRmC6Zz4JQXeP7JhT5uSbaYBFKigd2BBY1PSEao4ejacRtuhodvB
price     : 340.2997 dollars, confidence 2 basis points
published : 2026-09-22T12:52:30.000Z, 0 seconds ago
verified  : Full, two thirds of the Wormhole guardians
cost      : 35,180 lamports, 131,813 compute units, 1,606 bytes over two transactions
```

35,180 lamports is the number the move to Pyth measured after `closeUpdateAccounts` was
turned on, and the SDK sets it the same way, so a refresh leaves no rent behind.

### The banded sale

```
npm run launch -- --mode list --band 500
mint     : E1PSmsUoxvwJas6e1UY8soQq3nhSTUsaP3oBS9eLws4f
pool     : AGzisymETq3hPYrqkt4gw648xTeMhEmWECQLjafaTEjX
rules    : 3JRpgQwfGKdceR6ThqNqZFizeQsPa9kfoLpJNkyWtebw
price    : 9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb
sale     : 4WQZxg6H7cmMDP6rzGG2QzeWbH36dZQjbwnZUJuLSSMuV5icsMLD7csf74jJK4mWNJ7ihkWRtRxh4zFt5oiJQYyo
bytes    : 662 for the template, 947 for the pool and rules, against the 1232 byte limit
spent    : 0.019283 SOL
```

The launch refreshed the price itself before opening the sale, so the sale was
live and priced in the same run.

### The attacks

```
npm run prove
band     : 5 percent over Equity.US.AAPL/USD at 340.1564 dollars, from Pyth shard 7700
price    : usable, published 142 seconds ago of an allowed 3600, confidence 2 of an allowed 100 basis points
account  : 9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb, fully verified by the Wormhole guardians
...
9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
cost     : 0.015168 SOL, after 0.084990 SOL came back from the attacking wallets
```

The one not applicable is the ceiling itself: this sale is priced in SOL and the
ceiling is in dollars, so the curve cannot reach 357 dollars a token whatever it
does. The ceiling is proven on the fork, where the paying token is a dollar
token, and the price account, its owner and its freshness are proven here.

### Graduation, with the buy sizing fixed

`graduate.ts` compared lamports still to raise against a cap counted in sale
tokens, which is true for any curve worth filling, so every buy took the
finishing path and the first one was refused `OverCap`. The sizing now lives in
`nextBuy` in `packages/scripts/src/buying.ts`, where both sides of every
comparison are raw units of the paying token, and `packages/scripts/test/buying.test.ts`
holds the branch.

```
npm run graduate
curve    : 8201340 of 100000000 raw units raised, 8 percent
buy  1   : 78256532758681 raw units   (the cap is 79999967072171)
...
buy 10   : 41460344908576 raw units
filled   : 100000001 of 100000000 raw units, the curve is full
damm v2  : 4NYMEmSNcUQ4n3r1Q1jT9W3Lupfxcvw5Z3W2f3oVy116
migration: XvGgdBj7ibyKW1NXjjkcDAQt4nSSMvC859fYaaFPjBhGapUBcLYj3fbU4bLb9rTqXFKxfj5fU8H4mFFxb5smXUn
hook     : 11111111111111111111111111111111
rules    : gone, the token now moves freely
cost     : 0.149953 SOL, after 0.105580 SOL came back
```

Ten buyers, every one of them under the cap, no refusal anywhere in the run.

## Rebuilding the SDK for the scripts

`packages/scripts/.npmrc` sets `install-links=true` on purpose: a symlinked
`pangu-sdk` makes node resolve two copies of `@solana/web3.js`, and two
`PublicKey` classes fail every `instanceof` check. So the copy stays, and
`npm run sdk:refresh` does both halves of the job: it builds `packages/sdk`,
deletes the copy, and installs again. When the SDK's own dependency list has
changed it reinstalls the package from scratch instead, because npm will not
re-resolve a file dependency's tree on its own. That case was not theoretical
here: the first pass left `@switchboard-xyz` in the scripts' lockfile after the
SDK had stopped depending on it.

Proof it reaches the scripts: before the refresh, the installed copy exported
`canonicalQuoteAddress` and no `priceFeedAddress`. After one `npm run sdk:refresh`,
with no folder deleted by hand:

```
PANGU_SHARD_ID 7700
has priceFeedAddress function
has decodePriceUpdate function
has canonicalQuoteAddress undefined
```

and the built and installed bundles are the same bytes:

```
4c11a9d0330cf2aea8adbe38dd2a659c  packages/sdk/dist/index.js
4c11a9d0330cf2aea8adbe38dd2a659c  packages/scripts/node_modules/pangu-sdk/dist/index.js
```

## One limitation, named

`@pythnetwork/solana-utils` 0.6.0, which the receiver package pulls in, has an
ES module build that re-exports a Jito helper importing a CommonJS file without
its extension. Bare Node refuses that; every bundler resolves it. So
`pangu-sdk/price` loads under tsx, under Next.js and as CommonJS, which is how
anything actually calls it, but not with a plain `node --input-type=module`
import. The import-safety test says so where it checks the other two entries,
and the devnet runs above went through that entry under tsx.
