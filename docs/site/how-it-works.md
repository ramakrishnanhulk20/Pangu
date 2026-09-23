---
title: How it works
description: The four rules, what a sale must get right to open, when the rules switch off, where each rule shows up in the app, and why Pangu has to sit inside a transfer hook.
---

Meteora's Dynamic Bonding Curve can attach a small program, called a transfer hook, to a new token. From the moment the token is created, every single movement of it (every buy, every sell, every wallet-to-wallet send) has to pass through that hook before Solana lets it happen. Pangu is that hook. It has no other job.

## The four rules

While the sale is open, Pangu checks every movement of the token against four rules.

1. **A wallet cannot buy past its cap.** Each sale sets a limit on how many tokens one wallet can hold, counted net of anything it sells back. The limit is tracked per wallet, not per token account, so opening a second account to dodge it does not work.
2. **A wallet must be allowed to buy, if the sale requires that.** An issuer can run the sale wide open, or require buyers to be on an approved list the issuer manages, or require buyers to hold a credential from a verifier (a Solana attestation, the same kind of technology used for on-chain identity checks).
3. **A buy cannot push the price too far above the real stock's price, if the sale has a ceiling.** This only applies to sales that turn it on, and it compares the curve's price in dollars per token against a live price feed for the real stock, sourced from Pyth (a widely used price oracle). An issuer picks the feed: Apple's exchange price, which Pyth publishes only while the market trades, or AAPLx, the tokenized Apple share, which it publishes all week. It only ever blocks a buy that would go too high. It never blocks a sell, and it never blocks a buy at or below the real price.
4. **Tokens can only move between a wallet and the sale's own pool, never wallet to wallet, while the sale is running.** This closes the obvious way around the first three rules: pool tokens with a friend, or hand a full account to someone who was not approved.

Selling back to the pool is always allowed, no matter what. Nothing about the cap, the approval list, or the price ceiling can ever block an exit.

## What a sale must get right to open

Before any of that, the program checks how the sale was set up, and refuses to open one that would hurt its buyers. Each refusal comes back by name.

- **A sale with a price ceiling must be priced in a dollar the program lists.** The ceiling compares the curve's price with a stock price in dollars. If buyers paid in SOL the two numbers would be in different units and the ceiling would mean nothing. The list is USDC on mainnet, and devnet USDC and the demo dollar on devnet; a token that only looks like a dollar is refused with `BandNeedsDollarQuote`.
- **The issuer cannot pick a paying token they are able to freeze.** Whoever can freeze the paying token can freeze the pool's account or a seller's, and a frozen account cannot be paid. That would put the exit in the issuer's hands.
- **The per-wallet cap must sit below what the curve sells.** A cap as large as the whole sale would let one wallet buy all of it, the one thing a cap exists to stop.
- **Every sale names an offering period, or says plainly it has none.** The end is fixed when the sale opens and nobody can move it afterwards. An end that has already passed is refused.

## When the rules switch off

The rules switch off at graduation, or when the offering period ends, whichever comes first.

When the curve fills (enough buyers have bought that the sale reaches its threshold) Meteora's own code removes Pangu from the token, permanently, inside that very last trade. After that moment Pangu is never called again for that token, the four rules above stop applying, and the token trades freely like any other. The remaining liquidity moves automatically into a new Meteora pool (DAMM v2) so trading can continue with real depth behind it.

If the offering period ends first, Pangu stays attached to the token but lets every transfer through untouched from that moment, cap and approvals included, exactly as it would after graduation, and a buyer can close their record and take back its rent. This is what stops a curve that never fills from locking its buyers in for good. A sale opened with no end keeps its rules until graduation. The two banded demo sales on devnet, PBAND2 and PAAPLX, end on 7 October 2026.

## The same rules, from four pages

The app puts each rule in front of the person it matters to.

