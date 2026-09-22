# pangu-sdk

The TypeScript client for Pangu, the rules program that sits on a stock token's
first sale on Meteora's Dynamic Bonding Curve. It finds a sale's accounts, reads
the sale and its buyers, builds Pangu's instructions, and turns a failed
transaction into a sentence a buyer can read. It never signs and never sends.

Safe to import on a server and in a browser: no top level work, no DOM.

## Install

```bash
npm install pangu-sdk @solana/web3.js
```

## Read a sale

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

## Open a sale

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

The builder refuses anything the program would refuse, before it builds. Pass a
`band` to add the price ceiling against the real stock price, and the quote
account address is derived for you.

## Run a sale on Meteora

`pangu-sdk/dbc` is the second entry point. It pulls in Meteora's Dynamic Bonding
Curve SDK, so a page that only reads a sale never downloads it. Every function
returns an unsigned transaction and its size in bytes.

```ts
import {
  launchTemplateTransaction,
  openSaleTransaction,
  buyTransaction,
  preflightBuy,
  claimFeesTransaction,
  graduateTransaction,
  saleProgress,
} from "pangu-sdk/dbc";

const { transaction, config } = await launchTemplateTransaction({
  connection,
  partner: wallet.publicKey,
  quoteMint,
  curve,
});

const sale = await openSaleTransaction({
  connection,
  creator: wallet.publicKey,
  config: config.publicKey,
  name: "Acme Shares",
  symbol: "ACME",
  uri,
  sale: { capShareBps: 1_000, accessMode: 1 },
});
```

The template forces the settings a Pangu sale depends on and throws if you try
to set them otherwise: Token-2022, Pangu as the hook, graduation to DAMM v2,
fees collected in the paying token only, and a token authority option that
leaves nobody able to mint more. The pool and the sale's rules land in one
transaction, so nobody else can set the rules for your mint.

`preflightBuy` reads the chain and tells a buyer what would happen before they
sign: no record, not approved, an approval that is missing, expired or signed by
a key the verifier has dropped, over the cap with the room left, price above the
ceiling, market closed, or price stale.

## Keep the price fresh

`pangu-sdk/price` is the third entry point, for a sale with a price band. It is
Node and server only, so call it from a server route.

```ts
import { refreshPriceTransaction } from "pangu-sdk/price";

const { transaction, quoteAccount } = await refreshPriceTransaction({
  connection,
  payer: serverWallet.publicKey,
  sale,
});
```

Reading the price back is `readPrice` in the core entry point. It decodes the
quote account itself, so it is safe in a browser and needs no Switchboard
package.
