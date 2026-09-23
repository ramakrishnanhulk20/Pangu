---
title: Launch a sale
description: Every field of the launch form in plain words, the preview, what your wallet is asked to sign and what it costs, finishing a launch that stopped halfway, and the logo.
---

`/launch` opens a sale from one form. You describe the offering, set the rules, watch the curve they make, then sign. The form checks every field as you type and lists what to change first, in the program's own words where the program is the one that would refuse it.

## 01 The offering

| Field | What it means |
| --- | --- |
| Token name | The name buyers see, up to 32 characters. |
| Symbol | 2 to 10 letters or digits, like AAPLS. |
| Shares in this sale | Every share this token will ever have. The curve sells part of them and the rest go into the trading pool when the sale graduates; the form says how many of each. |
| Buyers pay in | On devnet, the demo dollar or devnet SOL. On mainnet, USDC or a tokenized stock (AAPLx, TSLAx, NVDAx, SPYx), each offered only while its Meteora token badge reads back from the chain. A price ceiling needs a dollar. |
| Raise target | What the curve takes in before the sale graduates to a Meteora DAMM v2 trading pool, in the paying token. This is the graduation threshold. |
| Kept for the trading pool | The share of all shares set aside for trading after graduation, 10 to 45 percent. More kept back makes a flatter curve that opens closer to where it ends. Meteora's own curve builder refuses 50. |

Under these, the form works out the opening discount: how far under the graduation price the first share sells.

## 02 How it looks

What wallets, explorers and every Pangu screen show for this token.

| Field | What it means |
| --- | --- |
| Logo, optional | PNG, JPEG, WEBP or SVG, up to 1 MB. Square works best, since wallets draw it in a circle. A larger picture is shrunk to 512 pixels in your browser first. Without a logo, wallets show a blank icon. |
| Description, optional | One paragraph of up to 400 characters that a buyer reads in their wallet: what the token is and who stands behind it. |
| Website and X profile, optional | Stored with the description. |

Where it is kept: the logo and one small file holding the name, symbol, description, image and links go to Irys, a storage network paid from your own wallet. Your wallet tops up its Irys balance only by what it lacks, then signs each file. On devnet Irys keeps the files for about 60 days; on mainnet they are stored on Arweave for good. The token's mint carries the address of that file, written at launch. With no logo, description or link there is nothing to store, nothing is paid to Irys, and the mint's metadata link is left empty.

## 03 The rules

Each rule carries the name of the program's refusal beside it, so an issuer knows exactly what a buyer will hit.

| Rule | What it means |
| --- | --- |
| Most one wallet can hold (`OverCap`) | A percentage of what the curve sells, 1 to 49. Counted across every buy and every account the wallet opens. The program refuses a cap as large as the whole sale (`CapCoversWholeSale`). |
| Who may buy | Anyone; your approved list (`NotApproved`), where you add wallets after launch from the sale's page, one transaction each, and can take them off again; or credential holders (`CredentialInvalid`), where you paste a verifier's credential and schema addresses. See the verify page. |
| Price ceiling (`PriceOutsideBand`) | Off, or follow a stock: AAPLx, which trades all week, or Apple's exchange price, which only publishes in exchange hours. 1 to 20 percent over the stock, read from Pyth at the moment of each buy. Offered only when buyers pay in a dollar the program lists; on a sale paid in SOL or a tokenized stock the form says the program would refuse it (`BandNeedsDollarQuote`). |
| Offering period (`ends_at`) | Ends after 1 to 60 days, or no end. At the end every rule lifts, cap and access included, and the token moves freely. With no end, the rules last until the curve fills and the sale graduates. |

## The preview

Beside the form, the sale redraws as you type: the curve as it will open, the first share's price and how far under graduation it sits, where it graduates, the cap on one wallet drawn at its real width, and the day the offering ends. With a ceiling on, it places the ceiling on the curve against the live stock price, for example "At $356.05 today, buying stops once 66 percent of the curve has sold, until the stock moves up."

Under it, "What a buyer will meet" lists the rules in the sentences a buyer reads, such as "No wallet can end up holding more than 1.09 shares, 10 percent of what the curve sells, however many buys or accounts it spreads them over."

## Sign and launch

Your wallet is asked for, in order:

