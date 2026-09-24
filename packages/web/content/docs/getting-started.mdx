---
title: Getting started
description: The pages to open first, then running a sale from the terminal as an issuer, what preflight tells a buyer, and installing the SDK as a developer.
---

## Start in the browser

The whole product runs in the browser, on Solana devnet, with no terminal. You need a devnet wallet (Phantom and Solflare are listed first on the connect button), set to devnet, and a little devnet SOL, which the faucet link on the page hands out. Sales priced in the demo dollar have a "Get demo dollars" button that hands your wallet enough to buy with, once an hour.

| Route | What you do there |
| --- | --- |
| `/` | Watch the live demo sale read off devnet, then scroll to "Try to break it": nine rows, one honest buy, seven attacks the program refuses by name with a link to each transaction, and one sell back that goes through. "Simulate" is the default, so your wallet is never asked to sign something meant to fail; "Send for real" lands every refusal on the explorer. |
| `/sales` | Every Pangu sale on the chain, found by scanning the program itself. |
| `/sale/` plus a sale token's address | One sale: its rules, its curve, a buy and a sell checked against the rules before you sign, and the issuer's controls when the issuer's wallet is connected. See Buy and sell. |
| `/launch` | Open your own sale from one form, logo included. See Launch a sale. |
| `/verify` | Set up as a verifier, issue and revoke credentials, or check any wallet. See Verify buyers. |
| `/portfolio` | Everything one wallet holds across every sale, and every sale it issued. See Your portfolio. |
| `/docs` | These pages. |

Everything below is the same work from a terminal, for an issuer running sales from scripts or a developer building on the SDK.

## For an issuer: open a sale from the terminal

Everything below runs from `packages/scripts` in the Pangu repository, against Solana devnet. Fill in `.env` first (see the addresses page for the two values it needs), then:

```bash
cd packages/sdk && npm install
cd ../scripts && npm install && npm run sdk:refresh
```

Then the commands that run a sale, in the order you would actually use them:

```bash
npm run mint-dollars                               # a fresh dollar-like token, for a sale with no ceiling
npm run refresh-price                              # write a fresh stock price
npm run refresh-price -- --feed Crypto.AAPLX/USD   # a feed that trades all week
npm run launch -- --mode list --cap-share-bps 1000 --ends-in 336   # open a sale for two weeks
npm run launch -- --mode open --band 500 --quote 2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5 --no-end  # a price band in the demo dollar, no end
npm run seed                                       # a few real buyers
npm run prove                                      # attack it, print every refusal
npm run graduate                                   # fill the curve and migrate
npm run status                                     # is the whole devnet demo still up
```

`launch` takes several flags to shape the sale: `--ends-in` or `--no-end`, one of which is required (`--ends-in 336` lifts every rule 336 hours after launch; `--no-end` keeps the rules until the curve graduates), `--mode` (`open`, `list`, or `credential`), `--cap-share-bps` (the per-wallet limit, in basis points of what the curve sells; 1000 is 10 percent), `--band` (how far over the real stock price the curve may go, in basis points; leave it out for no ceiling), `--feed` (which Pyth price the ceiling checks against), and `--quote` (what token buyers pay in: `wsol`, or a mint address). A sale with `--band` must be paid in a dollar the program lists: on devnet that is the demo dollar `2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5` or devnet USDC. A token from `mint-dollars` looks like a dollar but is not on the list, so the program refuses a ceiling on it with `BandNeedsDollarQuote`; it can still pay for a sale with no ceiling. The full flag table is in `packages/scripts/README.md`.

## For a buyer: what preflight tells you before you sign anything

Before a buyer signs a real transaction, Pangu's SDK can check what would happen and explain it in plain language. This is the same check the program itself would make, run ahead of time so nobody wastes a signature on a buy that was always going to fail. The possible answers, in plain words:

- **No record yet.** This wallet has not bought in this sale before; one gets opened automatically before the first buy.
- **Not approved.** The issuer has not approved this wallet to buy in this sale.
- **Approval missing, expired, or signed by a key that is no longer trusted.** The wallet's credential from a verifier is not usable right now.
- **Over the cap, with the room left shown.** This purchase would take the wallet past its limit for this sale.
- **Price above the ceiling.** This purchase would push the price too far above the real stock's price.
- **Price too uncertain.** The price feed's publishers disagree by more than this sale allows, so there is no ceiling worth measuring against right now.
- **Price stale.** The stock price this sale checks against is too old to use. This is also what it looks like when the real stock's market is closed: Pyth stops publishing outside trading hours, so the price account stops moving and ages out on its own.

## For a developer: install pangu-sdk

```bash
npm install pangu-sdk @solana/web3.js
```

The package page: [npmjs.com/package/pangu-sdk](https://www.npmjs.com/package/pangu-sdk).

Read a sale's current state:

```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { getSale, listBuyerRecords, saleStanding } from "pangu-sdk";

const connection = new Connection(process.env.RPC_URL!);
const mint = new PublicKey("...");

const sale = await getSale(connection, mint);
if (sale !== null) {
  const standing = saleStanding(sale, await listBuyerRecords(connection, mint));
  console.log(sale.cap, standing.buyers, standing.largestShare);
}
```

Build the instruction to open a sale, with an optional price ceiling:

```ts
import { createSaleInstruction, ACCESS_MODE } from "pangu-sdk";

const instruction = createSaleInstruction({
  issuer: wallet.publicKey,
  pool,
  mint,
  cap: 100_000_000n,
  accessMode: ACCESS_MODE.issuerList,
});
```

The core package never touches Meteora's own SDK, a wallet, or the browser's DOM, so it is safe to import into anything, including a page that only reads a sale. Running an actual sale against Meteora's Dynamic Bonding Curve, and keeping the price fresh, are two further entry points, `pangu-sdk/dbc` and `pangu-sdk/price`, covered in `packages/sdk/README.md`.
