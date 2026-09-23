# The price band on Pyth: what it costs and what it proves

Measured on 22 Sep 2026 against Meteora's real Dynamic Bonding Curve, cloned from
mainnet into a local validator, and against Pyth's real devnet receiver program.
Every number below came out of a transaction that ran.

## Why the source changed

Switchboard shuts down on 25 Sep 2026. Pyth granted Ram's key access to every
feed until 5 Oct 2026, tested on 22 Sep 2026 with fresh AAPL, TSLA, SPY, AAPLX
and TSLAX prices. The band rule has not changed: it is still a ceiling on the
curve price measured against the live stock price, and it still never touches a
sell. Only the account the ceiling is read from is different.

**Caveat, stated up front.** Ram's Pyth access runs to 5 Oct 2026. After that
`feeds/refresh.ts` cannot fetch a fresh update from Hermes without a new key, and
with nothing fresh being written the band would refuse every buy and allow every
sell, which is the safe way round but is still a sale nobody can join. The
program side is unaffected either way: it reads an account, not an API, and
anybody at all can refresh that account.

## Test counts, as they stand

| Suite | Command | Result |
| --- | --- | --- |
| Rust unit tests | `test.sh` | 27 passed |
| litesvm suite | `test.sh` | 119 passing |
| Fork against real DBC | `fork-test.sh` | 36 passing |

## The account the band reads, proven against real bytes

Pyth calls it a "price feed account": one fixed address per shard id and feed id,
written by Pyth's receiver program and refreshable by anyone. That fixed address
is the whole reason it fits here, because a Token-2022 transfer hook is handed a
list of accounts that was written when the sale opened, not fresh data at buy time.

**The address.** A program address of the price feed program
`pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`, over two seeds: the shard id as a
`u16` in little endian byte order, then the 32 byte feed id. Copied from
`getPriceFeedAccountForProgram` in `@pythnetwork/pyth-solana-receiver`
(`PythSolanaReceiver.ts`), which writes the shard with `writeUint16LE` and calls
`findProgramAddressSync`. Checked by deriving it: shard 0 with the AAPL feed id
`49f6b65c...5688` gives `DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy`, which is
the account Pyth really keeps on mainnet.

**Pangu's own shard is 7700.** Shard 0 is the one Pyth sponsors, and the AAPL
account on it was last published on 13 Aug 2026, about 37 days before this was
written. A sale on shard 7700 depends on nobody's goodwill: Pangu's own refresher
writes it, and the refresh is permissionless so anyone else can too.

