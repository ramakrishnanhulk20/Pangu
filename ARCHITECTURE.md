# Pangu architecture

Pangu is a rules program that Meteora's Dynamic Bonding Curve (DBC) attaches to a newly launched stock token for the length of its first sale. DBC finds the price. Pangu decides who may receive tokens and how many. When the sale fills, DBC removes Pangu from the token for good.

## Diagrams

### 1. System overview

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

The dotted arrows only exist while the sale is open: the hook call from Token-2022, Pangu's read of the price account, and the verifier's credential. The double arrow to DAMM v2 fires once, at graduation, and nothing points from Pangu to DAMM because Pangu is never called again after that trade.

### 2. Main sequence: one buy end to end

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

The checks run in the order shown, and the first one that fails ends the whole transaction, DBC's swap included, with the named error. The last two lines happen on a separate, later transaction: the swap that fills the curve is the one where DBC removes Pangu as the hook, and after that any wallet, not just the buyer, can call the migration.

### 3. Module dependency graph

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

`execute`, the transfer hook, is the only instruction that touches all three outside layouts (DBC, the attestation service, Pyth) plus Token-2022's extensions, which is why it carries almost every invariant in the threat model. The bankrun tests exercise the program directly and in isolation; the forked-mainnet tests go through the SDK against real cloned DBC and DAMM v2 programs.

### 4. The app, its server routes, and the chain

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

The pages build every transaction in the browser with `pangu-sdk` and the visitor's wallet signs it; no route ever signs for a visitor. The routes read the chain once for every visitor and share the reading, and they hold what a browser must never see: the keyed network endpoint, the Pyth key, and one signing key that pays for price refreshes and, on devnet only, mints demo dollars. The section "The app" below lists each route and its limits.

## Fixed facts from DBC (verified on mainnet, 21 Sep 2026)

