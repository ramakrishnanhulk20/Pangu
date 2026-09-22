# Code review fixes: what was found, and where the numbers come from

Work order WO-10, 22 Sep 2026. Six fixes to the on-chain program and its tests.
Every offset and id below was read out of a source file or a real account, not
remembered. This file is written as the work goes, so it doubles as the progress
note.

## 1. Fee collection must happen in the paying token (C11, now on chain)

`create_sale` always reads the pool's DBC launch template and refuses a template
whose `collect_fee_mode` is anything but `QuoteToken`. The template account was
optional before and only read when a sale had a price band; it is required in
every mode now.

Why it matters: with `OutputToken` the pool pays trading and referral fees in the
sale token, which moves the sale token through the hook on a path nobody checked
against the cap.

**Where `collect_fee_mode` sits.** From
`reference/dynamic-bonding-curve/programs/dynamic-bonding-curve/src/state/config.rs`,
`pub struct PoolConfig` at line 500 and `collect_fee_mode` at line 518:

| Field | Size | Offset in `PoolConfig` |
|---|---|---|
| `quote_mint` | 32 | 0 |
| `fee_claimer` | 32 | 32 |
| `leftover_receiver` | 32 | 64 |
| `pool_fees` (`PoolFeesConfig::INIT_SPACE` = 80, line 69) | 80 | 96 |
| `partner_liquidity_vesting_info` (`LiquidityVestingInfo::INIT_SPACE` = 16, line 625) | 16 | 176 |
| `creator_liquidity_vesting_info` | 16 | 192 |
| `padding_0: [u8; 14]` | 14 | 208 |
| `padding_1: u16` | 2 | 222 |
| `collect_fee_mode: u8` | 1 | **224** |

`ConfigWithTransferHook` is `config: PoolConfig` behind an 8 byte Anchor
discriminator (config.rs line 592), so inside the account the byte sits at
**8 + 224 = 232**. `CollectFeeMode` is `QuoteToken = 0`, `OutputToken = 1`
(`state/virtual_pool.rs` line 43).