**The owner.** Every price feed account is owned by Pyth's receiver program
`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, read straight off the mainnet
account above. Only that program can write an account it owns, and it checks
Wormhole guardian signatures over the update before it does.

**The layout.** `PriceUpdateV2` from `pyth-solana-receiver-sdk` 2.0.0, and the
exact bytes of the mainnet AAPL account. `PriceUpdateV2::LEN` in the crate is
`8 + 32 + 2 + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8`, which is 134, and the real
account is 134 bytes.

| Bytes | Field | The mainnet AAPL account |
|---|---|---|
| 0..8 | Anchor discriminator | `34, 241, 35, 99, 157, 126, 244, 205`, the first eight bytes of sha256("account:PriceUpdateV2") |
| 8..40 | `write_authority` | `b6a88a1b...837e` |
| 40 | `verification_level` tag | `1` |
| 41..73 | `price_message.feed_id` | `49f6b65c...5688`, the AAPL feed id |
| 73..81 | `price`, `i64` | 30592000 |
| 81..89 | `conf`, `u64` | 2000 |
| 89..93 | `exponent`, `i32` | -5 |
| 93..101 | `publish_time`, `i64` | 1786737619 |
| 101..109 | `prev_publish_time`, `i64` | 1786737619 |
| 109..117 | `ema_price`, `i64` | 30573990 |
| 117..125 | `ema_conf`, `u64` | 13975 |
| 125..133 | `posted_slot`, `u64` | 439819292 |
| 133 | padding | 0 |

So AAPL at 305.92 dollars with a confidence interval of 1 basis point of the
price, published 37 days ago.

**The verification level is an enum, and its encoding moves everything after it.**
In the crate `VerificationLevel` is written `Partial { num_signatures: u8 }` first
and `Full` second, so borsh gives `Partial` the tag byte `0` followed by one more
byte, and `Full` the tag byte `1` with nothing after it. `Full` means two thirds
of the Wormhole guardians signed. That is why Pangu proves the tag is `1` before
it reads the feed id: on a `Partial` update every offset after byte 40 shifts by
one, and reading the feed id first would be reading the wrong bytes. A `Partial`
update, or any tag that is neither, is refused outright.

## The crate, tried first and kept

The price band build had to parse the oracle account by hand because that vendor's crate would
not build next to anchor-lang 1.2.0. Pyth's does. A scratch crate depending on
`anchor-lang =1.2.0` and `pyth-solana-receiver-sdk =2.0.0`, with a module that
really calls `get_price_no_older_than_with_custom_verification_level`, built for
SBPF v0 on the first attempt in 19.78 seconds. Added to the real program it built
too, and the binary came out at 356,200 bytes against 368,600 for the Switchboard
build, so the price band got smaller rather than bigger.

So there are no byte offsets in `price.rs` at all. Pyth's crate carries the
account type, the discriminator check, the feed id check, the verification level
check, the staleness check and both program ids. Pangu adds the four rules Pyth
leaves to the caller: a price published in the future, a price that is not above
zero, a confidence interval too wide to mean anything, and the band itself.

## What the hook proves on every banded buy

The price account is at the one address Pangu's shard id and this sale's feed id
can produce under Pyth's price feed program, and it is owned by Pyth's receiver
program. Only that program can write an account it owns, and it verifies Wormhole
guardian signatures before it does. That pair is what makes the bytes worth
reading at all, and it is checked in `execute.rs::require_price_in_band` before
any byte is touched.

Then `price.rs::read_banded_price` judges the contents, in this order:

1. The bytes are a `PriceUpdateV2`. Pyth's own `try_deserialize` checks the
   account discriminator.
2. Two thirds of the Wormhole guardians signed it. `Partial` is refused, and so
   is any tag that is neither, which matters because a `Partial` update carries
   an extra byte and every offset after it moves.
3. The feed id inside it is this sale's feed, so a real price for another stock
   cannot stand in.
4. It is not older than the sale allows, counted in seconds against the chain
   clock. Checks 2 to 4 are Pyth's own `get_price_no_older_than_with_custom_verification_level`.
5. It was not published in the future, beyond a minute of slack for the gap
   between Pyth's publishers and Solana's clock.
6. The price is above zero.
7. Pyth's confidence interval is no wider than the sale accepts, in basis points
   of the price itself, rounded up.
8. Only then the curve price after this buy, read from the pool DBC has just
   written, against the ceiling.

**The market clock is gone, and that is the honest answer.** The Switchboard band
carried a second feed saying when the stock last traded. A Pyth price feed account
has no such field and no session flag. What it has is a publish time, and Pyth
stops publishing an equity outside its trading sessions, so the account simply
stops moving and ages out. From inside the program a shut market and a broken
publisher look identical, so the band treats them the same way: no fresh price,
no buy. `MarketClosed` was removed rather than faked, because an error that
claimed to tell the two apart would be a lie.

## The rules account, and what could not move

`SaleRules` is 354 bytes of payload, down from 419, because the queue, the second
feed id, the slot-based age and the oracle quorum all went. Three offsets were
frozen before this work started and are still where they were, because the hook's
extra accounts are derived by reading those exact bytes: `credential` at byte 145,
`schema` at 177 and `price_account` at 209. The band's own fields follow:
`price_feed_id` at 241, `price_shard` at 273, `band_bps` at 275,
`max_price_age_secs` at 277 and `max_conf_bps` at 281. A Rust assertion pins the
total size and a test in `tests/band.ts` reads those offsets back off real bytes,
so a silent reshuffle fails the build rather than deriving a wrong address.

No sale exists on mainnet and the earlier devnet sales are abandoned, so changing
the tail cost nothing.

## A banded buy

Whole transactions on the local fork, sent through DBC's own
`swap2WithTransferHook`. The hook is one part of what these numbers cover.

| Action | Bytes of 1232 | Accounts | Compute units |
| --- | --- | --- | --- |
| Buy, no band, issuer list | 910 | 22 | 113,481 |
| Buy, band, open sale | 922 | 23 | 120,800 to 126,481 |
| Sell, band, open sale | 912 | 23 | 91,059 |
| Create pool plus banded `create_sale` | 936 to 938 | 16 | 96,063 to 108,115 |
| Refresh the price on devnet | 1,606 over two transactions | 10 and 7 | 84,592 then 47,209 |

In plain English: a buy through a banded sale costs about 121 thousand compute
units and 922 bytes of a 1232 byte transaction, which is roughly 7 thousand units
and 12 bytes more than the same buy with no band. Selling is cheaper than buying,
about 91 thousand units, because the sell path reads no price at all.

The band adds two accounts to a buy, the DBC pool and the Pyth price account,
which is 64 bytes over an unbanded buy. The Switchboard band it replaces added
four accounts and 128 bytes, so the transaction got smaller as well as simpler.

A banded buy in a credential sale is the worst case a sale can carry. Measured in
the litesvm suite, where the two can be isolated: **80,966** compute units against
**66,365** for a banded buy with no credential, so the attestation costs about
**14,600 units** more. Those litesvm numbers move by thousands between runs
depending on whether the program is already cached, so they are good for a
difference and not for an absolute.

## Does a banded sale still open in one transaction?

Yes, comfortably. Create pool plus banded `create_sale` measured **938 bytes,
294 to spare**. The Switchboard version needed 1,035 bytes because it also passed
the queue account for its owner to be checked; Pyth needs no such account, so the
whole thing got 97 bytes shorter. The credential mode adds the credential and the
schema accounts, 64 bytes, for about **1,002 bytes and 230 to spare**.

## The refresh, proven twice on devnet

Anyone can refresh a price feed account: the payer is not a seed, so the address
never moves. Pangu refreshes shard 7700, which nobody else is feeding.

```
price account: 9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb
feed         : Equity.US.AAPL/USD
feed id      : 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688
run 1  AAPL 339.65983  publish time 1790077809  confidence 1 basis point
       mgzGBrJ5PW3EMp7vBJhtNZLzRPmDwZoGswtwDU4wyEzdMP4YpV9SYow8fGBJYgTYNZX9Adh2w9Y2o2dFkBLmRRa
       2FY7DLxLCBjpQjcXzD4CuWBRCGBqMfjZJaCSgbmV1NRSTZpv1AfTdLoe3xJY43v2vPabrcUWxeTrZnaajxsKVdsh