| Fact | Value |
|---|---|
| DBC program | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` (mainnet and devnet) |
| DBC pool authority (owner of every pool vault) | `FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM` |
| Hook pool account (`TransferHookPool`) | 424 bytes, discriminator `[237,219,184,23,42,189,169,35]` |
| Offsets inside the pool account | `config` 72, `creator` 104, `base_mint` 136, `base_vault` 168, `quote_vault` 200, `sqrt_price` (u128) 280 |
| Base vault address | PDA of DBC, seeds `["token_vault", base_mint, pool]` |
| Hook config account (`ConfigWithTransferHook`) | 1128 bytes, discriminator `[40,220,194,251,41,199,123,253]`, hook program id at offset 1048 |
| Token program of the sale token | Token-2022, extensions: metadata pointer, token metadata, transfer hook. No freeze authority. |

## Accounts Pangu owns

**SaleRules**, one per sale token. PDA seeds `["sale", mint]`.

| Field | Type | Meaning |
|---|---|---|
| `mint` | Pubkey | the sale token |
| `pool` | Pubkey | the DBC hook pool |
| `base_vault` | Pubkey | the pool's token vault, read from the pool account at creation |
| `issuer` | Pubkey | the pool creator. The only key that can approve buyers |
| `cap` | u64 | most tokens one wallet may hold net of sells, in raw units. Must be above zero |
| `access_mode` | u8 | 0 open (cap only), 1 issuer list, 2 verifier credential |
| `credential` | Pubkey | mode 2: the attestation credential that counts. Zero otherwise |
| `schema` | Pubkey | mode 2: the attestation schema that counts. Zero otherwise |
| `price_account` | Pubkey | band only: the Pyth price feed account, at byte 209, the PDA of the price feed program `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` from (Pangu's shard id, feed id). Owned by the Pyth receiver program. Zero when no band. (Switchboard until 22 Sep 2026; it shut down on 25 Sep 2026) |
| `price_feed_id` | [u8; 32] | the Pyth feed, for example Equity.US.AAPL/USD |
| `price_shard` | u16 | Pangu's own shard id, so no sale depends on Pyth's sponsored shard 0 |
| `band_bps` | u16 | how far above the live stock price a buy may leave the curve price, in basis points. Zero means no band |
| `max_price_age_secs` | u32 | how old the price may be on a buy. Pyth does not publish an equity outside its trading sessions, so this is also what closes a banded sale when the market is shut |
| `max_conf_bps` | u16 | widest confidence interval accepted, as a share of the price |
| `base_decimals`, `quote_decimals` | u8, u8 | read from the two mints at creation, so the curve price can be turned into dollars per token |
| `buyers` | u32 | wallets with a record above zero bought |
| `total_net_bought` | u64 | sum of all records, for the largest-holder share |
| `bump` | u8 | |
| `layout_version` | u8 | at byte 298. 2 today, and 1 is still read: version 2 only filled spare bytes, so every field before this one sits where version 1 put it and the two new fields read as zero on a version 1 account. Every reader refuses any other value, so an account written by an older build can never decode into nonsense; the sell path treats it as "no record" and still passes |
| `quote_mint` | Pubkey | at byte 299, version 2 onwards. The token buyers pay in, read from the launch template at creation for every sale. `create_sale` refuses one the issuer can freeze, and on a banded sale refuses wrapped SOL |
| `ends_at` | i64 | at byte 331, version 2 onwards. Unix seconds at which the offering period ends. From then on the hook lets every transfer through untouched, as after graduation, and a buyer may close a record that still counts tokens. Zero means no end, which is what every version 1 account holds |
| `reserved` | [u8; 23] | room to grow without a migration. The account stays 362 bytes in every version |

Rules are set once at creation and never change. There is no update instruction.

**BuyerRecord**, one per sale and wallet. PDA seeds `["buyer", mint, wallet]`.

| Field | Type | Meaning |
|---|---|---|
| `mint` | Pubkey | |
| `wallet` | Pubkey | the owner of the receiving token account, not the token account |
| `approved` | bool | set by the issuer in mode 1 |
| `net_bought` | u64 | tokens received from the pool minus tokens sold back |
| `bump` | u8 | |

**ExtraAccountMetaList**, one per sale token, the standard transfer-hook account. PDA seeds `["extra-account-metas", mint]`. Order of the extra accounts after the five standard ones (source 0, mint 1, destination 2, authority 3, this list 4):

| Index | Account | How it is derived | Writable |
|---|---|---|---|
| 5 | SaleRules | seeds `"sale"`, key of account 1 | yes |
| 6 | BuyerRecord of the destination's owner | seeds `"buyer"`, key of account 1, bytes 32..64 of account 2's data | yes |
| 7 | BuyerRecord of the source's owner | seeds `"buyer"`, key of account 1, bytes 32..64 of account 0's data | yes |
| 8 | mode 2 only: the Solana Attestation Service program `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | fixed address, present so the next derivations can name it | no |
| 9 | mode 2 only: the verifier's Credential account | fixed address, written into the list at creation from the same argument that is stored in SaleRules. The hook still compares it with `credential` in SaleRules before reading it | no |
| 10 | mode 2 only: the Attestation of the destination's owner | PDA of the attestation program, seeds `"attestation"`, `credential` and `schema` read out of SaleRules (account 5), bytes 32..64 of account 2's data | no |
| next | band only: the DBC pool | fixed address written at creation. Read for the curve price after this buy. The hook compares it with `pool` in SaleRules | no |
| next | band only: the Pyth price feed account | fixed address written at creation. The hook compares it with `price_account` in SaleRules | no |

The list is written once per sale, so a sale only carries the accounts its own rules need. Addresses known at creation are written into the list as fixed addresses, because older builds of the token program do not understand an address read out of another account's data. Only the attestation address has to be derived per buyer: its seeds read `credential` and `schema` at bytes 145 and 177 of SaleRules, so the order of the SaleRules fields up to `schema` can never change once a sale exists.

A record account that does not exist yet is still passed. The program treats an uninitialized record as "no record".

## Instructions