**Checked against a real account.** The mainnet launch template
`1kcwsh9MLFMe4G8VThPNLM6JsGELiaTYnQaaErTfbcx` was dumped with
`solana account ... --output json -u m` and saved to
`packages/program/feeds/live-config.bin` (1128 bytes, discriminator
`[40, 220, 194, 251, 41, 199, 123, 253]`). Byte 232 reads 0. Meteora's own SDK
(`@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12, `DynamicBondingCurveIdl` through
Anchor's `BorshAccountsCoder`) decodes the same bytes as
`collect_fee_mode = 0` and `quote_mint = So11111111111111111111111111111111111111112`.
The Rust test `the_live_mainnet_template_reads_at_the_offsets_we_use` and the
mocha test `reads the same launch template the Meteora SDK does` both assert it,
one from each side.

New errors: `FeesNotInQuoteToken` and `WrongLaunchTemplate` (the second one so a
template that is not the pool's own reads the same in every mode, not as a band
error).

## 2. A buyer record with nothing in it closes mid-sale

`close_buyer_record` used to demand that the sale be over, read off the mint's
transfer hook being gone. Now it also allows a record whose `net_bought` is zero,
which holds no counter anybody could lose. A wallet that never bought, or sold
everything back, gets its rent back without waiting for graduation.

Reopening is safe: `open_buyer_record` writes a fresh record at zero and
unapproved, so in the issuer-list mode the issuer has to approve the wallet
again. That is proven in `tests/close.ts`.

## 3. Queue hardening

Two changes in `price.rs`:

- The queue account must carry the `QueueAccountData` Anchor discriminator
  `[217, 194, 55, 127, 184, 83, 138, 1]`. Source:
  `spikes/switchboard/ref/crate/switchboard-on-demand-0.13.0/src/on_demand/accounts/queue.rs`
  line 115, `QUEUE_ACCOUNT_DISCRIMINATOR`. The first eight bytes of the real
  devnet queue in `feeds/live-queue.bin` are `d9 c2 37 7f b8 53 8a 01`, the same
  numbers. A length check alone let any 6280 byte account owned by the On-Demand
  program stand in for a queue.
- The accepted On-Demand program is now one id, not two. The crate itself picks
  with `cfg!(feature = "devnet")` (`src/utils.rs` line 10), so Pangu does the
  same: `ON_DEMAND_PROGRAM_ID` is the mainnet id `SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv`
  by default and the devnet id `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2`
  when the program is built with `--features devnet`. Accepting both meant a
  mainnet deploy would take a devnet queue, where anyone can stand up oracles.

**Which build goes where.** The default build is the mainnet build. Both test
suites run against it: the local mocha tests and the fork tests write their own
queue accounts, so those fixtures now name the mainnet id (`tests/sale-fixture.ts`
and `fork-tests/band-setup.ts`). The Rust unit tests do not need the feature at
all, because the pure functions they call take the queue bytes and never the
owner, and the discriminator is the same on both networks. **A devnet deploy must
be built with `--features devnet`**, or the live devnet queue
`EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7` is refused. `scripts/wsl/build.sh`
and `deploy.sh` were out of scope for this order, so that flag is not wired in
yet.

## 4. Dead code removed

`RulesNotInitialized` and `WrongRulesAccount` were never raised: Anchor's seeds
constraint on the rules account already covers both. `DBC_POOL_AUTHORITY` was
never read: a vault is recognised by its derived address, which is stronger. All
three are gone. Every error code after them shifts, so anything holding a copy of
the IDL has to take the new one.

## 5. Test helper files renamed

`tests/helpers.ts` is now `tests/sale-fixture.ts` and `fork-tests/helpers.ts` is
now `fork-tests/fork-sale.ts`. Both hold the fixtures a sale is built from, and
neither is a bag of utilities.

## 6. A mint that can still be minted is refused (C14, new)

`create_sale` refuses a mint whose mint authority is still set, with
`MintAuthorityStillSet`. Minting is not a transfer, so no hook ever sees it: an
issuer holding the mint authority could mint past the cap, past the approved
list, straight into any wallet, and sell it into the pool.

DBC decides this at pool creation from the template's token authority option. In
`reference/dynamic-bonding-curve/programs/dynamic-bonding-curve/src/instructions/initialize_pool/process_initialize_virtual_pool_with_token2022.rs`
the initial supply is minted into the vault at line 132 (`mint_to` with the pool
authority signing), and then at lines 145 to 167 the mint authority is set to
`token_authority.get_mint_authority(creator, fee_claimer)`. That function
(`state/config.rs` lines 405 to 411) returns `Some` only for
`CreatorUpdateAndMintAuthority` and `PartnerUpdateAndMintAuthority`, and `None`
for `CreatorUpdateAuthority`, `PartnerUpdateAuthority` and `Immutable`. So a
template built with `CreatorUpdateAuthority` still gets its supply minted into
the vault, and comes out of pool creation with no mint authority at all. Every
fork fixture now uses that option.

## What the runs said

`scripts/wsl/test.sh`, 22 Sep 2026: `rust: test result: ok. 26 passed` (21 before)
and `118 passing` mocha (111 before), then `TEST-OK`. The Rust tests were also run
once with `--features devnet`: 26 passed, which is the only proof that the devnet
build compiles and behaves, since the suites run the default build.

`scripts/wsl/fork-test.sh`, same day: `36 passing (4m)` then `FORK-TEST-OK`, against
Meteora's real DBC program, the real attestation service and a real AAPLx mint
cloned from mainnet. That run is the proof for fix 6: every fork template now asks
for `CreatorUpdateAuthority`, and `create_sale`, which refuses a mint that can still
be minted, went through in the same transaction as the pool. So DBC really does mint
the supply into the vault and drop the authority before our instruction runs.

Compute cost, from those runs. Opening a sale: about 23,000 compute units on the
local runtime, and about 101,000 for the pool and the sale together in one
transaction on the fork. A buy through the hook: about 121,000 to 138,000 with a
band, about 131,000 paying in a stock token. A sell: about 103,000 to 106,000.
Closing a buyer record: about 4,500. Reading the launch template added roughly
6,500 units to `create_sale` and nothing at all to a buy or a sell, because the
template is read once when the sale opens and never again.
