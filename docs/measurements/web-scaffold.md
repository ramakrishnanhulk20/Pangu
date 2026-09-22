# Web scaffold: what was measured

The app in `packages/web`, built with `NEXT_DIST_DIR=.next-verify npm run build`
and served with `next start` on port 3100, read in headless Chromium
(Playwright 1.63) against Solana devnet through the public endpoint. Date: 22
September 2026. Screenshots: `web-scaffold-1440.png`, `web-scaffold-390.png`,
both of `/` with four live sales on it.

## Server render of `/`

Eight requests in a row, whole response time including the two devnet reads:

```
0.277 0.094 0.103 0.097 0.091 0.089 0.103 0.098   seconds
```

The first is the process warming up. After that the page is answered in about
0.095 s. No 429 in any run.

## Cold browser load of `/`

A fresh browser context each time, so nothing is cached. Two numbers are
recorded because they mean different things: the row is in the HTML at
"laid out", and it finishes its fade and rise at "fully visible".

| Viewport | Laid out | Fully visible |
| --- | --- | --- |
| 1440 x 900 | 0.35 s, 0.35 s, 0.91 s, 2.96 s | 0.86 s, 0.86 s, 2.95 s, 3.40 s |
| 390 x 844 | 0.35 s, 0.34 s, 0.35 s | 0.87 s, 0.87 s, 0.86 s |

The usual load at both widths is 0.35 s to the data and 0.86 s to the finished
entrance, inside the two second bar. The two slow 1440 runs are the first
request after the server process started and one run where the public devnet
endpoint took about 2.6 s to answer. The app's own work in those runs was the
same 0.09 s: the variance is the free RPC, and a paid endpoint in
`NEXT_PUBLIC_DEVNET_RPC_URL` removes it.

## Why the reads are batched

The first build called the SDK's `getSale` and `isSaleRunning` per sale, two to
three `getAccountInfo` calls each. The public devnet endpoint answered 429 to
the tail of them and web3.js backed off, so a page load took **8.03 s** at 1440
and **8.56 s** at 390. `lib/board.ts` now fetches every rules account in one
`getMultipleAccountsInfo` and every mint in a second, so a page load is two RPC
calls whatever the number of sales. The decoding is still the SDK's
`decodeSale`, plus `unpackMint` and `getTransferHook` for the mint, which is
what `getSale` and `isSaleRunning` do internally. Only the fetching changed.

## Theme

The nav toggle at both widths sets `data-theme="dark"` with a body background
of `rgb(12, 12, 14)`, and back to `data-theme="light"` with
`rgb(251, 251, 250)`. Both labels are in the markup and CSS picks one, so there
is no hydration flash and no mounted flag.

## Motion, on `/lab`

- Framer Motion: the mount block settles at opacity 1 after its rise. Sale rows
  above the fold reach opacity 1; rows below it stay at opacity 0 with
  `translateY(24px)` until scrolled to, which is `whileInView` working.
- GSAP ScrollTrigger: the pinned section gets its `pin-spacer` and the second
  panel runs `translateY(727px)` to `translateY(278px)` to `translateY(0)` as
  the wheel scrolls through it, driven by Lenis feeding `ScrollTrigger.update`.
- With `prefers-reduced-motion: reduce`, Lenis never starts and the pin is not
  built, so the panels are two ordinary stacked blocks.

## Price route

`GET /api/price/4vyCQRLeowhSzaZqbPVpdNy7upxVtqaCZdono2z8JeoT` returned 200 with
a live Pyth reading: price 344.64376, ceiling 361.875948, band 500 bps,
confidence 3 bps, fully verified, usable. A sale with no band returns 409 with a
sentence. Reading a price uses no Pyth key, and
`grep -rl "PYTH_API_KEY\|DEVNET_PAYER" .next-verify/static` finds nothing.

## Note on the sale record

`lib/sales.ts` imports `packages/scripts/sales.json` at build time, so a sale
opened after a production build only appears after the next build. The dev
server picks it up on save.

Four of the six sales in that file earlier in the day had 427 byte rules
accounts against the 362 bytes the current program writes, so `getSale` and
`decodeSale` both returned nonsense for the two banded ones: 20443 bps band,
28,206,919 buyers, 146 decimals. Those two entries were removed from
`sales.json` while this scaffold was being built. The two remaining 427 byte
sales have no band and read the same either way. Nothing in `packages/web`
works around a stale layout: if a pre-redeploy mint goes back into that file,
the page will print whatever the bytes decode to.
