# WO-3 price band: progress

Working notes so an interrupted run loses nothing. The finished write-up is
`price-band.md`, which carries all of this in its final form.

## Step 1a. Does switchboard-on-demand 0.13.0 build next to anchor-lang 1.2.0?

No. Three feature combinations were tried in a scratch copy of the workspace, each
with a module that really calls `QuoteVerifier`, built with `anchor build --arch v0`.

| Attempt | Features | Result |
|---|---|---|
| A | `["anchor", "devnet"]` | 28 errors. anchor-lang 1.2.0 makes `AnchorDeserialize` an alias of `borsh::BorshDeserialize`, so the crate's own `impl anchor_lang::AnchorDeserialize` collides with its own borsh impl on four types. It also expects `anchor_lang::solana_program`, which 1.2.0 no longer re-exports. |
| B | no defaults, `["anchor-lang", "solana-v3"]` | `getrandom v0.2.17` refuses the SBF target. |
| C | no defaults, `["solana-v3"]` | Same `getrandom` failure. |

Chosen path: parse the quote account by hand in `programs/pangu/src/price.rs`.

## Step 1b. Can the DBC pool be a hook extra account?

Yes, proven on the fork with a throwaway build. A real `swap2WithTransferHook`
passed with the pool in the transaction twice, and the hook read the post-swap price:

```
probe buy 1: 911 bytes, 123776 compute units, 22 accounts
hook saw 23499038395676116, pool holds 23499038395676116 after the buy
probe buy 2: 911 bytes, 101531 compute units, 22 accounts
hook saw 23956811861688569, pool holds 23956811861688569 after the buy
```

## Steps 2 to 10: all done

- Unit suite: `TEST-OK`, 92 passing, 31 of them in `tests/band.ts`.
- Rust maths and live-quote tests: 13 passing, `cargo test -p pangu --lib`.
- Fork suite: `FORK-TEST-OK`, 36 passing, including `fork-tests/life-band.ts`.
- Devnet: two refreshes of the production AAPL quote, same address, fresher slot,
  price moved, 0.0061 SOL spent in total.

```
quote account: 7uPLLyB29H9sATzjKi1DKWgqD2YXrjp8YS8QpEZi5b1Z
run 1  717 bytes  4276 CU  slot 501956141  AAPL 336.80
run 2  717 bytes   928 CU  slot 501956223  AAPL 336.44
```

Those live bytes are saved to `feeds/live-quote.bin` and read back through Pangu's
own `price::read_quote`, which is the devnet verification step 8 asks for. It
needed no program deploy and no extra SOL.
