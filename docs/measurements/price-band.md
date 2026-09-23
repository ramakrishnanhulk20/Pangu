# The price band: what it costs and what it proves

Measured on 21 Sep 2026 against Meteora's real Dynamic Bonding Curve, cloned from
mainnet into a local validator, and against Switchboard's real devnet oracles.
Every number below came out of a transaction that ran.

## Which verification path the hook uses, and why

By hand, in `programs/pangu/src/price.rs`.

`switchboard-on-demand` 0.13.0 does not compile next to `anchor-lang` 1.2.0.
Three feature combinations were tried in a scratch copy of the workspace, each
with a module that really calls `QuoteVerifier`, built for SBPF v0:

| Attempt | Features | What happened |
|---|---|---|
| A | `["anchor", "devnet"]` | 28 errors. anchor-lang 1.2.0 makes `AnchorDeserialize` an alias of `borsh::BorshDeserialize`, so the crate's own `impl anchor_lang::AnchorDeserialize` collides with its own borsh impl on four of its types. It also expects `anchor_lang::solana_program`, which anchor-lang 1.2.0 no longer re-exports. |
| B | no defaults, `["anchor-lang", "solana-v3"]` | `getrandom v0.2.17`, pulled in by the Solana 3.x crates, refuses the SBF target. |
| C | no defaults, `["solana-v3"]` | Same `getrandom` failure. |

So the account is parsed from the layout in `docs/RD-SWITCHBOARD-SPIKE.md` Q4,
with a bounds check on every slice.

**What the hook proves.** The quote account is at the one address the queue and
this sale's two feed ids can produce under Switchboard's quote program, and it is
owned by that program. Only that program can write an account it owns, and it
verifies the oracle signatures through Solana's Ed25519 precompile before it
writes. The hook then reads the slot the quote records and refuses anything older
than the sale allows or signed for a slot the chain has not reached, reads both
feeds by id and never by position, and refuses a quote carrying fewer signatures
than the sale's quorum or than either feed's own minimum.

On top of that, and this is what the forged-quote hardening added, the hook now does by
hand the two checks Switchboard's own `QuoteVerifier` does, which the price band
build had left to the quote program:

- **Every signing key is an oracle.** For each signature in the quote, the public
  key that signed must equal the key the queue account lists for the oracle index
  the signature names. Indexes must be in range and must not repeat, so two
  signatures from one oracle can never pass as a quorum of two. The queue account
  must be owned by Switchboard's On-Demand program and be exactly 6280 bytes. This
  is `price::require_oracle_signers`.
- **The signed slot hash is real.** The slot hash the oracles signed must equal
  the SlotHashes sysvar's entry for the slot the quote names. A slot the sysvar
  cannot show is refused as stale, a slot whose hash differs is refused outright.
  This is `price::require_slot_hash`, reading the sysvar published as the band's
  fourth extra account.

**Why this was worth doing, proven not reasoned.** Before adding these, the four
forgery attempts in `docs/security/attacks/forged-quote.md` were run against the
real quote program on devnet: a quote signed by a key that is not an oracle, a
real quote with its price bytes altered, a genuine quote for another feed aimed at
our address, and a genuine quote replayed once old. All four were refused and none
changed the account. So the owner check plus the canonical address was already
enough against the program as it runs today. The two checks here are defence in
depth: if Switchboard's quote program were ever upgraded to write an unverified
quote, or made to write a well shaped record for a slot whose hash does not match,
the hook would still refuse it. The live devnet quote still verifies through the
signer check against the real devnet queue bytes, proven in the Rust test
`the_live_devnet_quote_signers_are_queue_oracles`.

## A banded buy

Whole transactions on the local fork, sent through DBC's own
`swap2WithTransferHook`. The hook is one part of what these numbers cover.

The numbers below for a banded buy are the price band build's fork measurements
plus the exact change the forged-quote hardening makes: one more account, the SlotHashes sysvar, at 32 bytes, and the
two extra checks. The fork whole transaction could not be re-run in the
forged-quote hardening session because the local validator would not stay alive across the harness's tool
calls, so the fork compute is the price band build's figure plus the litesvm delta for the two
checks, and it is marked as such.