run 2  AAPL 339.66998  publish time 1790077830  confidence 2 basis points
       74M4N8jMVvfkkofMNUEwSUGvxfshyzixwahvEnuYyGJx1tcHN6uLftsfavwVwLkgomrxCdRiHJWSEaBRLDFhtGS
       Lzig36tAHJTJ8dYxBaJH97znKY39EJ5e3T92EqTNQfbdTQYVqhgvDE9nEQ7zvEmrd8TdVx58VfqgVHMQnkvSint
run 3  AAPL 339.96052  publish time 1790078987  confidence 3 basis points
       4c4dQa2NNmydF4tDsCrZEmZ8FyK1ksRxFN1teiSEn4qdfUDMgivpegfBeg1LMpvAxMJkTBWdYcGnfoPBqX6tNwLD
       5Qdr2E1kRMTUws1NstL9hZ8ZipEXc1zBPs38Yy71TqkCoeyNt2ePezn9oeJ8ZzwsR6xrpG44vSZpWVfehEJnCghG
```

Same address every time, a fresher publish time and a different price each time,
and the account comes back 134 bytes, fully verified, owned by the receiver.

**It takes two transactions, not one.** The guardian-signed update has to be
posted into an encoded VAA account before the price feed account can be written
from it, and the pair does not fit in 1232 bytes. So the refresh cannot ride along
with the buy. The app sends the refresh first and the buy straight after, inside
the age the sale allows.

**Cost, and a mistake worth recording.** Runs 1 and 2 spent 3,729,420 and
2,398,460 lamports. That looked like rent for the price feed account, but the
account is created once and run 2 should have been nearly free. The cause was
`closeUpdateAccounts: false` in `feeds/refresh.ts`: it left the encoded VAA
account behind on every refresh, about 0.0024 SOL of rent thrown away each time.
Setting it to `true` closes the VAA account and nothing else, because the price
feed account is a program address and not one of them. Run 3, after the fix, spent
**35,180 lamports**, which is 68 times cheaper. That is the recurring cost of a
refresh: two signatures and the fees, and no rent at all.

## The fork test's own limits

`fork-tests/life-band.ts` runs first in `scripts/wsl/fork-test.sh`, on purpose. A
local validator can only be handed accounts at genesis, so the price accounts are
written before the chain starts and never rewritten: Pyth's receiver program is
not on a local chain, and its accounts are program addresses only Pyth's price
feed program could produce. Their publish time is set just before genesis, and
Pyth's freshness rule counts seconds against the chain clock, so they age on their
own as the run goes along. The ageing sale allows 240 seconds and shuts partway
through; the other two allow an hour and stay open.

The fork writes its prices at exponent -8, which is the exponent Pyth really uses
for its tokenised feeds. -5, the US equity exponent, would round this curve's
prices to two significant figures, because the test curve opens at a fifth of a
cent a token.

Three pools are used where one would read better, on three Pyth shards, because a
sale's stock price cannot be moved once the chain is running. All three run the
same template and the same buy size, and the test asserts the second has reached
at least the first's curve price before sending the buy the first one refused.

What the fork does not prove: Pyth's receiver program is not on a local chain, so
nothing there checks that the bytes in those accounts came from the Wormhole
guardians. That is proven separately on devnet, where the account was written by
the real program and its bytes are read back through Pangu's own
`price::read_banded_price` in the Rust test
`the_live_devnet_price_reads_through_this_code`, against the real feed id and the
real derived address.

## Two things outside the planned file list

`packages/program/package.json` and its lockfile had to change: they named the
Switchboard packages, which the move's own acceptance grep refuses. They now
name `@pythnetwork/pyth-solana-receiver` 0.16.0 and `@coral-xyz/anchor` 0.29.0,
which that package requires.

That combination needed one `overrides` entry. `@pythnetwork/solana-utils` pulls
`jito-ts`, which carries its own old `@solana/web3.js` 1.77.4, and that version
imports `rpc-websockets/dist/lib/client`, a path `rpc-websockets` 9 no longer
exports. Pinning `jito-ts` to the hoisted `@solana/web3.js` 1.98.4 fixes it.
Nothing here calls jito-ts; it comes along for Jito bundle support the refresh
script never uses.
