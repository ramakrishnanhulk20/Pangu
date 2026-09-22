# Random sequences: 6,000 operations against the rules

Date: 21 September 2026.

The unit tests ask "does this one rule hold". This asks a harder question: over
thousands of buys, sells, transfers, approvals and revocations in an order nobody
chose, does anything drift? A second copy of the rules is written in plain
TypeScript in `packages/program/tests/random.ts`, it predicts what Pangu must do
with every operation before the operation is sent, and the chain is read back and
checked after every one. A disagreement means either the program or the model is
wrong, and either way somebody has to explain it.

Run it with the rest of the suite:

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/test.sh
```

## What was run

| | |
|---|---|
| Seeds | 101, 2027, 30011, 400009, 5000011 |
| Access modes | open (mode 0) and issuer list (mode 1), every seed run in both |
| Sequences | 10 |
| Operations per sequence | 600 |
| Total operations | 6,000 |
| Wallets per sequence | 8 |
| Token accounts per wallet | 3: an associated account, a second account carrying ImmutableOwner, and one without it |
| Per-wallet cap | drawn from the seed: 4,170, 3,117, 4,416, 1,187 and 1,370 raw units |
| Pool vault supply | 50,000,000 raw units |
| Run time | 56.5 seconds for all ten sequences, inside a 111 test suite that takes about a minute |

Three wallets are minted tokens before the sequence starts (4,000, 2,500 and
3,000). A wallet that only ever buys holds exactly what its record says, so
without holdings that the sale never sold, the sell path's floor at zero is
unreachable and a whole branch of the program would go untested.

## The mix that came out

Operations are drawn by weight, so the counts below are what 6,000 draws actually
produced rather than a plan.

| Operation | Count |
|---|---|
| Sell back to the vault, a random amount | 1,329 |
| Buy into the wallet's associated account | 1,142 |
| Buy into the wallet's second account | 598 |
| Approve a wallet | 542 |
| Transfer to another wallet | 539 |
| Open a buyer record | 463 |
| Buy into an account whose owner can still change | 418 |
| Transfer between two accounts of one wallet | 359 |
| Revoke a wallet | 334 |
| Call `execute` directly, outside any transfer | 276 |

Amounts are drawn from 1, the exact room left under the cap, one unit past that
room, a random amount inside the cap, the full balance of an account, one unit
more than that balance, and values a few units below the u64 ceiling.

What the program did with them:

| Result | Count |
|---|---|
| Allowed | 2,222 |
| Refused by Token-2022 before the hook, insufficient funds | 1,148 |
| `WalletToWalletDuringSale` | 581 |
| `OverCap` | 426 |
| `InvalidAccessMode` | 403 |
| `ReceivingAccountOwnerCanChange` | 383 |
| `NotApproved` | 296 |
| `NotTransferring` | 276 |
| `BuyerRecordMissing` | 222 |
| `AccountNotInitialized` | 43 |

Every one of those was named by the model before the transaction was sent, error
code included. The 1,148 insufficient funds are the huge amounts and the
one-more-than-you-hold amounts: the token program moves the tokens before it calls
the hook, so those never reach Pangu at all, and the model has to know that too.

## Checked after every single operation

Not at the end of a sequence. After each of the 6,000 steps, against the chain:

1. The result matched the model's prediction, including the exact error code on a
   refusal.
2. Every wallet's record is at or under the cap.
3. The sum of all eight records equals `total_net_bought` in the sale rules.
4. `buyers` equals the number of records above zero.
5. A refused operation changed no record, no counter and no token balance. The
   whole snapshot is compared against the one before it.
6. Tokens are conserved: the 24 token accounts plus the pool vault always add up
   to the amount minted, so nothing is created or destroyed.
7. Every record's net bought and approval flag, and every token balance, equals
   what the model says it should be.

## The exit, checked separately

Trapping a holder is the worst failure this program could have, so it gets its own
property. At 25 points in every sequence, picked from the seed, every wallet that
holds anything is offered a sell of its entire balance to the pool vault and the
runtime is asked whether it would go through. The answer is thrown away with
`simulateTransaction`, so the sequence carries on from exactly where it was.

250 checkpoints, 1,330 full-balance sells simulated, every one of them would have
gone through: with no record, with a record of zero, with a revoked approval, from
an associated account, and from an account whose owner could still be handed over.

## Which promises this exercises

From `docs/security/threat-model.md` section C: C3 (the cap holds per wallet
however many token accounts it has), C4 (no wallet to wallet movement during the
sale), C5 (a holder can always sell back), C6 (tokens leave the vault only to a
currently approved wallet when the list is in force), C10 (a sell larger than the
record floors at zero and never underflows), C13 (tokens leave the vault only into
an account whose owner can never change), and C1 (a direct call to `execute`
changes nothing).

## Replaying a failure

Each sequence prints its seed, its cap and a one word digest of its step list. On
a failure the suite prints the seed, the step number, the whole step list up to
that point, and the command to replay it:

```
PANGU_RANDOM_SEEDS=<seed> PANGU_RANDOM_OPS=<count>
```

A separate test proves the replay is real: it rebuilds each seed's step list from
the model alone, with no chain involved, and checks the digest against the one the
chain run produced. Ten sequences, ten matching digests.

## What this does NOT cover

- Verifier credential sales (mode 2) and price banded sales. Both need accounts
  from outside the program, an attestation and a Switchboard quote, which a random
  sequence cannot produce. They are covered in `tests/credential.ts`,
  `tests/band.ts` and the fork tests against live mainnet accounts.
- Transfers of zero tokens. Whether Token-2022 calls a hook at all on a zero
  amount is the token program's decision, not Pangu's, and this suite is about
  Pangu's decision.
- `MathOverflow` on the counters. A buy can only overflow a u64 record if the pool
  vault holds near u64 tokens, and the token program refuses those amounts long
  before the hook sees them, so no sequence can reach it. The unit tests cover the
  checked arithmetic.
- Graduation, two sales at once, closing a record, and the price a seller gets.
  Pangu never touches money, only the count.
- Racing. One transaction runs at a time here. Two transfers landing in the same
  slot are not simulated.
- Addresses. The same seed replays the same operation sequence, but the mint and
  the token accounts come from the runtime's own random keypairs, so the addresses
  differ between runs. Nothing in the sequence depends on an address.
- One person holding many wallets. That is a named non-goal in the threat model,
  not something a sequence could find.
