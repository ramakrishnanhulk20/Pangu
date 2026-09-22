---
title: Getting started
description: Opening a sale as an issuer, what preflight tells a buyer, and installing the SDK as a developer.
---

## For an issuer: open a sale

Everything below runs from `packages/scripts` in the Pangu repository, against Solana devnet. Fill in `.env` first (see the addresses page for the two values it needs), then:

```bash
cd packages/sdk && npm install
cd ../scripts && npm install && npm run sdk:refresh
```

Then the commands that run a sale, in the order you would actually use them:

```bash
npm run mint-dollars                               # a dollar token to price a sale in
npm run refresh-price                              # write a fresh stock price
npm run refresh-price -- --feed Crypto.AAPLX/USD   # a feed that trades all week
npm run launch -- --mode list --cap-share-bps 1000 # open a sale
npm run launch -- --mode open --band 500           # open one with a price band
npm run seed                                       # a few real buyers
npm run prove                                      # attack it, print every refusal
npm run graduate                                   # fill the curve and migrate
npm run status                                     # is the whole devnet demo still up
```

`launch` takes several flags to shape the sale: `--mode` (`open`, `list`, or `credential`), `--cap-share-bps` (the per-wallet limit, in basis points of what the curve sells; 1000 is 10 percent), `--band` (how far over the real stock price the curve may go, in basis points; leave it out for no ceiling), `--feed` (which Pyth price the ceiling checks against), and `--quote` (what token buyers pay in: `wsol`, or a dollar mint from `mint-dollars`). The full flag table is in `packages/scripts/README.md`.

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
