---
title: Verify buyers
description: What a verifier is, how to set one up, issue, check and revoke a credential, and how an issuer points a sale at it.
---

## What a verifier is

A verifier is whoever checks buyers before a sale lets them in: a KYC provider, or an issuer's own desk. On Pangu a verifier's approval is a credential on the Solana Attestation Service (`22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`), a public program for exactly this kind of on-chain vouching, at the same address on mainnet and devnet.

A sale in credential mode sells only to wallets its verifier has vouched for, and holds them to the same cap as everyone else. Nothing is asked of a server during a buy. The program works out the one address where this buyer's credential must sit, from the sale's credential, the sale's schema and the buyer's wallet, and reads it: it must belong to the attestation service, name the same credential and schema, and be in date. The key that signed it must still be on the verifier's list of signers at the moment of the buy, so a verifier that removes a signer stops every approval that signer gave, in the same slot, without hunting them down.

`/verify` is the verifier's console. Issuing needs a connected wallet; checking a wallet is open to anyone.

## 01 Set up as a verifier

Connect the wallet that will sign your credentials and type your verifier's name, up to 32 bytes. The name becomes part of your credential's address, so it cannot change later. "Set up" opens two accounts on the attestation service, a credential and a schema, with this wallet as the one key allowed to sign. You pay for them once.

The page then shows the two addresses, and the sentence that matters: "An issuer pastes these two into the launch form to sell only to wallets you verify."

## 02 Issue credentials

Paste buyer wallets, one per line (commas and spaces work too). A line that is not a Solana address is named and left out. Pick when the credential expires: never, in which case it holds until you revoke it, or on a date, in which case it runs out at the end of that day in UTC and every buy from that wallet is refused after it. Issue sends one credential per wallet, in as few transactions as fit.

Each credential's address is derived with the buyer's own wallet as its nonce. That is the one thing the hook needs from a verifier: a transfer hook has no index to search, so it has one shot at deriving the address from what it already knows. A credential issued any other way would never be found, and the buy would be refused.

## 03 Issued credentials

Every credential under your schema, with the day each was issued and its state. Revoke closes the credential's account, which is the only revocation the attestation service has. Its deposit comes back to you, and from that moment every sale that names this verifier refuses the wallet's buys with `CredentialInvalid`. Selling back is never touched by it.

## Check a wallet

Open to anyone. Pick a verifier (the ones the live sales check, or your own) and paste a wallet. The answer is read straight off the chain:

| State | What the page says |
| --- | --- |
| Valid | This wallet holds a credential from this verifier that is in date. A sale that checks this verifier accepts it as a buyer, and holds it to the same cap as everyone. |
| Expired | This wallet was verified, but the credential has run out. A sale refuses its buys until the verifier issues a new one. |
| Absent | This verifier holds no credential for this wallet: never issued, or revoked. A sale that checks this verifier refuses its buys. |

## How an issuer uses it

On `/launch`, under "Who may buy", choose "Credential holders" and paste the verifier's two addresses. When the sale opens, `create_sale` checks that both are real accounts of the attestation service and refuses a paused schema, since a paused schema is the verifier saying stop and a sale nobody can join is worse than no sale. Both addresses are then fixed in the sale's rules.

From then on every buy meets the checks above, and a buyer who fails them gets the program's own refusal:

| Refusal | Why |
| --- | --- |
| `CredentialInvalid` | No credential from this sale's verifier at this wallet's address: never issued, or revoked. |
| `CredentialExpired` | The credential's expiry has passed. |
| `CredentialSignerNotAuthorized` | The key that signed the credential is no longer on the verifier's list of signers. |

The sale page tells a connected wallet where it stands before it tries: "Your wallet holds a valid approval from this verifier", or not.

## The demo credential is self-issued

No KYC company has yet published a credential for Pangu to point at, so the demo credential sale, PVRFD, trusts the demo key's own verifier, and the app says so. A real issuer points its sale at a real verifier's two addresses; nothing in the program changes.

## Proven on devnet

From `packages/web/lab-evidence/verify-devnet.txt`: the console driven on devnet on 23 September 2026 by a throwaway verifier, every step checked on the page and on the chain. 9 checks passed, 0 failed.

- Set up as a verifier: credential `AJs6VH4uWU7sku7ZuVxWFLyaoesYTtGc9XWaH94qSNdH`, schema `9EQNgQtUhzLUCeZx7HpWAp3tpaAmEYXksdaAYJqpYAkr`, [`3otsEu8x`](https://explorer.solana.com/tx/3otsEu8xkdGuCpnDgiyFmfvNTUjrVP5bHyDZqfRwhJvoNhPNoQgh4dwftLZ4k115jaw3W2dGeBNAEkxDef5beXZa?cluster=devnet)
- Issued to a buyer, expiring at the end of 23 September 2027 UTC: [`31Agch8k`](https://explorer.solana.com/tx/31Agch8kdKxXkQxDjBarD14TeaarAhapazDWk1Ew69aNaMa39nP9bvTbaVCDR95uYTN4i8gvZUn53bYNjkZNYUnd?cluster=devnet). The page and the chain both said valid.
- Revoked: [`3RPKRwM4`](https://explorer.solana.com/tx/3RPKRwM4E7dh3FbJsgLQLKEW51ECGb1jr7opta1rv2cor5uf4btSrHkpvcx8maWzkyLRqssQeaNQrZS2edLTxR1G?cluster=devnet). The credential's account closed, and the page and the chain both said absent.
- What it cost the verifier: 0.002519440 SOL, the deposits for the credential and the schema, which stay, plus the fees. The deposit for the buyer's credential came back on revoke.

The rule itself, on the live program, from the sixth run in `docs/measurements/devnet-run.md` against the credential sale PVRFD: a wallet with no credential refused with `CredentialInvalid` [`2dvaB2gc`](https://explorer.solana.com/tx/2dvaB2gcFvwmdmQbYHV2wuuGKtQfTdPUk6yZNWXTMyrFHE9XVkeWZM2N7tGiwysNDx8jHUTrGxMkBFWDK3G3iPGi?cluster=devnet), an attested wallet buying under the cap [`3ym4DSTu`](https://explorer.solana.com/tx/3ym4DSTuYLPZztEKQwGyA231RB6pfq5MAw7TUWWj6mw1EWHNH3k3v87aBEM1G2kvfKEW21gPdCSYKbchHYZmti4X?cluster=devnet), and the same kind of wallet refused past the cap with `OverCap` [`3dg8z3XT`](https://explorer.solana.com/tx/3dg8z3XTWhjcw2CoXpgcFX1ogJ8qhrm6oQkYhxnL7mFAZFEU9Gj5ZXKoDiJwBJdm9rH94Bd4nQPtaoyGXixgSX9D?cluster=devnet).
