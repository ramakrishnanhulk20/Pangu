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
  dbcConfig,
  quoteMint,
  endsAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
});
```

`dbcConfig` is the launch template the pool was opened on and `quoteMint` is the
paying token it names. Both are needed on every sale: the program stores the
paying token and refuses one the issuer can freeze. `endsAt` is the end of the
offering period in unix seconds, after which every rule lifts; leave it out for
no end, and the rules hold until graduation. The cap must stay below the
curve's supply, since a cap covering the whole sale is no cap at all.

The builder refuses anything the program would refuse, before it builds. Pass a
`band` to add the price ceiling against the real stock price:

```ts
band: {
  bps: 1_000,
  priceFeedId: "49f6b65c...5688",
  maxPriceAgeSecs: 60,
  maxConfBps: 100,
}
```

The Pyth price account is derived for you from the feed id and the shard, which
defaults to Pangu's own, so there is no address to get wrong.

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
  sale: { capShareBps: 1_000, accessMode: 1, endsAt },
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
ceiling, price too uncertain, or price stale. A stale price is also what a shut
stock market looks like: Pyth stops publishing an equity outside its trading
sessions, so the account stops moving and ages out.

## Keep the price fresh

`pangu-sdk/price` is the third entry point, for a sale with a price band. It is
Node and server only, so call it from a server route.

```ts
import { refreshPriceTransaction } from "pangu-sdk/price";

const { transactions, priceAccount } = await refreshPriceTransaction({
  connection,
  payer: serverWallet.publicKey,
  sale,
});
```

It reads Pyth's Hermes service, which has needed an API key since 26 August
2026. The key is taken from `PYTH_API_KEY` in the server's environment and is
never a value the browser holds or the package prints. A refresh is two
transactions, not one: the guardian-signed update goes into a holding account
first and the price account is written from it second, and the pair does not fit
in one transaction. Sign and send them in the order given, then send the buy.

Reading the price back is `readPrice` in the core entry point. It decodes the
price account itself, so it is safe in a browser and needs no Pyth package.