1. Storage, only when there is a logo, description or link: a top-up of your Irys balance, only by the shortfall, and one message signature per file.
2. The launch template, which is Meteora's curve with Pangu's settings fixed in it: a Token-2022 sale token with Pangu as its transfer hook, fees collected in the paying token, minting power revoked at launch, graduation into DAMM v2.
3. The pool and the sale's rules, in one transaction. Both are created together, so nobody else can set this sale's rules in the moment between them.

Each transaction is tried against the chain first, so a refusal shows before your wallet is asked. The page quotes about 0.0193 SOL in all, most of it rent: the deposit Solana holds to keep the new accounts open. Measured launches:

| Launch | What it set | Cost, read off devnet before and after |
| --- | --- | --- |
| PLAUNCH | demo dollar, open, 5 percent over AAPLx, 14 days, no logo | 0.019294 SOL |
| PLAUNCHL | devnet SOL, approved list, no ceiling, no end, turned down once in the wallet | 0.018943 SOL across both presses |
| PLOGO | devnet SOL, open, 7 days, logo, description, website and X | 0.019141 SOL, storage included; Irys quoted 0.000077 SOL |
| PLAUNCH, second run | the first PLAUNCH's terms plus a logo | 0.019512 SOL, 0.000077 of it to Irys |

## If a launch stops halfway

The template lands first. If the second transaction is turned down in the wallet or the network drops it, the page says exactly what is on chain ("The launch template is on chain. No pool and no sale yet."), keeps the template's address in the browser's session storage (an address, never a key), and the button offers to finish. Pressing Launch again reuses the template and sends only the second transaction. Change the shares, the raise or the share kept back and a new template is made instead; the old one stays on chain unused. A logo and description already stored are reused unpaid unless you changed them.

## After launch

The done state shows the sale token's address, what the launch cost, and the logo read back through the mint's own link. The sale is on `/sales` at once, because that page scans the program.

The sale's page is also the issuer's desk. Connect the issuing wallet there and its controls appear: approve wallets on a list sale (paste one per line; a line that is not a Solana address is named), claim the trading fees, and move the curve to DAMM v2 once it fills. The rules are listed under them: "Written once when the sale opened. Nobody can change them."

## Proven on devnet

From `packages/web/lab-evidence/metadata-devnet.txt` and `launch-devnet.txt`: the launch page driven on devnet by throwaway wallets, every term read back off the chain and found equal to the form.

- PLOGO, with a logo, a description, a website and an X profile. Payment to Irys [`2gH2dQu4`](https://explorer.solana.com/tx/2gH2dQu4NerNzDVB4DYqEKbvjyrxL8CFAqDwL2mcuW6GvVxDoadue6EZSiWr1pXiah4XN55fi3thV4NUra5bQfb8?cluster=devnet), template [`5gvhKyFW`](https://explorer.solana.com/tx/5gvhKyFWZ9QF79fEM5ZcAG2RpNsHACNAukYzzmSTZ88bxE42EZJFy1kZ9zau8LoFhVr1iHjUMudzCa56YT1NALtM?cluster=devnet), pool and rules [`uFCKqofp`](https://explorer.solana.com/tx/uFCKqofpci4x5AbHW41ZetSfFTsMRpeqykFtZg62DdZ3PeGnquriFQT9yYGndvSQLoQLaZ5aBD4Fi972tnTJpts?cluster=devnet), mint [`DHg1rV6W`](https://explorer.solana.com/address/DHg1rV6WUNYahX31jvXioTMSDrkd2eKJtK7JBppBoucK?cluster=devnet). The mint's link, https://devnet.irys.xyz/4sfyPvf3YF4S7Jg4iimx9diZ5DQLh222FZe7HuMwNETL, loads as JSON naming the token, and its image is byte for byte the PNG the form was given.
- PLAUNCH, paid in the demo dollar with a 5 percent ceiling over AAPLx and a 14 day offering: mint [`4HFYeRrC`](https://explorer.solana.com/address/4HFYeRrCmPER6T1LcKWaThF4MNejzzRfLFsRdv5GDt1d?cluster=devnet). Cap 1,099,999,999 raw units, 10 percent of the curve; offering ends 7 October 2026 at 14:12:52 UTC.
- PLAUNCHL, paid in devnet SOL, approved list, no end. The sale transaction was turned down in the wallet after the template landed; the second press reused template `8mf9GitBRW6vq5WM95tKcN16BJGHbSjyXpRH7SqdZR3m` and finished: mint [`CbqVFjNM`](https://explorer.solana.com/address/CbqVFjNMJndSfVy36DR9uPZBSTfNvVf5LSbNeqX9qpG1?cluster=devnet).