| Action | Bytes of 1232 | Accounts | Compute units |
|---|---|---|---|
| Buy, no band, issuer list | 910 | 22 | 115,175 |
| Buy, band, open sale | 987 | 25 | about 129,600 to 135,000 (see below) |
| Sell, band, open sale | 945 | 24 | 95,479 |
| Create pool plus banded `create_sale` | 1,003 | 16 | 92,037 to 99,486 |
| Refresh the quote, first write | 717 | 10 | 4,276 |
| Refresh the quote, later writes | 717 | 10 | 928 |

The band now adds four accounts to a buy: the DBC pool, the Switchboard quote
account, its queue, and the SlotHashes sysvar. That is 128 bytes over an unbanded
buy. The extra SlotHashes account the forged-quote hardening adds is 32 of those bytes and one account.

The two new checks were measured in the litesvm suite, where they can be isolated.
A banded buy with no credential went from 60,581 units (price band build) to **65,901**, so the
signer and slot hash checks together cost about **5,300 units**. That is why the
fork banded buy, measured at 124,282 to 129,579 in the price band build, is given above as about
129,600 to 135,000. The sell path reads none of the band accounts, so it is
unchanged.

A banded buy in a credential sale, the worst case a sale can carry, is not on the
fork. Its size is exact arithmetic on the measured one: the credential mode adds
three more accounts, so 987 + 96 = **1,083 bytes**, 149 to spare. Its compute cost
was measured in the litesvm suite: **82,914** units against 65,901 for a banded buy
with no credential, so about **17,000 units more**. Those litesvm numbers move by
ten thousand units between runs depending on whether the program is already cached,
so they are good for a difference and not for an absolute.

## Does a banded sale still open in one transaction?

Yes. Create pool plus `create_sale` with a band measured 1,003 bytes in the price band
build. The forged-quote hardening passes the queue account to `create_sale` so its owner can be proven once at
creation, which is one more account, 32 bytes, for **1,035 bytes and 197 to
spare**. The credential mode adds the credential and the schema accounts to
`create_sale`, 64 bytes, for about **1,099 bytes and 133 to spare**.

If a future change ever pushes it past 1,232 bytes, the fix is to send
`create_sale` in its own transaction immediately after the pool rather than with
it, or to put the fixed addresses in an address lookup table. The sale is still
safe either way: `create_sale` proves the signer is the pool creator, so nobody
can get in between.

## The refresh

One transaction carries both feeds into the account. It cannot ride with the buy:
717 bytes of refresh plus a 955 byte swap is past the limit. The app sends the
refresh first and the buy straight after, inside the age the sale allows.

- **717 bytes**, ten static accounts, one oracle signature.
- **14,000 lamports** a refresh: Solana charges its 5,000 lamport signature fee for
  the oracle's signature as well as the payer's, plus the priority fee.
- **6,055,360 lamports** of rent, once, paid by whoever sends the first refresh for
  a set of feed ids, and never again by anyone.
- **4,276 compute units** on the write that creates the account, **928** after.

Two devnet runs, the production AAPL feeds:

```
quote account: 7uPLLyB29H9sATzjKi1DKWgqD2YXrjp8YS8QpEZi5b1Z
price feed   : 0xdb4fa77aa3c4e909923c4767ae01f5d2a3d0c7138c953db372639122bdeceb3d
clock feed   : 0x15ff868ad9e4b29e63e75b68a527df7d8f2fa83782938b233d03ea5e259d08c5
run 1  slot 501956141  AAPL 336.80  last trade 3 seconds earlier
run 2  slot 501956223  AAPL 336.44  last trade 17 seconds earlier
```

Same address both times, a fresher slot and a different price the second time.
0.0061 SOL in total, rent included.

## The fork test's own limits

`fork-tests/life-band.ts` runs first in `scripts/wsl/fork-test.sh`, on purpose. A
local validator can only be handed accounts at genesis, so the quote accounts are
written before the chain starts, signed for slot zero, and never rewritten. A sale
may accept a quote at most 400 slots old, which is about 160 seconds of a local
validator, so the band work has to happen while the chain is young. The market
shutting and the quote going stale are then real ageing rather than a rewrite: the
test waits for them.

The same limit is why the higher stock price is shown on a second pool rather than
by moving the first one's price. Both pools run the same template and the same buy
size, and the test asserts the second has reached at least the first's curve price
before it sends the buy the first one refused.

What the fork does not prove: Switchboard's quote program is not on a local chain,
so nothing there checks that the bytes in those accounts came from an oracle. That
is proven separately on devnet, where the account was written by the real program
and its bytes are read back through Pangu's own `price::read_quote` in
`price.rs`, against the real feed ids and the real canonical address.