- Launch (`/launch`) is where an issuer sets them: the cap as a share of what the curve sells, who may buy, the price ceiling and the feed it follows, the paying token, and the offering period. Each field carries the name of the refusal it becomes, and the program refuses a sale set up against its buyers before it opens.
- Buy (`/sales` and each sale's page) is where a buyer meets them. Before the wallet is asked to sign, the page puts the buy to the same checks the program will run and answers with a pass or the refusal by name, the room left under the cap, or the issuer or verifier to ask.
- Verify (`/verify`) is where a verifier issues the credentials that a sale in credential mode reads on every buy, and revokes them.
- Portfolio (`/portfolio`) is where a wallet sees its standing in each sale: what it holds, the room left under the cap, and whether it may still buy.

## Why this has to be a transfer hook, and why that is the load-bearing choice

Every rule Pangu enforces depends on seeing every single movement of the token, not just the buys that go through Meteora's own trading interface. If Pangu were a separate program that buyers had to opt into, or a check the app made before sending a transaction, a buyer could simply skip it: buy through some other client, or send tokens wallet to wallet, and none of the four rules would ever run. Because Pangu is registered as the token's actual transfer hook at the Solana token-program level, there is no such path. Every transfer, from any app, from any wallet, calls Pangu first. That is what makes the rules real rather than a suggestion, and it is why the reference implementation, the tests, and every devnet transaction linked from this site are built around a real Meteora hook pool rather than a mock of one.

## Diagram 1: how the pieces fit together

```mermaid
flowchart TB
    Issuer[Issuer]
    Buyer[Buyer wallet]
    Verifier[Verifier attestation service]
    App[App and scripts]
    SDK[pangu-sdk]
    T22[Token-2022 sale token]
    DBC[Meteora DBC pool and vaults]
    Pangu[Pangu rules program]
    Rules[(SaleRules)]
    Record[(BuyerRecord)]
    ExtraList[(Extra account list)]
    Pyth[(Pyth price feed account)]
    Refresher[Any wallet running a Hermes update]
    DAMM[Meteora DAMM v2 pool]

    Issuer --> App
    Buyer --> App
    App --> SDK
    SDK --> DBC
    SDK --> Pangu
    Verifier -. issues credential .-> Buyer
    DBC -->|swap moves sale token| T22
    T22 -->|hook call, sale only| Pangu
    Pangu --> Rules
    Pangu --> Record
    Pangu --> ExtraList
    Pangu -. reads price, sale only .-> Pyth
    Refresher -. refresh, anytime .-> Pyth
    DBC ==>|graduation, one time| DAMM
```

The dotted arrows only exist while the sale is open: the hook call from the token program, Pangu's read of the price account, and the verifier's credential. The double arrow to DAMM v2 fires once, at graduation, and nothing points from Pangu to DAMM because Pangu is never called again after that trade.

## Diagram 2: one buy, start to finish

```mermaid
sequenceDiagram
    actor Buyer
    participant App
    participant DBC as Meteora DBC
    participant T22 as Token-2022
    participant Pangu
    participant Pyth as Pyth price account

    Buyer->>App: click buy
    App->>DBC: preflightBuy, read curve state
    App->>App: build transaction: open record if missing, refresh price if banded, swap2WithTransferHook
    App->>DBC: send buy transaction
    DBC->>DBC: apply swap, move sale token from vault
    DBC->>T22: transfer sale token to buyer
    T22->>Pangu: execute amount, published accounts
    Pangu->>Pangu: check transferring flag
    Pangu->>Pangu: identify buy by source vault address
    Pangu->>Pangu: check destination has ImmutableOwner
    Pangu->>Pangu: load buyer record
    Pangu->>Pangu: check access rule, list or attestation with live signer check
    alt price band on
        Pangu->>Pyth: read price account
        Pangu->>Pangu: check owner, feed id, verification level, freshness, confidence
        Pangu->>Pangu: check curve price after buy against ceiling
    end
    Pangu->>Pangu: check cap
    alt all checks pass
        Pangu->>Pangu: write record, emit Bought
        Pangu-->>T22: allow transfer
        T22-->>DBC: transfer complete
        DBC-->>App: swap succeeds
    else any check fails
        Pangu-->>T22: return named error
        T22-->>DBC: transfer fails
        DBC-->>App: swap fails, whole transaction reverts
    end

    Note over DBC,T22: later, the completing swap
    DBC->>T22: revoke Pangu as transfer hook
    Buyer->>DBC: anyone calls migrate to DAMM v2
```

The checks run in the order shown, and the first one that fails ends the whole transaction, the swap included, with a named error. The last two lines happen on a later transaction: the swap that fills the curve is the one where Meteora removes Pangu as the hook, and after that any wallet, not just the buyer, can trigger the migration to the new liquidity pool.

## Diagram 3: how the code is organized

```mermaid
flowchart TD
    subgraph Program[Pangu on-chain program]
        Lib[lib.rs entry point]
        CreateSale[create_sale]
        OpenRecord[open_buyer_record]
        ApproveBuyer[approve_buyer]
        RevokeBuyer[revoke_buyer]
        CloseRecord[close_buyer_record]
        Execute[execute, the transfer hook]
        State[state.rs]
        Errors[errors.rs]
        Events[events.rs]
        Dbc[dbc.rs, DBC account layouts]
        Sas[sas.rs, attestation layout]
        Price[price.rs, Pyth layout]
    end

    Token22[Token-2022 extensions]

    Lib --> CreateSale
    Lib --> OpenRecord
    Lib --> ApproveBuyer
    Lib --> RevokeBuyer
    Lib --> CloseRecord
    Lib --> Execute

    CreateSale --> State
    CreateSale --> Errors
    CreateSale --> Events
    CreateSale --> Dbc

    OpenRecord --> State
    OpenRecord --> Errors
    OpenRecord --> Events

    ApproveBuyer --> State
    ApproveBuyer --> Errors
    ApproveBuyer --> Events

    RevokeBuyer --> State
    RevokeBuyer --> Errors
    RevokeBuyer --> Events

    CloseRecord --> State
    CloseRecord --> Errors
    CloseRecord --> Events

    Execute --> State
    Execute --> Errors
    Execute --> Events
    Execute --> Dbc
    Execute --> Sas
    Execute --> Price
    Execute --> Token22

    SdkCore[pangu-sdk core]
    SdkDbc[pangu-sdk dbc]
    SdkPrice[pangu-sdk price]
    AppScripts[packages and scripts]

    SdkCore --> Lib
    SdkDbc --> Dbc
    SdkPrice --> Price
    AppScripts --> SdkCore
    AppScripts --> SdkDbc
    AppScripts --> SdkPrice

    Bankrun[bankrun unit tests]
    ForkTests[forked-mainnet tests]

    Bankrun --> Lib
    ForkTests --> Lib
    ForkTests --> SdkCore
```

`execute`, the transfer hook, is the only instruction that touches every outside system Pangu depends on: Meteora's pool, the attestation service, and Pyth's price feed, plus the token program's own extensions. That is why almost every safety rule in the security page traces back to this one function.

## Diagram 4: the app, its server routes, and the chain

```mermaid
flowchart LR
    subgraph Pages[Pages in the browser]
        Front["/ the live sale and Try to break it"]
        SalesPage["/sales every sale on the chain"]
        SalePage["/sale/mint buy, sell, issuer controls"]
        LaunchPage["/launch open a sale"]
        VerifyPage["/verify issue and check credentials"]
        PortfolioPage["/portfolio one wallet's sales"]
    end

    Wallet[The visitor's wallet]

    subgraph Routes[Server routes]
        Directory["/api/sales"]
        Readout["/api/readout/mint and /api/pulse"]
        BreakSale["/api/break/sale"]
        Holdings["/api/portfolio/wallet"]
        Price["/api/price/mint"]
        Refresh["/api/price/refresh"]
        Dollars["/api/break/dollars, devnet only"]
    end

    subgraph Chain[Solana]
        PanguProgram[Pangu rules program]
        DBC[Meteora DBC pool]
        SAS[Solana Attestation Service]
        PythAccount[(Pyth price account)]
        DemoDollar[(Demo dollar mint)]
    end

    Irys[Irys storage]
    Hermes[Pyth Hermes]

    Front --> Readout
    Front --> BreakSale
    Front --> Dollars
    SalesPage --> Directory
    SalePage --> Readout
    SalePage --> Refresh
    PortfolioPage --> Holdings
    LaunchPage --> Price
    LaunchPage -->|logo and description| Irys
    VerifyPage -->|reads credentials| SAS

    Front --> Wallet
    SalePage --> Wallet
    LaunchPage --> Wallet
    VerifyPage --> Wallet
    Wallet -->|signs every transaction| DBC
    Wallet --> PanguProgram
    Wallet --> SAS

    Directory --> PanguProgram
    Readout --> DBC
    Readout --> PanguProgram
    BreakSale --> PanguProgram
    Holdings --> PanguProgram
    Price --> PythAccount
    Refresh -->|asks for a signed price| Hermes
    Refresh -->|posts it| PythAccount
    Dollars -->|one grant a wallet an hour| DemoDollar
```

The pages build every transaction in the browser with `pangu-sdk`, and only the visitor's wallet signs them. The server routes read the chain for everyone at once and share each reading for a few seconds, so a crowd of visitors costs the chain one read. They also hold what a browser must never see: the keyed network endpoint, the Pyth key, and one signing key that pays for price refreshes and, on devnet only, mints demo dollars. The limits on those routes are rules C15 and C17 on the security page.
