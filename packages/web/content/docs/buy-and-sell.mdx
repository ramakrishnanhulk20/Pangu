---
title: Buy and sell
description: Find a running sale, read its page, ask the rules before you sign, buy on the curve and sell back to the pool.
---

Everything on this page happens in the browser, from your own wallet. Nothing is staged: every number is read off the chain as the page loads, and every transaction is one your wallet signs.

## Find a sale

`/sales` lists every Pangu sale on the chain. It does not read a list anyone keeps. It scans the Pangu program itself, so a sale opened a minute ago from the launch page is already there, with its state, who may buy, its price ceiling, what it has raised against its target, its buyers and its issuer. The retired demo sales sit behind a "show them" switch. A sale written by an older build of the program is left out and counted in one line at the foot, because the reader refuses rules another layout wrote rather than guess at them.

The front page leads with one sale: the banded demo sale that can take a buy right now. That is PBAND2, banded on Apple's exchange price, while Pyth is publishing that price, and PAAPLX, banded on the tokenized AAPLx that trades all week, when it is not.

## Read the sale page

Every sale has its own page at `/sale/` followed by the sale token's address. The header states the facts a buyer needs before anything else: whether the sale is running, graduated or past its offering period, and the date the offering ends; who may buy; the price ceiling and which price it follows; what buyers pay in; the issuer; the sale token.

Under it sits the sale's own curve, drawn from Meteora's launch template: the price now against the stock price and the ceiling, the raise against the graduation target, and the cap on one wallet drawn at the width it really has.

## Ask the rules before you sign

Type an amount, in shares or in the paying token. The page quotes it straight off Meteora's pool, in the paying token's own units ("About 5 shares for 0.1573 AAPLx, fee included, at the pool's price now", on a sale paid in AAPLx), and then asks Pangu's rules the same question the chain will ask when the buy lands. Your wallet is not involved yet.

Above the form, one line says where your wallet stands: "You hold 0 PAAPLX, you may still buy 1.09 PAAPLX under the cap. You have $1,756 to spend." On a list sale it also says whether your wallet is on the issuer's list, and on a credential sale whether it holds a valid approval from the sale's verifier.

The answer comes back as a pass or as the program's own refusal, with what to do about it:

| The rules say | What the page tells you |
| --- | --- |
| Pass | The rules would take this buy right now. A pass is the chain as it stands, not a promise: the buy is checked again when it lands. |
| Pass, but the wallet is short | The rules would take this buy, but this wallet does not hold enough to pay for it. |
| `OverCap` | Buy the amount the cap still leaves this wallet, or fewer. |
| `NotApproved` | Ask the issuer, named by address, to add your wallet to the list. |
| `CredentialInvalid`, `CredentialExpired`, `CredentialSignerNotAuthorized` | Ask the sale's verifier for a fresh approval of this wallet, then come back. |
| `PriceOutsideBand` | Buy fewer shares so the curve stays under the ceiling, or wait for the stock price to rise. |
| `PriceStale` | The stock price is too old to buy against. The page asks the server to post a fresh one from Pyth, which takes up to a minute. Outside market hours there is no newer price, so buying waits for the market to open. |
| `PriceTooUncertain` | Wait a few minutes for Pyth's publishers to agree, then try again. |

The Buy button stays held while the rules refuse, so a buy that was always going to fail never reaches your wallet.

## Buy

Press Buy and the page builds one transaction with `pangu-sdk`, runs it against the chain first, and only then asks your wallet to sign. A first buy opens your buyer record in the same transaction, because the transfer hook itself cannot create accounts. When it lands the page says so, links the transaction, and reads your standing again.

The program checks the buy a second time as it lands: the cap, who may buy, and on a banded sale the live stock price. If anything moved between the quote and the signature, the buy is refused by name and costs only its network fee.

## Sell back

The Sell tab quotes a sell the same way ("Selling 0.02 PAAPLX returns about $6.88") and sends it the same way. Selling back to the pool is always open. The program's sell path reads nothing that can be missing: not the cap, not the approval list, not the price. A revoked wallet sells, a wallet with no record sells, and a banded sale whose stock price has gone stale still takes every sell.

## Demo dollars on devnet

The banded demo sales are priced in a demo dollar, a devnet token minted for this demo (`2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5`, six decimals, no freeze authority). A sale priced in it shows a "Get demo dollars" button, which hands your devnet wallet enough to buy with: one grant per wallet per hour, and at most ten grants a minute across the whole site. A sale priced in SOL shows the devnet faucet instead.

On mainnet there are no demo dollars and no faucet: sales there are paid in USDC or a tokenized stock. See the mainnet page.

## When the sale ends

When the curve fills, Meteora moves the sale into a DAMM v2 trading pool and removes Pangu from the token in the same trade. The page then shows the sale as graduated and names its pool. If the offering period ends first, the page says "The offering ended on" that date, "the rules have lifted, this token trades freely."

## Proven on devnet

From `packages/web/lab-evidence/sale-devnet.txt`: a throwaway wallet driven through the sale pages on devnet by a script, reading every line off the page.

- Demo dollars from the sale page's own button: [`547ZiyS9`](https://explorer.solana.com/tx/547ZiyS9nqSHmkYtFe6ujAbLHhiFth5db6n5i4Z8ZxvExzL6NcuFkLbFha8A43wdPM5nFkx2jWEYLKEEhuXutFKC?cluster=devnet)
- A buy on PAAPLX, after the rules answered pass: [`MtunmJmH`](https://explorer.solana.com/tx/MtunmJmH1mLRu7iheZiDwdZ7EpPFtCuMpZ2yVygTY7mdGadd7FWSNEbn7ytjh5NPdSVMeekMb1kkGE2dW6H8pXZ?cluster=devnet). Standing before: 0 held, 1.09 left under the cap. After: 0.05 held, 1.04 left.
- A sell of 0.02 PAAPLX back to the pool: [`2RMM4n6L`](https://explorer.solana.com/tx/2RMM4n6LPbTCZsXoeFCYsg4xpZ94QehkuDq9RZhUn66jUE7A52o5DQ4dGi4zz8jszg9heh91gRfpipNfXyNkYTfP?cluster=devnet)
- On a list sale opened from the launch page, a wallet nobody approved was told `NotApproved` before signing, with the issuer's address to ask. Nothing was sent.
- On a list sale whose issuer key the run held, the issuer approved the wallet from the sale page: [`hcv8L5CM`](https://explorer.solana.com/tx/hcv8L5CMdei2x1EEzyJAqzKivM8uvizzJv2bcEzYqhUkUkJpMH2eu1BxQAqj5PpCwqvLkvGkufUjHhmKAQZcx1y?cluster=devnet). The page then said the wallet was on the list, and its buy landed: [`4s9DrKQu`](https://explorer.solana.com/tx/4s9DrKQu4wBVonTN1XmUHVqUwsBySGL3z427u4pxtrzKy8UhU1RCUo4dNQKz3VSPt68ZqEdqxjS4FcoaDHhF3fRF?cluster=devnet)

The same flow on PBAND2 is in `portfolio-devnet.txt`: a buy [`3Xv3auRc`](https://explorer.solana.com/tx/3Xv3auRcXGZReajEK2BFePqg2rSfAFznQqX4zk8VSKf8epZsGRjaPH2DjkuF1KmBa9VeWVANphgUhUUwAnCPs2AA?cluster=devnet) after a pass from the rules.
