# The SDK side of the code review fixes

The SDK review fixes, 22 Sep 2026. Five changes to `pangu-sdk` so the package says
the same thing the program now says, plus one reader fix found by the scripts
package. Every offset and code below was read out of a source file or the
regenerated IDL, not remembered.

## 1. The new interface, and the error table

`npm run sync-idl` copied `packages/program/target/idl/pangu.json` into
`packages/sdk/src/idl/pangu.json`. The package builds its error table straight
out of that file, so the codes moved on their own. What moved:

| Error | Code before | Code now |
|---|---|---|
| `RulesNotInitialized`, `WrongRulesAccount` | 6003, 6004 | gone |
| `BuyerRecordMissing` | 6006 | 6004 |
| `OverCap` | 6011 | 6009 |
| `PriceOutsideBand` | 6015 | 6013 |
| `MintAuthorityStillSet` | none | 6021 |
| `WrongLaunchTemplate` | none | 6022 |
| `FeesNotInQuoteToken` | none | 6023 |
| `MathOverflow`, the last one | 6028 | 6029 |

Thirty errors now, twenty nine before. Anything holding an old copy of the IDL
reads 6011 as `OverCap` when the program means `PriceStale`, which is why the
copy is checked at build time and the two tests that name a raw code were moved
to `0x1779`.

Three sentences were written for the three new names and one was rewritten:
`SaleStillRunning` now says the record still counts tokens, because a record
holding nothing closes at any time.

## 2. The launch template is passed in every mode

`create_sale` reads the fee mode off the pool's template before it will open a
sale at all (`instructions/create_sale.rs`, the `template` block), so
`dbc_config` is no longer an optional account. In the package `dbcConfig` moved
from an optional field of `CreateSaleInput` to a required one, the account is
always passed rather than filled with Anchor's "not passed" marker, and
`openSaleTransaction` hands over the template it already loaded. `quoteMint`
stays band only, because only a banded sale stores the paying token's decimals.

The account order is still walked out of the IDL by
`test/instructions.test.ts`, including the flags, so a reordered account in the
program fails that file rather than passing quietly.

## 3. The template refuses a token that can still be minted

`create_sale` refuses a mint whose mint authority is still set
(`MintAuthorityStillSet`), and DBC decides that at pool creation from the
template's token authority option. So the template builder now fills in
`tokenAuthorityOption` as `CreatorUpdateAuthority` when the caller leaves it
out, and refuses an option that keeps the mint authority alive.

The question asked is Meteora's own `hasMintAuthority` from
`@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12, which returns true for exactly
`CreatorUpdateAndMintAuthority` and `PartnerUpdateAndMintAuthority`. Asking
their predicate rather than keeping a list of option names means an option they
add later is judged by what it does to the mint authority. `Immutable` and
`PartnerUpdateAuthority` also leave no mint authority, so an issuer who asks for
one of those keeps it. What this does not cover: who holds the update authority,
which only changes the token's metadata.

## 4. The preflight reads the credential the way the hook does

In access mode 2 the preflight used to check only that something owned by the
attestation service sat at the attestation's address. It now decodes the same
bytes `require_attestation` decodes (`instructions/execute.rs`), through the
layout in `programs/pangu/src/sas.rs`:

| Field | Offset | Size |
|---|---|---|
| discriminator, 2 for an attestation | 0 | 1 |
| nonce, the wallet it is about | 1 | 32 |
| credential | 33 | 32 |
| schema | 65 | 32 |
| length of the schema-shaped blob | 97 | 4, u32 little endian |
| signer | 101 + blob length | 32 |
| expiry, 0 for never | signer + 32 | 8, i64 little endian |

and the credential's own list: name length as a u32 at 33, the name, then a u32
count and that many keys. A count above 64 (`MAX_AUTHORIZED_SIGNERS`) is refused
rather than walked, the same cap the hook holds.

The answers are the hook's answers: `CredentialInvalid` for missing, foreign,
wrongly labelled, truncated or self-contradicting accounts, `CredentialExpired`
for an attestation past its time, `CredentialSignerNotAuthorized` when the key
that signed it has been dropped from the list. The expiry is compared against
the Clock sysvar read in the same call, not against this machine's clock, since
that is the clock the hook compares against.

`test/credential.test.ts` crafts the bytes for each branch, including an account
that claims four billion bytes of blob and a list that states nine keys and
holds one. The crafting is local: importing the program package's fixtures would
make the SDK's tests depend on a bankrun test harness in another package.

## 5. A record holding nothing closes mid-sale

`close_buyer_record` now allows a record whose `net_bought` is zero at any time.
The package holds no guard of its own on closing, so this was documentation:
`closeBuyerRecordInstruction` and `isSaleRunning` both say it plainly, and
`isSaleRunning` says outright that it is not a gate on closing. `saleStanding`
is untouched.

## 6. Decimals for a sale with no band

Found while building the devnet scripts in `packages/scripts`: the program only stores `base_decimals`
and `quote_decimals` on a sale with a price band (`create_sale.rs`,
`decimals.unwrap_or((0, 0))`), so `getSale` was handing back zero decimals for
every open or issuer-list sale, and anything dividing by it showed a wrong
amount.

The call: `getSale` fills `baseDecimals` from the mint when the stored value is
zero, at the cost of one more account read. It already has the connection and
the mint, and the alternative left every reader to remember the exception.
`decodeSale`, which only has the bytes in front of it, still returns the zero the
account really holds, and the field says so. A mint that cannot be read leaves
the zero in place.

## What the runs said

`npm test` in `packages/sdk`: 97 pass across 8 files, up from 85 across 7. The
new file is `test/credential.test.ts`; the rest are the tests for the required
template and the two mint-keeping options.

`scripts/wsl/sdk-fork-test.sh`: `SDK-FORK-OK`. That run is the proof for changes
2 and 3 together: every template the fork test opens now asks for
`CreatorUpdateAuthority`, and `create_sale`, which reads the template's fee mode
and refuses a mint that can still be minted, went through in the same
transaction as the pool.

Nothing here changes what a buy costs on chain. The template and the sale are
built the same way, with the same accounts, except that the launch template is
now always passed to `create_sale`: about 6,500 compute units, already measured
in `review-fixes.md`, and only when a sale is opened. The preflight costs no gas
at all: in mode 2 it is one `getMultipleAccountsInfo` for the credential, the
attestation and the clock, where it used to be one `getAccountInfo`. Reading a
sale with no price band is now two account reads instead of one.
