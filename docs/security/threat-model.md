# Threat model

Written at the architecture gate, before any program code, and kept current as code lands. Section C is the definition of done for the rules program.

## System description (functional)

A token issuer runs a first sale of a new stock token on Meteora's Dynamic Bonding Curve (DBC), using a DBC transfer-hook pool. DBC creates the token (Token-2022) and names our rules program as the token's transfer hook. While the sale runs, every movement of the token makes Token-2022 call our program's `execute` entry point with: the source token account, the mint, the destination token account, the signing authority, the amount, and the extra accounts our program listed for that mint.

Our program stores, per sale: the mint, the DBC pool and its token vault, the issuer's admin key, the per-wallet cap, whether an approved-buyer list is in force, which attestation credential counts as approval, and an optional price band read from a Pyth price feed account (Pyth was the plan at the architecture gate, Switchboard replaced it for one day when Pyth refused equity access, and Pyth came back on 22 Sep 2026 when Pyth granted the access and Switchboard announced its shutdown). Per buyer wallet it stores a record: approved or not, and net tokens bought so far. The issuer can add and remove approved wallets and can set rules before the sale opens.

On a buy, tokens move from the pool vault to the buyer. On a sell, tokens move from the seller to the pool vault. Wallet-to-wallet movements are also seen by the program. When the sale fills, DBC removes the hook from the token, permanently, inside the completing trade. Our program is never called again for that token.

Off-chain there is a TypeScript package and scripts that create the DBC launch template, the pool, and our accounts in one transaction, approve buyers, trade, trigger graduation and collect fees. A web app reads chain state and sends transactions through the user's wallet. There is no database and no server that holds keys.

## A. App-class risk profile

This is a policy-enforcement program that is invoked by another program on every token transfer, reads accounts chosen by the caller, and gates a sale of value. It is also a small admin-configured data store.

| Category that typically bites this class | Where it applies here |
|---|---|
| Account substitution | Every `execute` call arrives with accounts the trader's transaction supplied: a buyer record, a sale rules account, an attestation, the Pyth price feed account, the pool account. Any of them could be a look-alike owned by the attacker or by another program. |
| Direct invocation | `execute` is a public entry point. Anyone can call it outside a real transfer to corrupt the bought-so-far counters unless the program checks that the token accounts are genuinely mid-transfer. |
| Limit evasion | The cap is the product. Ways around it: many wallets (sybil), many token accounts under one wallet, buying then moving tokens to a second wallet, receiving tokens from a friend, buying through a referral leg. |
| Trapping users (denial of exit) | The same code path runs on sells. A rule that misfires on a sell locks a holder in. Compute exhaustion, a stale price account or a missing attestation must never block a sell. |
| Initialization front-running | The extra-accounts list and the sale rules account are derived from the mint address, which is public the moment the pool transaction is visible. If anyone can create them first, an attacker sets the rules for our sale. |
| Privileged admin abuse | The issuer key can approve wallets and set rules. The program's upgrade key can replace the code. Either could be used to favour insiders or to block sells mid-sale. |
| Stale or manipulated reference data | The price band reads a Pyth price feed account and the DBC pool's own price. Pyth stops publishing an equity outside its trading sessions, so freshness is also the market clock. The pool price is moved by the very trade being checked. |
| Arithmetic and state errors | Net-bought counters add on buys and subtract on sells. Overflow, underflow on a sell of tokens received elsewhere, and rounding between raw units and display units. |
| Reentrancy | Not applicable in the usual sense: the hook makes no outgoing calls and Token-2022 forbids the hook from moving the tokens in flight. Stated so nobody assumes more. |
| Off-chain transaction assembly | The scripts choose accounts and amounts for transactions Ram or a buyer signs. A wrong pool, wrong template or wrong receiver address sends real money to the wrong place. |

Does not apply: web session handling, server-side secrets, databases, user-supplied URLs. There is no server state.

## B. Threat model

### Trust boundaries
1. Token-2022 to our `execute`: the only trusted facts are the ones Token-2022 itself guarantees (the four fixed accounts and the amount). Everything else in the account list is untrusted until checked.
2. Issuer wallet to our admin instructions.
3. Pyth price feed account data and attestation account data into our decision.
4. DBC pool account data into our decision.
5. Browser to chain: the app builds transactions a user signs.

### Attacker-controlled inputs
- Every account passed to `execute` beyond source, mint, destination, authority.
- The amount, the choice of destination token account, and how many token accounts a wallet holds.
- The timing and ordering of transactions around pool creation and around graduation.
- Wallet count (unlimited, free).
- The content of any account not owned by our program, the attestation program, Pyth's receiver program, or DBC.
- Indirect: the pool price (moved by trading), referral account choice on a swap, token metadata strings shown in the app.

### Privileged position and assets
- Our program can refuse any transfer of the token during the sale. That is the power to freeze every holder.
- The issuer key decides who may buy.
- The upgrade key can change all of the above.
- The scripts hold no keys but decide where fees, surplus and leftover tokens are sent.

