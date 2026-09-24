# Fork test: one whole sale against Meteora's real programs

Date: 21 September 2026.

A local validator was loaded with Meteora's Dynamic Bonding Curve and DAMM v2
programs copied straight from mainnet, plus the Pangu build, and one complete sale
was run from launch template to graduation and migration. Nothing was sent to
mainnet. Mainnet was read only.

Run it with:

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/fork-test.sh
```

Result: 19 tests pass, `FORK-TEST-OK`.

## Versions

| Thing | Value |
|---|---|
| Meteora SDK | `@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12, pinned exactly |
| DBC program | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`, last deployed in mainnet slot 445,503,633 |
| DAMM v2 program | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`, last deployed in mainnet slot 445,230,614 |
| Mainnet slot when cloned | 449,054,641 |
| Pangu program | `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG`, `pangu.so` is 255,776 bytes |
| Toolchain | Anchor 1.2.0, solana-cli 4.2.2 (Agave), SBPF v0 |

## What the validator was given, and why

| Account | Why it has to be there |
|---|---|
| `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | The Dynamic Bonding Curve program itself. Cloned with its program data so it runs the real code. |
| `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | DAMM v2. Migration creates a real pool inside it. |
| `FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM` | DBC's pool authority. It owns every pool vault and lends its own lamports for rent while a pool is created, so it has to arrive with its mainnet balance, not empty. |
| `8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF` | DBC's event authority, the signer on its events. |
| `HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC` | DAMM v2's pool authority. Same rent role during migration. |
| `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck` | DAMM v2's config for the "Customizable" migration fee option, the one the launch template names. Migration reads it as remaining account 0. |
| `So11111111111111111111111111111111111111112` | Wrapped SOL, the quote token of the main test. |
| `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | AAPLx, the real Token-2022 stock token used as the quote in the second test. |
| `8VeVZe3Zxfpax2qQUp7i68FCLspLYErm2FJChc5NDuVn` | AAPLx's DBC token badge. Without it DBC refuses a stock token as quote. |
| two rewritten AAPLx token accounts | A test wallet cannot be minted AAPLx. A real mainnet AAPLx account is copied, its owner and balance rewritten, every extension byte left alone, and loaded at the test wallet's own associated token address. Generated at startup into `~/pangu-fork-accounts`, never into the repository. |

DAMM v2's event authority is deliberately not cloned. It does not exist on mainnet
either, because an event authority is only a signing address and never needs an
account of its own.

## What each action costs

Transaction size limit is 1232 bytes. Every swap in the table carries a compute
budget instruction, which is what a real client would send.

| Action | Bytes | Compute units | Accounts |
|---|---|---|---|
| Create the launch template (config) | 662 | 30,854 | 7 |
| Create the pool and the sale rules, one transaction | 928 | 90,787 | 16 |
| First buy through the hook | 910 | 113,299 | 22 |
| A later buy | 910 | 114,801 to 129,801 | 22 |
| Sell back to the pool | 878 | 83,482 | 22 |
| Partner fee claim | 886 | 55,192 | 22 |
| Creator fee claim | 853 | 51,742 | 21 |
| The swap that completes the curve | 910 | 114,464 | 22 |
| Migrate to DAMM v2 | 1139 | 153,633 | 27 |
| Approve a buyer | 342 | 12,038 | 6 |
| Open a buyer record | 310 | 10,341 | 6 |
| Close a buyer record | 244 | 4,478 | 4 |
| Wallet to wallet, after graduation | 425 | 20,671 | 9 |
| Create the template, stock quote | 695 | 33,062 | 8 |
| Create the pool and rules, stock quote | 930 | 100,450 | 16 |
| First buy, paying in AAPLx | 856 | 108,923 | 21 |

Two numbers matter most. The pool and Pangu's rules fit in one transaction with
304 bytes to spare, so the rules can never be set by anyone but the pool creator in
the moment the pool is born. And a buy costs about 115,000 compute units against a
1.4 million limit, so the hook leaves plenty of headroom.

## The proof number

At graduation, with the cap set to a tenth of what the curve sells:

- 12 buyer records existed for the sale.
- The largest single wallet held 9.99 percent of every token the curve sold, against
  a cap share of 9.99 percent.
- Measured instead against the tokens still held from the sale, the largest wallet
  is 10.25 percent. That is higher only because other wallets sold some back, which
  shrinks the denominator. No wallet ever received more than the cap.

## Findings about the real DBC

1. **The SDK's swap helper cannot drive a hook like Pangu.**
   `swap2WithTransferHook` works out a hook's extra accounts by calling
   `createTransferCheckedWithTransferHookInstruction` with the default public key
   standing in for the source, destination and owner. Pangu derives a buyer's record
   from the owner field inside the real destination token account, so the
   placeholder has no such field and the helper throws
   `TokenTransferHookInvalidSeed`. Proven in test d, which asserts the throw.
   On chain nothing is wrong: DBC resolves the same accounts from the real token
   accounts. The fix is client side. The fork tests build the identical
   `swap2WithTransferHook` instruction and attach the accounts themselves, which is
   what the app will have to do too.

2. **The SDK has no transfer-hook-aware fee claim.**
   `claimPartnerTradingFee` calls the old `claim_trading_fee`, which refuses a
   transfer-hook pool with `PoolTypeMismatch`. The program does have
   `claim_trading_fee2` and `claim_creator_trading_fee2`, which take the hook
   account information. The fork test calls those directly and both claims pass.
   The app has to do the same.

3. **The DAMM v2 create-metadata step is gone.** The instruction still exists but
   its handler does nothing and it is marked deprecated, so `migrateToDammV2` is the
   only call migration needs when there is no vesting. Proven by test l.

4. **AAPLx is safe to quote a sale in, but it carries a lot.** Its live extensions
   are metadata pointer, permanent delegate, default account state, scaled UI
   amount, pausable, confidential transfer, transfer hook and token metadata. Read
   from mainnet on the day: the transfer hook names no program, the pausable switch
   is off, and new accounts open initialized rather than frozen. All three matter.
   A hook program on the quote mint would be unsupported, a paused mint would stop
   every trade, and frozen-by-default would stop DBC creating its quote vault. DBC
   counted raw amounts correctly through a buy priced in AAPLx, so the scaled UI
   amount changes display only.
   The one that stays open: AAPLx's permanent delegate, `5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq`,
   can move AAPLx out of any account including the pool's quote vault. That is the
   token issuer's power, not ours, and it is a disclosure item rather than something
   Pangu can defend against.

5. **The cap is only as tight as the sells allow.** A wallet's record can never pass
   the cap, but once other wallets sell back, one wallet's share of what is still
   held rises above the cap share. That is arithmetic, not a hole: it is stated in
   the proof number above so nobody reads a single percentage as a promise.

## Run of 23 September 2026: the v2 rules

Same command, against the build whose rules store the paying token and the end
of the offering period. Binary SHA256
`191e9cf1ab6f9ababc1fb50c1f279b7f19e305934fff0952f8155b4f85a10731`, IDL SHA256
`48836ab193d10b8a58321a9f6777640bc43873f207a6210f2de18c1a47032772`.

Result: 37 tests pass across `life-band.ts`, `life.ts`, `stock-quote.ts` and
`life-credential.ts`, `FORK-TEST-OK`. The one run before it failed on the new
test p, and only in the test's own set-up: the receiving token account has to
exist before the hook's account list can be resolved against it, so it is now
opened in a transaction of its own first.

What changed in the tests:

- Every `create_sale` passes the paying token's mint and an `ends_at`, and
  `close_buyer_record` passes the sale's rules.
- The banded sale's cap was the whole curve, which the program now refuses
  (`CapCoversWholeSale`). It is half the curve, and the walk up to the ceiling
  is spread over three wallets, each kept under the cap. The ceiling still
  refused the buy that crossed it after 9 buys: curve 0.000296 against a
  ceiling of 0.000312 dollars a token.
- New test p. A second sale on the same template, issuer list, with an offering
  period ending 25 seconds after the chain clock. While it runs, a buy from a
  wallet with no record is refused `BuyerRecordMissing`. Once the chain clock
  passes the end, the same wallet, never approved and with no record, buys half
  again over the cap and it lands, no record is written, a wallet-to-wallet
  transfer of 1,000 raw units lands, and a sell lands. The mint still names
  Pangu as its hook at the end, so this is the offering period lifting the
  rules, not graduation.

| Action | Bytes | Compute units | Accounts |
|---|---|---|---|
| Pool plus `create_sale`, issuer list | 944 | 107,968 | 16 |
| Pool plus `create_sale` with an end | 948 | 94,839 | 16 |
| Pool plus `create_sale`, credential mode | 1,012 | 104,841 | 18 |
| First buy, issuer list | 910 | 137,850 | 22 |
| Sell, issuer list | 878 | 108,030 | 22 |
| Over-cap buy after the offering ended | 910 | 120,489 | 22 |
| Wallet to wallet after the offering ended | 484 | 33,002 | 11 |
| Sell after the offering ended | 878 | 90,697 | 22 |
| `close_buyer_record`, now with the rules | 277 | 7,820 | 5 |
| Buy, credential mode | 1,009 | 134,322 | 25 |

The pool and a credential-mode sale still fit one transaction, at 1,012 bytes
against the 1,232 limit. The proof number is unchanged: the largest wallet holds
9.99 percent of every token the curve sold, against a cap share of 9.99 percent.

## Run of 23 September 2026: the SBPF v3 build

Same command, against the binary devnet is being moved to: the same source,
built as SBPF v3 instead of v0. SBPF v3 is the bytecode format the network will
keep accepting for deploys and upgrades once SIMD-0500 switches the older ones
off. Binary SHA256
`7082897943e68901f85c8c93e2581a8a3571af41491ac9f242286592f4b388f8`, 339,848
bytes (the v0 build of the same source is 363,800), ELF header version 3, IDL
SHA256 `0395b2857f9e1015ceda0ef990afce8deac2a98792f631948a7a6406fe35d5b1`.
`fork-test.sh` now refuses to start on anything but a v3 binary and prints the
file and its hash:

```
fork suite binary: /home/ram/pangu-build/target/deploy/pangu.so, SBPF v3, sha256 7082897943e68901f85c8c93e2581a8a3571af41491ac9f242286592f4b388f8
  38 passing (5m)