| Instruction | Who | What |
|---|---|---|
| `create_sale(cap, access_mode, credential, schema, band, ends_at)` | the pool creator, after the pool exists, in the same transaction | Accounts: issuer, pool, mint, credential and schema (mode 2 only, the program's own id in their place otherwise), the pool's launch template, the paying token's mint (every sale), the rules and the extra-accounts list (both created here), the system program. Reads the DBC pool account and proves: owned by DBC, hook pool discriminator, `creator` equals the signer, `base_mint` equals the mint. Reads the pool's launch template (required in every mode) and proves fees are collected in the paying token. Proves the paying token is the one the template names and that the issuer cannot freeze it, and stores it. Proves the mint's transfer-hook program is Pangu and that its minting power is already gone. Refuses a cap of zero or at or above the curve's supply, and an `ends_at` that is neither zero (no end) nor later than the chain clock. Stores the rules. Creates the extra-accounts list. Can run once per mint. |
| `open_buyer_record()` | any wallet, for itself | Creates the wallet's record, not approved, zero bought. Needed before a first buy because a hook cannot create accounts. Safe to call twice. |
| `approve_buyer(wallet)` | issuer | Mode 1. Creates the record if missing and marks it approved. Never resets `net_bought`. |
| `revoke_buyer(wallet)` | issuer | Mode 1. Marks the record not approved. The wallet can still sell. |
| `close_buyer_record()` | the wallet | Accounts: wallet, mint, the record, and the sale's rules, read only to learn whether the offering period has ended. After graduation (the mint no longer names Pangu as its hook), after the offering period in the rules has ended, or at any time while the record's net bought is zero. Returns the rent to the wallet. A closed zero record can be reopened, unapproved. |
| `execute(amount)` | Token-2022 only | The transfer hook. Logic below. |

## The hook decision

1. Prove the call is real: both token accounts belong to this mint and carry Token-2022's "transferring" flag. Otherwise fail.
2. Prove SaleRules is the PDA for this mint and is initialized.
3. If the destination is `base_vault`: this is a sell. Lower the source owner's record if it exists, never below zero. Allow. Nothing else is read.
4. Else if the source is `base_vault`: this is a buy.
   - The destination token account must carry Token-2022's `ImmutableOwner` extension (every associated token account does). Otherwise `ReceivingAccountOwnerCanChange`.
   - The destination owner's record must exist and be the right PDA.
   - Mode 1: the record must be approved.
   - Mode 2: the attestation account must sit at the address derived from this sale's credential, this sale's schema and the buyer's wallet, be owned by the attestation program, carry the attestation discriminator, name the same credential and schema, and be unexpired (an expiry of zero means it never expires). A revoked attestation is a closed account, so it simply is not there. The key that signed the attestation must still be on the credential's list of authorized signers at the moment of the buy, so removing a bad verifier stops its old approvals at once. `CredentialInvalid`, `CredentialExpired`, `CredentialSignerNotAuthorized`.
   - Band on: the price account must be the one the rules name, owned by the Pyth receiver program, carry this sale's feed id, be fully verified, be published within `max_price_age_secs` and not in the future, and hold a price above zero with a confidence interval inside `max_conf_bps`. Then the curve price AFTER this buy, in dollars per token, must not exceed the stock price by more than `band_bps`. A buy below the stock price is never refused. `WrongPriceAccount`, `PriceNotFullyVerified`, `PriceStale`, `PriceTooUncertain`, `PriceOutsideBand`.
   - `net_bought + amount` must not exceed `cap`. Then raise the record and the totals.
5. Else: wallet to wallet during the sale. Refuse.

## Errors

`NotTransferring`, `ReceivingAccountOwnerCanChange`, `InvalidBand`, `WrongMint`, `WrongBuyerRecord`, `BuyerRecordMissing`, `NotApproved`, `CredentialInvalid`, `CredentialExpired`, `CredentialSignerNotAuthorized`, `OverCap`, `WalletToWalletDuringSale`, `PriceStale`, `PriceNotFullyVerified`, `PriceTooUncertain`, `PriceOutsideBand`, `WrongPriceAccount`, `NotPoolCreator`, `NotAHookPool`, `WrongLaunchTemplate`, `FeesNotInQuoteToken`, `MintAuthorityStillSet`, `HookProgramMismatch`, `ZeroCap`, `InvalidAccessMode`, `SaleStillRunning`, `NotIssuer`, `MathOverflow`, `WrongLayoutVersion`, `BandNeedsDollarQuote` (a banded sale whose paying token is not on this build's dollar list), `IssuerControlsPayingToken` (the issuer holds the paying token's freeze authority), `CapCoversWholeSale` (the cap is at or above the `swap_base_amount` the launch template's curve sells), `EndInThePast` (an offering end that is not later than the chain clock). The last five were added at the end of the list, so every older code still means what it did.

The program is built twice from the same source: the devnet build (`scripts/wsl/build.sh`, Cargo feature `devnet`) lets a price ceiling be set only on devnet USDC and the demo dollar, and the mainnet build (no feature) only on USDC.

## Events

`SaleCreated { mint, pool, issuer, base_vault, cap, access_mode, band_bps, quote_mint, ends_at }`, `BuyerApproved`, `BuyerRevoked`, `BuyerRecordOpened`, `BuyerRecordClosed`, `Bought { mint, wallet, amount, net_bought }`, `SoldBack { mint, wallet, amount, net_bought }`. Every event names the mint, so one sale's events can be told from another's in a shared log.

## Launch template rules (DBC config)

- Token type Token-2022, hook program Pangu, graduation to DAMM v2.
- Fees collected in the paying token only, so no fee claim or referral payout ever moves the sale token while the hook is live.
- Token authority option `CreatorUpdateAuthority` (metadata stays editable, minting power revoked at launch). `create_sale` refuses a mint whose mint authority is still set (threat model C14, the founder's decision 22 Sep 2026). An issuer with more shares later runs a new sale.
- Fees collected in the paying token is checked on chain too: `create_sale` reads the template's collect fee mode in every mode and refuses anything else (C11, code review 22 Sep 2026).

## The app

`packages/web`, one Next.js app. It holds no database: every number on every page is read off the chain as the page loads. One build setting, `NEXT_PUBLIC_PANGU_NETWORK`, picks devnet or mainnet, and every per-network fact lives in `lib/network.ts`.

### Pages

| Route | Who it is for | What it reads | What the visitor's wallet signs |
|---|---|---|---|
| `/` | everyone | the live banded demo sale through `/api/pulse`, `/api/readout/[mint]` and `/api/break/sale` | the nine "Try to break it" rows, simulated by default; on mainnet, simulate only |
| `/sales` | buyers | every Pangu sale, through `/api/sales` | nothing |
| `/sale/[mint]` | buyers and the sale's issuer | the sale through `/api/readout/[mint]`; the wallet's own standing, the quote and the preflight straight from the browser's endpoint | a buy or a sell (`pangu-sdk/dbc`); for the issuer, approving wallets, claiming fees and migrating to DAMM v2 |
| `/launch` | issuers | the stock price through `/api/price/[mint]` for a sale on the chosen feed | the Irys top-up and one message per file when there is a logo, description or link; the launch template; the pool and the sale's rules in one transaction |
| `/verify` | verifiers, and anyone checking a wallet | the Solana Attestation Service, straight from the browser's endpoint | the credential and schema, one credential per buyer, a revocation |
| `/portfolio` | holders and issuers | one wallet's place in every sale, through `/api/portfolio/[wallet]` | nothing |
| `/docs` | everyone | `content/docs`, built with the app | nothing |

A launch that stops after its template keeps the template's address, never a key, in the browser's session storage, so a second press reuses it and sends only the pool and the rules.

### Server routes

| Route | What it answers | Limit |
|---|---|---|
| `GET /api/sales` | every Pangu sale on the chain, found by scanning the program; `packages/scripts/sales.json` only marks which are the demo sales and which of those are retired | one shared read every 30 seconds; a mint the list does not know reads it again at most every 5 seconds (C17) |
| `GET /api/pulse` | the hero's numbers | one shared read every 10 seconds |
| `GET /api/readout/[mint]` | one sale's curve, price, raise and buyers | only for a mint on the chain's list of sales; one shared read every 10 seconds (C17) |
| `GET /api/break/sale` | the sale the attack ledger runs against | one shared read every 10 seconds |
| `GET /api/portfolio/[wallet]` | one wallet's holdings and issued sales | public data only; one shared read per wallet every 15 seconds |
| `GET /api/price/[mint]` | a sale's stock price, decoded from the Pyth account | only for the app's own sales, from a 10 second cache (C17) |
| `POST /api/price/refresh` | posts a fresh Pyth price for a banded sale | only when the stored price is over ten minutes old, one post at a time, at most one a minute across the process; paid by the demo key on devnet and by its own key on mainnet (C15) |
| `POST /api/break/dollars` | mints demo dollars to a wallet | devnet only, answers 404 on mainnet; one grant per wallet per hour and ten a minute, both reserved before any await (C15) |

The server checks the network it reads, by the genesis hash of its endpoint, once per process before its first read, and refuses every read on the wrong one; the browser runs the same check and says so at the foot of every page.

### Proof

Each door of the app has a recorded run in `packages/web/lab-evidence`: a script that drives the real page with a throwaway wallet and checks every line against the chain. `launch-devnet.txt` and `metadata-devnet.txt` for `/launch`, `sale-devnet.txt` for the sale page, `verify-devnet.txt` for `/verify`, `portfolio-devnet.txt` for `/portfolio`, `break-simulations.txt` and `break-dollars.txt` for the attack ledger, and `network-fork.txt` for the mainnet build's launch, sale and portfolio pages against a forked copy of mainnet.
