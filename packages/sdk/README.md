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

## List every sale

```ts
import { saleDirectory } from "pangu-sdk";

for (const entry of await saleDirectory(connection)) {
  console.log(entry.symbol, entry.name, entry.running, entry.graduated, entry.offeringOver);
}
```

No file of addresses needed: one scan finds every sale's rules, then the mints,
the pools and the chain's clock are read in calls of 100, so fifty sales cost
three calls. Names and symbols come from the metadata DBC writes on the mint;
they are whatever the issuer typed, so the mint is what identifies a sale.
`graduated` is null when the pool cannot be read as the one selling the mint. A
rules account from a layout this package does not read is left out rather than
thrown; pass `onSkipped` to hear about each one. `listSales` and
`saleTokenInfo` are the two halves on their own.

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

## Verify buyers

A sale in credential mode sells only to wallets a verifier has attested on the
Solana Attestation Service. These four are everything a verifier does; the app
runs them at `/verify`.

### Set up

```ts
const credential = credentialAddress(verifier, "Acme KYC");
const schema = schemaAddress(credential, "pangu-buyer");
tx.add(createCredentialInstruction({ payer: verifier, authority: verifier, name: "Acme KYC", signers: [verifier] }));
tx.add(createSchemaInstruction({ payer: verifier, authority: verifier, credential, name: "pangu-buyer", description: "checked buyers" }));
```

### Issue

```ts
tx.add(createAttestationInstruction({ payer: verifier, authorizedSigner: verifier, credential, schema, wallet: buyer, expiry }));
```

`expiry` is unix seconds, or zero for never. The buyer's wallet is the nonce,
which is the one address Pangu's hook looks at.

### Check

```ts
const standing = await credentialStatus(connection, credential, schema, buyer); // "valid" | "expired" | "absent"
const issued = await listAttestations(connection, credential, schema); // wallet, expiry, created, standing
```

### Revoke

```ts
tx.add(closeAttestationInstruction({ payer: verifier, authorizedSigner: verifier, credential, schema, wallet: buyer }));
```

Closing is the service's only revocation. The deposit returns to the payer and
the wallet's next buy is refused with `CredentialInvalid`.

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

### Buy and sell

```ts
const buy = await buyTransaction({ connection, buyer, mint, amountIn, minimumAmountOut });
const sell = await sellTransaction({ connection, seller, mint, amountIn, minimumQuoteOut });
```

The floor is the least the trade may return before the chain refuses it. Set
it from the quote the person was shown, less the slippage you told them, so the
floor is what they agreed to. Leave it out and the builder takes 1 percent under
a fresh quote of its own (`slippageBps` changes the 1 percent), which can sit
below what a page showed a few seconds earlier. With a floor set, the builder
reads the market again and throws `PanguInputError` ("the market moved") when
the trade already returns less, so no wallet is asked to sign a trade that
would fail.

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
