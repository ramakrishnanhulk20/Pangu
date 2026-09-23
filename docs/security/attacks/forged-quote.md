# Can anyone write a forged stock price into the account a Pangu sale reads?

The forged-quote hardening. This file is written as the work runs, so an interrupted run
loses nothing. Each attempt is recorded with what was sent and what came back.

Status: attack done and refused on devnet, both defence checks implemented and
proven in the Rust and litesvm suites. The end to end fork run of these checks is
coded (a writer program at the quote address patches each quote with the live slot
hash) but could not be executed to green in this session: the local validator does
not stay alive across the harness's separate tool calls, and a foreground run that
keeps it alive has its output discarded. The checks themselves are proven by the
devnet attack, 21 Rust tests including the live devnet quote and queue signer
check, and 100 litesvm tests including every new refusal path.

## The verdict, in one line

No forgery landed. The deployed quote program refuses a quote signed by a key
that is not a queue oracle, a quote whose bytes were altered after signing, a
genuine quote for a different feed aimed at our address, and a genuine quote
replayed once it is old. Every attempt left the account unchanged and cost 0
lamports, because each was refused at simulation and never sent. So the price band
build's claim was right: the owner check plus the canonical address is enough to trust the
bytes, and the two checks the forged-quote hardening adds in Part B are defence in depth against a
future upgrade of the quote program, not the only thing standing between a buyer
and a forged price.

## The attempts, run on devnet on 21 Sep 2026

Target account `7uPLLyB29H9sATzjKi1DKWgqD2YXrjp8YS8QpEZi5b1Z`, our key
`Fwi8ejZ8kqF8PwcxssHFqJQZmVrkmBfoaXV5CTjqp5L`, which is not an oracle. Reproduce
with `bash scripts/wsl/feeds.sh forge`.

### (i) our key signs a well formed quote with a false price 1.00, oracle index 0
REFUSED. The quote program reaches its oracle signing key check and the assertion
fails: the key that signed is not the key the queue lists for oracle 0.
```
InstructionError [1, ProgramFailedToComplete]
panicked at src/on_demand/oracle_quote/quote_verifier.rs:535:13:
assertion failed: check_p64_eq(actual_oracle_key, expected_oracle_key)
```
Account UNCHANGED.

### (ii) a real oracle signature with the price bytes altered after signing
REFUSED. The native Ed25519 precompile at instruction 0 rejects the signature,
because the signed message no longer matches the altered bytes. The quote program
never even runs.
```
InstructionError [0, {"Custom": 2}]
```
Account UNCHANGED.

### (iii) a genuine, correctly signed quote for a different feed id, pushed at our address
REFUSED. The quote program re-derives the canonical account from the feed ids in
the signed message and it does not match the account it was told to write.
```
InstructionError [1, InvalidArgument]
Program log: Feed ID mismatch
```
Account UNCHANGED.

### (iv) the same genuine quote replayed after it aged out
REFUSED. Simulated fresh first, it passed, which proves the genuine path works.
Held until the signed slot was 576 slots old and replayed, it was refused. The
deployed program's own soft age limit is 150 slots, so it is refused for age
before the slot hash lookup is even reached.
```
InstructionError [1, ProgramFailedToComplete]
panicked at src/instructions/verified_update.rs:37:14:
Failed to verify oracle quote: Quote is too old:
recent_slot=501982602, current_slot=501983179, max_age=150
```
Account UNCHANGED.

## What the attack does not cover

It attacks the write path of the deployed quote program as it stands today. It
does not and cannot test a future upgraded quote program, which is exactly the
gap Part B closes by having Pangu re-check the signing keys and the slot hash
itself. It also does not attack the queue account or the SlotHashes sysvar, which
are Solana and Switchboard infrastructure outside Pangu's trust boundary.

## The target

The production AAPL quote account on devnet,
`7uPLLyB29H9sATzjKi1DKWgqD2YXrjp8YS8QpEZi5b1Z`, which is the one address
Switchboard's quote program can hold a quote for this queue and this pair of feed
ids at. A banded Pangu sale reads that account and nothing else for the stock
price.

## Notes for Part B (the two checks)

Queue layout, from the `switchboard-on-demand` 0.13.0 crate, `on_demand/accounts/queue.rs`,
confirmed against the real devnet queue bytes in a Rust test:
- The account is 6280 bytes: an 8 byte anchor discriminator then a 6272 byte
  `QueueAccountData`.
- `ed25519_oracle_signing_keys: [Pubkey; 30]` starts at struct offset 4192, so
  account offset 4200. Each key is 32 bytes.
- The oracle index in a quote signature record maps straight into that array.
  `quote_verifier.rs::verify` reads `queue_data.ed25519_oracle_signing_keys[idx]`
  and compares it to the key that signed.

SlotHashes sysvar layout, confirmed against a running validator: an 8 byte little
endian count, then entries newest first, each a u64 slot then a 32 byte hash.

Fork limitation, established by running the validator: `solana-test-validator`
resume without `--reset` prints "--account argument ignored, ledger already
exists", so a quote cannot be reloaded after the chain is up. And a genesis
account can never contain its own chain's slot hash, because that hash depends on
genesis state which includes the account, a fixpoint no preimage satisfies. So the
fork test writes the quote at run time through a tiny writer program deployed at
the quote program's address, which reads the live slot hash and patches the
account. That program exists only on the fork; in production the address is the
real Switchboard quote program.

## Progress log

- Read the quote account layout in the crate (`quote_account.rs`, `feed_info.rs`),
  the trap in Switchboard's own SDK where its default Ed25519 instruction index
  panics the deployed quote program, the crate source
  (`quote_verifier.rs`, `queue.rs`, `sysvar/ed25519_sysvar.rs`), `price.rs`,
  `execute.rs`, `create_sale.rs`, `tests/band.ts`, `tests/quote.ts`,
  `fork-tests/band-accounts.ts` and the fork scripts.
- Step 0: `scripts/wsl/test.sh` now runs the Rust unit tests before the
  TypeScript suite. Both suites pass: 21 Rust tests and 100 TypeScript tests.
- Part B checks implemented in `price.rs` (`require_oracle_signers`,
  `require_slot_hash`, extended `read_quote`), wired into `execute.rs`, with the
  queue owner check in `create_sale.rs` and the SlotHashes sysvar published as the
  band's fourth extra account. New errors `PriceSignerNotAnOracle`,
  `PriceSlotHashMismatch`.
- The queue layout offset 4200 is confirmed: the live devnet quote's oracle index
  6 resolves to `queue.ed25519_oracle_signing_keys[6]`, the exact key that signed,
  proven in a Rust test over the real `feeds/live-queue.bin` bytes.
- Fork: a tiny writer program deployed at the quote program's address patches each
  quote at run time with the live slot hash, the only way to satisfy the slot hash
  check on a local chain.
- Confirmed the write path from the crate and the SDK. A refresh is a pair of
  instructions: a native Ed25519 precompile instruction that carries the oracle
  signatures and the signed message, then the quote program instruction that
  reads that Ed25519 instruction out of the instructions sysvar and writes the
  account. The quote program (`quote_verifier.rs::verify`) checks the signed slot
  hash against the SlotHashes sysvar and every signing key against the queue's
  `ed25519_oracle_signing_keys`, and re-derives the account address from the
  message's feed ids. The SDK builder `Ed25519InstructionUtils.buildEd25519Instruction`
  lets an attacker sign the message with any key, so the attack is buildable.
- Devnet wallet holds enough SOL. Forgeries are simulated first, so a rejected
  forgery costs nothing.