### Attacker goals
1. Take more of the sale than the cap allows (many token accounts, consolidation by transfer, handing over ownership of a whole token account, referral leg, direct counter corruption).
2. Set or replace the sale's rules (front-run initialization, fake rules account, fake approval record, fake attestation).
3. Freeze holders or block the sale (make sells fail, exhaust compute, make the price check fail closed forever).
4. Buy outside the price band by feeding a stale or fake price account.
5. Redirect issuer money (fees, surplus, leftover) by tampering with addresses in the launch template or scripts.

## C. Defensive-programming standards (definition of done)

Each line is an outcome the code must uphold. A work order carries the relevant ones, and the builder's report names the file and function that enforces each.

| # | Invariant |
|---|---|
| C1 | `execute` changes state only when Token-2022 is genuinely mid-transfer on both token accounts for this mint. A direct call changes nothing and fails. |
| C2 | Every account the decision depends on is proven to be the one and only account for its role: derived address checked, owning program checked, mint and wallet fields inside it checked. A look-alike never passes. |
| C3 | A wallet's net tokens bought in a sale never exceeds the cap, no matter how many token accounts it holds. The count is kept per wallet owner, not per token account. |
| C4 | During the sale the token moves only between a wallet and the pool vault. Wallet-to-wallet movement fails, so tokens cannot be pooled to dodge the cap or sold off-market to unapproved buyers. |
| C5 | A holder can always sell back to the pool. No rule state, missing account, stale price, revoked approval or admin action can make a sell to the pool vault fail. The sell path reads nothing that can be absent. |
| C6 | When an approved-buyer list is in force, tokens leave the pool vault only to a wallet whose approval is current at that moment. |
| C7 | The sale rules and the extra-accounts list for a mint can be created only by the pool's creator, and only once. They are created in the same transaction as the pool. |
| C8 | Rules that affect buyers (cap, list mode, band) cannot be loosened or tightened in a way that is invisible: every change emits an event, and the cap cannot change after the first trade. |
| C9 | A buy inside a price-banded sale succeeds only when the reference price is fresh, positive and from the expected feed, and the pool price is inside the band. Any doubt refuses the buy. It never refuses a sell. |
| C10 | All counter math is checked. A sell larger than the wallet's recorded net bought reduces the record to zero and never underflows. |
| C11 | The launch template makes fee collection happen in the paying token only, so no fee or referral payout ever moves the sale token through the hook. |
| C12 | Scripts never hold or print a private key, and every address that receives money is shown to the signer before signing and read back from the chain after. |
| C14 | During the sale no sale token can come into existence except out of the pool vault. The mint's minting power is gone before the sale opens, and create_sale refuses a mint that still has it. Minting is not a transfer and no hook sees it, so without this rule the issuer could mint to any wallet, past the cap and the approvals, and sell into the pool. Found in the code review of 22 Sep 2026, decided by Ram the same day. |
| C13 | During the sale, tokens leave the pool vault only into a token account whose owner can never change. Handing over a whole token account is not a transfer, so no hook sees it. Without this rule a buyer could pass tokens to an unapproved wallet, or pass a full account on and buy again. Found in review of the first build, 21 Sep 2026. |

### General standards we commit to
1. **Primitives over lists.** Roles are recognised by derived addresses and owning programs, not by a list of known accounts. The one constant we rely on is DBC's pool authority address, which is fixed by their program. The approved-buyer list is a product feature, not a security shortcut, and its limit is stated below.
2. **Normalize before you compare.** Wallet identity always comes from the owner field parsed out of the token account by the Token-2022 library's own unpacking, on both the buy and the sell path. The address the extra-accounts list derives a buyer record from and the address our code checks are produced by the same parse.
3. **Validate outputs like inputs.** Events carry only values we have already validated. The app treats token names, symbols and links read from chain as untrusted text.
4. **Fail closed, except on the exit.** Buys fail on any doubt. Sells to the pool vault are the one path that must not depend on anything that can be missing, because failing closed there means trapping people. Explicit limits: price staleness in seconds, band in basis points, a bounded number of extra accounts, compute measured and recorded.
5. **Non-goals, named.**
   - One person with many approved wallets. The cap is per wallet. Without an approved-buyer list tied to a real identity check, a cap is only a speed bump. The identity check is only as good as whoever issues the approvals.
   - After graduation there are no rules. That is by design and enforced by DBC, not by us.
   - We do not verify that a token is backed by real shares.
   - The issuer's power to mint more of the token is not a non-goal any more: it is removed at launch (C14). An issuer who later holds more real shares runs a new sale for the new tranche.
   - The upgrade key holder can change the program while a sale is live unless the key is given up. The choice made and its consequences are recorded in `DECISIONS.md` and shown in the app.
   - The issuer can approve their friends. We make the approvals public, we do not judge them.
   - The paying token's own issuer powers. A stock token such as AAPLx carries a permanent delegate that can move it out of any account, including a pool's vault, and a pause switch that would stop every trade. Those belong to the stock token's issuer. Pangu cannot defend against them, so the app shows them for any sale priced in a stock token.
   - The cap limits what a wallet receives, not its share of what is left. When other wallets sell back, one wallet's share of tokens still held can rise above the cap share. The app reports share of tokens sold.
   - Front-running between buyers inside the cap. DBC's decaying fee is the tool for that, not our program.
