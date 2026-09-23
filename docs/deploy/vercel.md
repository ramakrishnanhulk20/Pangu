# Deploying packages/web to Vercel

Read `packages/web/package.json`, `packages/web/.npmrc`, `packages/web/next.config.ts` and `packages/web/scripts/refresh-sdk.mjs` before changing any of this. The short version: `pangu-sdk` is not published to npm, it is a local folder Vercel has to build before `packages/web`'s own install can use it.

## Root directory

`packages/web`.

## Why the install command needs an override

`packages/web/package.json` depends on `"pangu-sdk": "file:../sdk"`. `packages/web/.npmrc` sets `install-links=true`, which makes npm copy that folder into `node_modules/pangu-sdk` instead of symlinking it (a symlink would let Node resolve two separate copies of `@solana/web3.js`, and two `PublicKey` classes fail every `instanceof` check the SDK and the app both rely on).

The copy is only as good as what is in `packages/sdk` at the moment `npm install` runs. `packages/sdk/dist` is built by `npm run build` in that package and it is listed in `.gitignore`, so it is not committed. A bare `npm install` inside `packages/web`, which is what Vercel's auto-detected Next.js preset runs, would copy `packages/sdk` without its `dist` folder, and the app's imports of `pangu-sdk` would fail to resolve.

**Install command**, overriding Vercel's default:

```
npm install --prefix ../sdk && npm run sdk:refresh
```

What this does, in order: installs `packages/sdk`'s own dependencies (`tsup`, `typescript`, and the rest), then runs `sdk:refresh`, the script already in `packages/web/package.json`. That script builds `packages/sdk` (`npm run build`, which runs `tsup`), then installs `packages/web` itself: on a clean checkout there is no existing `pangu-sdk` copy to compare dependency lists against, so it does a full `npm install` in `packages/web`, which is exactly what a first deploy needs. This is the same two-step pattern `packages/scripts/README.md` and `docs/site/getting-started.md` already document for a local machine, run in one command because Vercel only exposes a single install phase.

**Build command**: Vercel's default `next build` (or `npm run build`, which is the same script) is correct as it stands. No override needed there.

**A sale opened after a deploy needs a redeploy.** `packages/web/lib/sales.ts` imports `packages/scripts/sales.json`, so the list of sales is bundled into the build. The numbers on screen are read live, but which sales exist is fixed at build time: after the scripts open a new sale and append it to `sales.json`, commit that file and redeploy, or the site will not know the sale is there.

