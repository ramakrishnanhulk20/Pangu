# Credential mode: what it costs and what a verifier has to do

Date: 21 September 2026.

Pangu's third access mode lets an issuer say "only wallets that a named verifier
has attested may buy". The check is made from on-chain accounts alone, with no
call into the attestation service and no server anywhere.

Everything below was measured, not estimated. Two rigs:

- Unit tests, `scripts/wsl/test.sh`: a plain Token-2022 transfer straight into
  the hook, so the number is Pangu's own cost with nothing else in it.
- Fork tests, `scripts/wsl/fork-test.sh`: a local validator holding Meteora's
  Dynamic Bonding Curve, DAMM v2 and the Solana Attestation Service, all copied
  from mainnet. A buy there is a real DBC swap, so the number includes DBC's
  curve and fee maths as well as the hook.

Mode 1 numbers are from the same runs, next to them, so the comparison is like
for like. The earlier mode 1 table is in `fork-test.md`.

## The hook's own cost, measured without a swap around it

| Action | Mode 0 or 1 | Mode 2 | Difference |
|---|---|---|---|
| `create_sale` | 21,614 compute units | 30,327 | plus 8,713 |
| Buy through the hook | 48,137 | 72,153 | plus 24,016 |
| Sell through the hook | 55,612 | 68,210 | plus 12,598 |

The buy costs more because the hook derives the attestation address itself
instead of trusting the account it was handed, reads the attestation, and then
walks the credential's current list of authorized signers. Deriving an address
is the expensive part: it is a hash loop, and it is the price of the invariant
that a look-alike account can never approve anyone.

The sell costs more even though Pangu reads nothing extra on a sell. That
12,598 belongs to Token-2022, not to Pangu: a credential-mode sale publishes six
extra accounts instead of three, and the token program works all six out for
itself on every transfer, including the attestation address. The hook's sell
path is the same code it always was.

## Inside a real DBC swap

| Action | Mode 1 | Mode 2 |
|---|---|---|
| Create the pool and the sale rules, one transaction | 930 bytes, 94,316 units, 16 accounts | 998 bytes, 92,688 units, 18 accounts |
| A buy | 910 bytes, 110,316 to 132,811 units, 22 accounts | 1,009 bytes, 130,772 to 156,175 units, 25 accounts |
| A sell | 878 bytes, 102,984 units, 22 accounts | 977 bytes, 97,014 to 118,014 units, 25 accounts |

The compute spread inside each column is DBC's, not ours. The curve charges
different amounts of work depending on where on it the trade lands, and the same
spread shows in mode 1.

### Does it still fit one transaction?

Yes. The pool and the rules go up together in one transaction of **998 bytes**
against the 1,232 byte limit: **234 bytes to spare**. That matters more than it
looks. The rules account and the hook's account list are both derived from the
mint address, which is public the moment the pool transaction is seen, so they
have to be created in the same transaction that creates the pool or someone else
could set the rules for our sale.

Mode 2 adds 68 bytes to that transaction: two accounts, the credential and the
schema, which `create_sale` proves are real before it will store them.

A buy is 1,009 bytes with 223 to spare, and a sell 977 bytes with 255 to spare.
Three more accounts ride along on every transfer: the attestation service, the
credential, and the buyer's attestation.

Compute headroom is wide either way. A buy of about 156,000 units at the worst
point measured sits against a 1.4 million unit ceiling.

## What a verifier has to do for Pangu to find their attestations

One thing, and it is not optional.

**Issue the attestation with the subject's wallet address as the `nonce`.**

An attestation's address is derived from the credential, the schema and the
nonce. The attestation service does not require the nonce to be the wallet the
attestation is about: it can be a random value, and the reference tooling only
uses the wallet by convention (`program/src/processor/create_attestation.rs` and
`examples/rust/attestation-flow-guide/standard-demo` in the Solana Attestation
Service repo). But a transfer hook has no
index to search. It has one shot at deriving the address of the account it needs
from what it already knows, which is this sale's credential, this sale's schema,
and the wallet that is receiving the tokens. If the nonce is anything else,
Pangu cannot find the attestation and the buy is refused.

So the requirement on any credential Pangu accepts, whether it is a live issuer
such as Sumsub or Civic or the issuer's own desk:

1. `nonce` equals the subject's wallet pubkey.
2. The attestation is a plain one, not a tokenized one. Pangu reads the account
   the service writes; tokenization adds a token but does not change that
   account, so a tokenized attestation also works, but it is not needed and it
   costs the verifier more rent.
3. The schema is not paused. `create_sale` refuses to open a sale against a
   paused schema, because that is the verifier saying "stop issuing against
   this" and a sale nobody can join is worse than no sale.
4. Expiry is either a real future timestamp in Unix seconds or exactly zero,
   which the service defines as never expiring. Pangu handles both. Their own
   example code does not: it compares straight against the clock, which reads
   zero as expired in 1970.
5. To revoke, close the attestation. That is the only revocation the service
   has, and it is what Pangu sees: the account is simply gone.
6. To retire a signing key, take it off the credential's authorized signer list.
   Pangu reads that list on every buy, so the key's old approvals stop working
   in the same slot. Nobody has to hunt down the attestations it issued.

Point 6 is the part that is Pangu's own, not the service's. The service checks
who signed an attestation once, on the day it is issued, and never looks again.
Its own documentation and example code have no way to ask "is this still signed
by someone we trust". Proven in the fork test, step i: a second signer issues a
valid attestation, buyer B buys with it, the verifier removes that signer from
the credential and touches nothing else, and B's next buy is refused with
`CredentialSignerNotAuthorized`.

A limit worth naming: Pangu reads at most 64 authorized signers off a
credential. A credential carrying more is refused rather than walked, so the
cost of a buy stays bounded. That refusal only ever blocks buys. Selling back to
the pool reads no attestation account at all.

## One finding that changed the design

The credential account is named in the hook's published account list as a fixed
address rather than as a pointer into the rules account.

The account resolution library has a way to say "this account's address is the
32 bytes at offset 145 of the account at index 5" (`PubkeyData::AccountData`,
present in `spl-tlv-account-resolution` 0.11.4). The Token-2022 build that the
unit-test runtime loads does not understand it: resolution fails with
`InvalidAccountData` before the hook is ever entered. That runtime's Token-2022
is 535,256 bytes against mainnet's 1,382,016, so it is an older build, and a
hook that only works on the newest token program is a fragile hook.

Writing the credential in as a fixed address is simpler, cheaper and works
everywhere, and it gives up nothing: the same `create_sale` call writes the
credential into the rules and into the account list from one argument, and the
hook still checks the account it is handed against the rules before reading it.

The attestation address itself is still derived from the rules at transfer time,
reading `credential` at byte 145 and `schema` at byte 177. That mechanism is old
and every Token-2022 build understands it. It does mean those two offsets are
frozen for any sale that already exists, so `tests/credential.ts` asserts them
against real account bytes and the program pins the whole account's size at
compile time.