FORK-TEST-OK
```

The validator runs with every feature gate on, so SIMD-0500 is active in it and
a v0 program could not be deployed there; the v3 program loads and runs. The
run before it never reached the tests: WSL lost its network straight after the
build and the validator could not clone from mainnet. A fresh WSL session fixed
it.

`fork-validator.sh stop` now stops only the validator it started, by the process
id in its own pid file, and refuses to start while some other validator is
answering on the local port. After this run no `solana-test-validator` was left
running and the pid file was gone.

Compute units, whole transactions, v0 (the v2 rules run above) against v3:

| Action | v0 | v3 |
| --- | --- | --- |
| Pool plus `create_sale`, issuer list | 107,968 | 92,925 |
| First buy, issuer list | 137,850 | 113,827 |
| Sell, issuer list | 108,030 | 82,507 |
| Pool plus `create_sale` with an end | 94,839 | 112,796 |
| Over-cap buy after the offering ended | 120,489 | 105,466 |
| Sell after the offering ended | 90,697 | 75,674 |
| Wallet to wallet after the offering ended | 33,002 | 28,479 |
| `close_buyer_record` | 7,820 | 7,813 |
| Pool plus `create_sale`, credential mode | 104,841 | 89,793 |
| Buy, credential mode | 134,322 | 137,290 |

These are whole transactions, DBC's own work included, and one sample each. A
single figure moves by up to about 15,000 units from wallet to wallet, because
Pangu searches for each new wallet's record address, so no one row proves a
change. Eight of the ten rows are lower on v3. Pangu's own share, from
the unit suite on the v0 build the same day: `create_sale` 24,954, a buy
through the hook 42,827, a sell 47,299 (the rules v2 figures were 23.5k, 42.8k
and 45.8k).