**One more setting**: `next.config.ts` reads `packages/scripts/sales.json` at build time and points `outputFileTracingRoot` and the Turbopack `root` one level above the monorepo's package folders, because the app is not self-contained inside `packages/web`. In the Vercel project's General settings, turn on "Include files outside of the Root Directory in the Build Step" (the exact wording depends on Vercel's current UI), or the build will not find `packages/scripts/sales.json` or `packages/sdk`.

## Node.js version

Not pinned in the repository: there is no `.nvmrc` and no `engines` field in `packages/web/package.json`. `packages/sdk/package.json` states `"engines": { "node": ">=20" }`, which is the floor. `packages/web`'s `@types/node` is pinned to `26.6.2`, which is only a signal of the Node major version the team develops against, not a runtime requirement Vercel enforces. Set Vercel's Node.js Version to the newest LTS it offers unless the team wants an exact match to their own machine, in which case the team fills in the exact version here.

## Devnet or mainnet

One setting picks the network: `NEXT_PUBLIC_PANGU_NETWORK`, `devnet` (or unset) for the demo, `mainnet` for the product. Every per-network fact lives in `packages/web/lib/network.ts`: the endpoints, the paying tokens a launch offers, the explorer links, the words on every page, the Irys node, and whether demo dollars, the faucet and sending from the attack ledger exist. It is compiled in, so changing it needs a redeploy. Any value other than `devnet` or `mainnet` stops the build, so a typo such as `mainnet-beta` never quietly ships the devnet app.

| | devnet | mainnet |
| --- | --- | --- |
| Endpoints read | `DEVNET_RPC_URL`, `NEXT_PUBLIC_DEVNET_RPC_URL` | `MAINNET_RPC_URL`, `NEXT_PUBLIC_MAINNET_RPC_URL` |
| Paying tokens at launch | the demo dollar, SOL | USDC, and the xStocks AAPLx, TSLAx, NVDAx and SPYx, each shown only while its Meteora token badge reads back from the chain |
| Price ceiling | on the demo dollar | on USDC only, the one dollar the mainnet program lists |
| Demo dollars, faucet | yes | none; `POST /api/break/dollars` answers 404 and the demo key is never read |
| Attack ledger | simulate, or send for real | simulate only, with one line saying why |
| Price refresh paid by | `DEMO_DOLLAR_MINT_AUTHORITY` | `PRICE_REFRESH_KEY` |
| Irys | devnet node, files kept about 60 days | mainnet node, files kept on Arweave for good |

The server checks its endpoint's genesis hash, the hash of the chain's first block, once per process before its first read. On the wrong network every read is refused rather than showing one network's numbers under the other's name, and the browser runs the same check on its own endpoint and holds a "wrong network" line at the foot of every page. An endpoint on the same machine (`localhost` or `127.0.0.1`) is let through as a rehearsal: that is how the mainnet build is run against the forked-mainnet validator in `scripts/wsl/mainnet-rehearsal.sh`, and every page then says "rehearsal".

## Environment variables

| Variable | Where it is read | Where the value comes from |
| --- | --- | --- |
| `NEXT_PUBLIC_PANGU_NETWORK` | `packages/web/lib/network.ts`, at build time | `devnet` or `mainnet`, see above. Unset means devnet. |
| `MAINNET_RPC_URL` | `packages/web/lib/solana.ts`, `chainConnection`, when the network is mainnet. Server only | A keyed mainnet RPC endpoint, full key included. The same role `DEVNET_RPC_URL` has on devnet. Never mark it `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_MAINNET_RPC_URL` | `packages/web/lib/network.ts`, `browserRpcUrl`, when the network is mainnet | The browser's mainnet endpoint: the public one when unset, or a key the provider restricts to this deploy's origin. Compiled into the bundle, so never the unrestricted server key. |
| `PRICE_REFRESH_KEY` | `packages/web/lib/price-refresh.ts`, behind `POST /api/price/refresh`, when the network is mainnet. Server only | A mainnet key made for this one job, as the JSON array a Solana key file holds, on one line. It pays for the Pyth price posts that keep a banded sale's ceiling fresh: about 0.000035 SOL a post, at most one a minute across the app, so about 0.05 SOL a day at the very worst and far less in practice, since a post only goes out when a banded sale is being viewed and its stored price is over ten minutes old. **Budget: fund it with 0.5 SOL.** Under 0.05 SOL it stops posting, the page says the price is waiting for a refresh, buys on banded sales wait while sells go on, and the server log prints the key's public address to top up. A value equal to `DEMO_DOLLAR_MINT_AUTHORITY` is refused. Unset, refreshes are off. Never mark it `NEXT_PUBLIC_`. |
| `DEVNET_RPC_URL` | `packages/web/lib/solana.ts`, `chainConnection`, the server reads behind the hero, the readout and the price route, when the network is devnet. Server only, never compiled into the browser bundle | A keyed devnet RPC endpoint (Helius, QuickNode, Triton, or similar), full key included, since it never leaves the server. Left unset, server reads fall back to `NEXT_PUBLIC_DEVNET_RPC_URL`, then to the public `https://api.devnet.solana.com`, which `docs/measurements/web-scaffold.md` measured rate-limiting a page load out to 8 seconds under concurrent reads. Never mark it `NEXT_PUBLIC_`. The team fills in the actual endpoint and key. |
| `NEXT_PUBLIC_DEVNET_RPC_URL` | `packages/web/lib/network.ts`, `browserRpcUrl`, when the network is devnet: the wallet connection in the browser, the attack ledger's own reads in `packages/web/lib/break.ts`, and for now the demo dollar grant in `packages/web/lib/demo-dollars.ts` | Compiled into the browser bundle, so anyone can read it. Either leave it unset for the public endpoint, or use a second key that the provider's dashboard restricts to this deploy's origin, so a copied key is useless anywhere else. Never the unrestricted server key. The attack ledger sizes each row through this endpoint, which takes 20 to 70 seconds a row on the public node and a few seconds on a keyed one, so an origin-restricted key here is worth setting before judging. |
| `PYTH_API_KEY` | Read by `pangu-sdk/price`'s `refreshPriceTransaction`, server side only, never by browser code | The team's own Pyth Terminal / Hermes developer account, the same key already used by `packages/scripts`'s `.env`. Trial access covers every feed through 5 October 2026 (`docs/site/price-band.md`). The app uses it in `POST /api/price/refresh` (`packages/web/lib/price-refresh.ts`): when a banded sale's stored price is more than ten minutes old, the attack screen asks the server to post Pyth's latest price, at most once a minute, paid by the demo key on devnet and by `PRICE_REFRESH_KEY` on mainnet. Without it every buy on a banded sale is refused once the stored price is an hour old. Server only, never marked `NEXT_PUBLIC_`. |
| `DEMO_DOLLAR_MINT_AUTHORITY` | `packages/web/lib/demo-dollars.ts`, behind `POST /api/break/dollars`, server side only, never by browser code, and on devnet only: leave it out of a mainnet deploy | The JSON array from the devnet payer key file, on one line, the same file `DEVNET_PAYER_KEYPAIR` points at locally. It is the mint authority of the demo dollar the live sale is priced in, so the Try to break it button can hand a judge's wallet enough of it to run every row. Each grant costs that key about 0.002 SOL of rent for a new token account plus the fee, so keep it in devnet SOL. Left unset, the route answers 503 and the button says demo dollars are not switched on for this deploy. The same key now also pays for the price refreshes `POST /api/price/refresh` posts, about 0.000035 SOL each and at most one a minute. Never mark it `NEXT_PUBLIC_`. |
| `NEXT_DIST_DIR` | `next.config.ts` | Optional. Only used locally to point a verification build at a second `.next` directory so it does not collide with a running dev server. Leave unset on Vercel; it defaults to `.next`. |
| `APP_URL` | Not read anywhere inside `packages/web` (checked with a repository-wide search for `process.env` under that package) | This is a variable in the root `.env` on the team's own machine, read by `packages/scripts/src/status.ts`. It is not a Vercel project setting. Once the Vercel deploy has a URL, the team sets `APP_URL` to it in that local `.env`, and the daily `npm run status` task then also checks the live site answers within five seconds and shows the word Pangu on the page. |

Whatever `NEXT_PUBLIC_DEVNET_RPC_URL` holds must contain the word `devnet`, because the wallet adapter and Irys pick the network from that address, and without it the launch page's payment to Irys for a token's logo is treated as mainnet and fails.

The mainnet endpoint in `NEXT_PUBLIC_MAINNET_RPC_URL` must not contain the word `devnet`, for the same reason the other way round.

The secrets in this list are the keys inside `DEVNET_RPC_URL` and `MAINNET_RPC_URL`, `PYTH_API_KEY`, `DEMO_DOLLAR_MINT_AUTHORITY` and `PRICE_REFRESH_KEY`. All of them are read on the server and nowhere else. `DEMO_DOLLAR_MINT_AUTHORITY` is a devnet demo key holding nothing of value. `PRICE_REFRESH_KEY` holds real SOL on mainnet, so keep its balance to the budget above. `NEXT_PUBLIC_DEVNET_RPC_URL` and `NEXT_PUBLIC_MAINNET_RPC_URL` are not secrets by design: whatever they hold is public the moment the site is.
