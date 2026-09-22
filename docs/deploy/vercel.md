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

**One more setting**: `next.config.ts` reads `packages/scripts/sales.json` at build time and points `outputFileTracingRoot` and the Turbopack `root` one level above the monorepo's package folders, because the app is not self-contained inside `packages/web`. In the Vercel project's General settings, turn on "Include files outside of the Root Directory in the Build Step" (the exact wording depends on Vercel's current UI), or the build will not find `packages/scripts/sales.json` or `packages/sdk`.

## Node.js version

Not pinned in the repository: there is no `.nvmrc` and no `engines` field in `packages/web/package.json`. `packages/sdk/package.json` states `"engines": { "node": ">=20" }`, which is the floor. `packages/web`'s `@types/node` is pinned to `26.6.2`, which is only a signal of the Node major version the team develops against, not a runtime requirement Vercel enforces. Set Vercel's Node.js Version to the newest LTS it offers unless the team wants an exact match to their own machine, in which case the team fills in the exact version here.

## Environment variables

| Variable | Where it is read | Where the value comes from |
| --- | --- | --- |
| `NEXT_PUBLIC_DEVNET_RPC_URL` | `packages/web/lib/solana.ts`, every server and client read of devnet | A keyed devnet RPC endpoint (Helius, QuickNode, Triton, or similar). Left unset, the app falls back to the public `https://api.devnet.solana.com`, which `docs/measurements/web-scaffold.md` measured rate-limiting a page load out to 8 seconds under concurrent reads. The team fills in the actual endpoint and key. |
| `PYTH_API_KEY` | Read by `pangu-sdk/price`'s `refreshPriceTransaction`, server side only, never by browser code | The team's own Pyth Terminal / Hermes developer account, the same key already used by `packages/scripts`'s `.env`. Trial access covers every feed through 5 October 2026 (`docs/site/price-band.md`). As of this submission `packages/web`'s own price route (`app/api/price/[mint]/route.ts`) only reads a price, it does not yet refresh one, so this key is not exercised by the deployed app today; set it now so the refresh route works the moment it ships, since it is a server-only variable and must never be marked `NEXT_PUBLIC_`. |
| `DEMO_DOLLAR_MINT_AUTHORITY` | `packages/web/lib/demo-dollars.ts`, behind `POST /api/break/dollars`, server side only, never by browser code | The JSON array from the devnet payer key file, on one line, the same file `DEVNET_PAYER_KEYPAIR` points at locally. It is the mint authority of the demo dollar the live sale is priced in, so the Try to break it button can hand a judge's wallet enough of it to run every row. Each grant costs that key about 0.002 SOL of rent for a new token account plus the fee, so keep it in devnet SOL. Left unset, the route answers 503 and the button says demo dollars are not switched on for this deploy. Never mark it `NEXT_PUBLIC_`. |
| `NEXT_DIST_DIR` | `next.config.ts` | Optional. Only used locally to point a verification build at a second `.next` directory so it does not collide with a running dev server. Leave unset on Vercel; it defaults to `.next`. |
| `APP_URL` | Not read anywhere inside `packages/web` (checked with a repository-wide search for `process.env` under that package) | This is a variable in the root `.env` on the team's own machine, read by `packages/scripts/src/status.ts`. It is not a Vercel project setting. Once the Vercel deploy has a URL, the team sets `APP_URL` to it in that local `.env`, and the daily `npm run status` task then also checks the live site answers within five seconds and shows the word Pangu on the page. |

The two secrets in this list are `PYTH_API_KEY` and `DEMO_DOLLAR_MINT_AUTHORITY`. The second is the only key `packages/web` reads, it is read inside a server route and nowhere else, and it is a devnet demo key holding nothing of value.
