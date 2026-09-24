---
title: Overview
description: What Pangu does, who it is for, the four things you can do with it, and what is live on Solana devnet today.
---

Pangu runs the first sale of a new stock token on Meteora's Dynamic Bonding Curve, the tool Meteora uses to discover a fair price instead of picking one in advance. The curve decides the price. Pangu decides who is allowed to buy and how much of the sale any one wallet can take. When the sale finishes, Meteora removes Pangu from the token for good, and the token trades freely from then on.

We help stock token issuers run a fair first sale on Meteora's Dynamic Bonding Curve, where the curve finds the price and no bot or whale can take more than their share.

Pangu is for two kinds of teams. First, anyone issuing a new stock token who wants its first sale to go to real buyers rather than the fastest bot. Second, a stock-paired launchpad, the kind of app Meteora itself announced this quarter, that needs the same fairness rules for every token it lists.

## Four doors

The app is the whole product. Each of these pages reads the chain as it loads and sends only transactions your own wallet signs.

| Door | Page | What happens there |
| --- | --- | --- |
| Buy | `/sales`, then a sale's own page | Find any Pangu sale on the chain, ask the rules what they would say before you sign, buy on the curve, and sell back to the pool. |
| Launch | `/launch` | Open a sale from one form: the token, what buyers pay in, the raise, the cap on one wallet, who may buy, an optional price ceiling, the offering period and an optional logo. Two transactions. |
| Verify | `/verify` | Set up as a verifier, issue a credential to each wallet you have checked, check or revoke one. A sale in credential mode sells only to those wallets. |
| Portfolio | `/portfolio` | One wallet's place in every sale: what it holds, what that is worth, the room left under each cap, and the sales it issued. |

The front page shows the live demo sale and lets anyone attack its rules from their own wallet ("Try to break it"). These docs live at `/docs` in the same app.

To see all of it before you connect a wallet, watch [the five-minute demo](https://youtu.be/dZPinNOR7i0).

## The rules, in one breath

While a sale is open, every movement of the token passes through Pangu. A wallet cannot buy past its cap, however many accounts it spreads the buys over. If the sale requires it, a buyer must be on the issuer's list or hold a verifier's credential. If the sale has a price ceiling, no buy may push the curve too far above the real stock's price, read live from Pyth. Tokens cannot move wallet to wallet until the sale ends. Selling back to the pool is always allowed.

## Every sale names what it is paid in and when it ends

The paying token is checked and stored for every sale. The issuer cannot pick one they are able to freeze, since freezing it would stop sellers being paid. A price ceiling needs a dollar the program lists: USDC on mainnet, devnet USDC or the demo dollar on devnet. Without a ceiling a sale can be paid in SOL or in a tokenized stock such as AAPLx.

Every sale also names an offering period when it opens: 1 to 60 days from the launch page, or no end. The end is fixed at launch and nobody can move it. When it passes, every rule lifts even if the curve never filled, so a slow sale cannot hold its buyers forever. A sale with no end keeps its rules until it graduates.

## What is live

Pangu is live on Solana devnet. Program address `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG`, first deployed on 22 September 2026 and upgraded in place six times since. The seventh deploy, running since 24 September 2026 at 04:09:17 UTC, is the same program on SBPF v3, the bytecode format the network keeps accepting for upgrades. See it on the explorer:
https://explorer.solana.com/address/4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG?cluster=devnet

Eight recorded runs from the command line have put sales through it: sales gated by an issuer's approved list, one of them filled and graduated into a Meteora pool; sales open to anyone with a price ceiling against Apple's exchange price, and one against AAPLx, which trades all week; a sale priced to show the ceiling refusing every buy; a sale open only to wallets a verifier has attested; and a ceiling refused on a token that looks like a dollar and is not on the list. Every attack tried against those sales, and every refusal, landed as a real transaction anyone can open. Each of the four doors has its own recorded run on devnet too, linked at the foot of its page.

Mainnet is not deployed. It is ready: a verified build, a deploy that is one guarded command a person runs with their own key, and a full rehearsal on a forked copy of mainnet. The mainnet page says what changes there and who holds the upgrade key.
