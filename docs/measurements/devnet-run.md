# The devnet run

Every transaction the five scripts in `packages/scripts` sent against the live
Pangu program on devnet, with the explorer link for each. Written as the run
happened, not from memory.

Program: `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG`
([explorer](https://explorer.solana.com/address/4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG?cluster=devnet))
RPC: `https://api.devnet.solana.com`

## Progress

- [x] Step 1: the package, the .env.example and this note.
- [x] Step 2: launch, written and typechecked. Demo keypair `9QTJCGx2TLSre7dnjxn3hDs2EJznxr5F84DqrnU1n4FW` created outside the repo and funded with 0.6 SOL from the project wallet, which kept 2.04334508 SOL.
- [x] Step 3: seed, written and typechecked.
- [x] Step 4: prove, with the attack table and the exit code split out so they can be tested without a network.
- [x] Step 5: graduate and refresh-price. The refresh had to exist during step 2 as well, because a banded launch refreshes the quote before it opens the sale.
- [x] Step 6: the run on devnet, written up below.
- [x] Step 7: 19 tests on the flag reading and the attack table, typecheck clean, sweeps clean.

## The list mode sale

`npm run launch -- --mode list --cap-share-bps 1000`, 22 September 2026.

| Fact | Value |
| --- | --- |
| Mint | [`22qdWVNDzT81xvMt5oKy9U7wbpwfqrvntw1X7V1pN1wc`](https://explorer.solana.com/address/22qdWVNDzT81xvMt5oKy9U7wbpwfqrvntw1X7V1pN1wc?cluster=devnet) |
| Pool | [`AYg4QUFPQqJWCVJ3cNm2TxbJtZnLwXcqS4G6EWjGzTbc`](https://explorer.solana.com/address/AYg4QUFPQqJWCVJ3cNm2TxbJtZnLwXcqS4G6EWjGzTbc?cluster=devnet) |
| Launch template | [`4asU84n1ChVEfoDWx1wBU8guPYdRzdynWHL9ePSLjFjv`](https://explorer.solana.com/address/4asU84n1ChVEfoDWx1wBU8guPYdRzdynWHL9ePSLjFjv?cluster=devnet) |
| Sale rules | [`B4LYW7A6VwH9B2CqbHXMoReRSd7xBgsTvk4XXTPeWHkt`](https://explorer.solana.com/address/B4LYW7A6VwH9B2CqbHXMoReRSd7xBgsTvk4XXTPeWHkt?cluster=devnet) |
| Extra account list | [`C75NEHrrePnSXBybef7niXU7ewXqmyB3KfDEHhCDSRwe`](https://explorer.solana.com/address/C75NEHrrePnSXBybef7niXU7ewXqmyB3KfDEHhCDSRwe?cluster=devnet) |
| Template transaction | [`2ZkYHXqLdX3s4RtE3QWyWpbXWhF8BLtw2WeCoJvtrCwULh1RUQ2FGfDXHCoYMi3QrKTMMjDje87hGanLatVQVvP`](https://explorer.solana.com/tx/2ZkYHXqLdX3s4RtE3QWyWpbXWhF8BLtw2WeCoJvtrCwULh1RUQ2FGfDXHCoYMi3QrKTMMjDje87hGanLatVQVvP?cluster=devnet) |
| Pool and rules, one transaction | [`2ejBdhHNnDop5mCsWnDbtTAxSsesj9PqX5iyDpMRPuM4oSyZcXwFnTL36BeW4T8vNnn9aGSnaHEK4XSLqjWks7mR`](https://explorer.solana.com/tx/2ejBdhHNnDop5mCsWnDbtTAxSsesj9PqX5iyDpMRPuM4oSyZcXwFnTL36BeW4T8vNnn9aGSnaHEK4XSLqjWks7mR?cluster=devnet) |
| Cap | 79,999,967,072,171 raw units, 10 percent of what the curve sells |
| Sizes | 662 bytes for the template, 1,013 for the pool and rules, limit 1,232 |
| Cost | 0.019222 SOL |

## Seeding the list mode sale

`npm run seed`. Six demo wallets, six buys under the cap, two of them selling a
quarter of it back. 0.078416 SOL, most of it the rent for their token accounts
and buyer records, which stays with those wallets.

Running it a second time sends nothing: the wallets are derived from the paying
key and the mint, so the second run finds them already approved and already
holding, and only prints the standing.

## Attacking the list mode sale

`npm run prove`. Every line below is a real transaction that landed on devnet.
The refusals are landed on purpose rather than stopped by the node's dry run, so
each one has a signature anybody can open.

| Attack | Invariant | Expected | Actual | Signature |
| --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | [`2RUZ6o2n`](https://explorer.solana.com/tx/2RUZ6o2nA8yG3WXwvtS3feq2Y93ovUCVWspjPCYnj5jHAdFx7jBAEAFfJPhoJNjcCRSUoQbG8FdmWM6cwPL75XLe?cluster=devnet) |
| buy while not on the approved list | C6 | NotApproved | NotApproved | [`3w75H2ML`](https://explorer.solana.com/tx/3w75H2MLUzMHDPDWGoTztsbcLeoQqzhbNUPphdj65ZsQo85Xr9HXcmTVut2CuGY7A7qnuKH1roCMwo3Ki486mvD9?cluster=devnet) |
| buy past the cap in one go | C3 | OverCap | OverCap | [`5Qy6oUUd`](https://explorer.solana.com/tx/5Qy6oUUdUUsDxFCLDhroLf5mGL6UMx1Cv2c5eecLsqRiNjo9R5G2RL2dHHN5VxdsL5M3JuWm1LcNk1L8XMLycugA?cluster=devnet) |
| a second buy that crosses the cap | C3 | OverCap | OverCap | [`5MTEG7Bp`](https://explorer.solana.com/tx/5MTEG7BpugQbyeEPeJbHVHA5zobmVNeik9X73tSutA4VQcY7kDKfroW8AoMB5kqGuTrJKL6W4q1jWibWZ2T4vn8X?cluster=devnet) |
| buy into a second token account of the same wallet | C3 | OverCap | OverCap | [`3LHN2mhK`](https://explorer.solana.com/tx/3LHN2mhKRWxZJuwFwEBxT3vpXoVN9aMyshQx6jSX4efmyZwCxhZ9CRrRQmYJTXFRvQGjxDQB2rEXLXgbMF2RYbSR?cluster=devnet) |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | [`4S4E7ScQ`](https://explorer.solana.com/tx/4S4E7ScQLmup4vbpjnjkg2ATXkR1sUgoZQSNkFSZEUYga6ZbeRefg5CRAkmjFZcpLE9rtd72ib72b5jLvqqmCP5F?cluster=devnet) |
| send tokens straight to another wallet | C4 | WalletToWalletDuringSale | WalletToWalletDuringSale | [`5idreMZF`](https://explorer.solana.com/tx/5idreMZFbcaRuxd8HzngYf4AcQo9Hd66YGDKMGQZvkseFajKntqVRQWeVP2n8EnzU5UNCoZ1ZmBXhZ5P1pqCMTSk?cluster=devnet) |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | [`YRXhfL31`](https://explorer.solana.com/tx/YRXhfL31MDM8Pscg635m7fgprNpQPgP1tRgSy7kyJH8fLmnCkEgN62Lf7avMv7ntMA8PLVqAcgj5HZCUQN7mDHW?cluster=devnet) |
| a revoked wallet sells back to the pool | C5 | it goes through | it goes through | [`3zSvKpxN`](https://explorer.solana.com/tx/3zSvKpxNF9sWCPvXvP74kWZDsEjWwgf7HUbYz9CxZBJDRjH3iDrGru8pCzVXjtUxTRBroRjieu4NTrC3meQApFxS?cluster=devnet) |
| buy that would push the price past the ceiling | C9 | PriceOutsideBand | not run: this sale has no price band | |

```
proof    : the largest wallet holds 11.45 percent of the 698002353240641 raw units
           sold, against a cap worth 11.46 percent of them
9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
```

0.029905 SOL, after 0.070254 SOL came back from the attacking wallets.

## Graduating the list mode sale

`npm run graduate`. The curve was at 63 percent after the seeding and the attack
runs. Three more approved buyers filled it, then the permissionless migration
moved the liquidity to DAMM v2.

| Fact | Value |
| --- | --- |
| Filled at | 100,000,003 of 100,000,000 lamports raised |
| Migration | [`JRKFXfga`](https://explorer.solana.com/tx/JRKFXfgaZFbyfc2qM3BUYWp9Gj5ZnbLVYmkS3oWneaUy1KH7oXUuL3bcbdUr5A5khL296GagQNz4oPc74Ca37F4?cluster=devnet) |
| DAMM v2 pool | [`DLK2xF5i18rgXui9RN6urpAYg3bJxKNtkxiMYS5KECv`](https://explorer.solana.com/address/DLK2xF5i18rgXui9RN6urpAYg3bJxKNtkxiMYS5KECv?cluster=devnet) |
| Hook on the mint afterwards | `11111111111111111111111111111111`, which is empty |
| Filling buys | [`2MWhokrU`](https://explorer.solana.com/tx/2MWhokrUmVH3axU7Renuzc1WYJJZQLsQZk4dpbqb4gxN25Mu9hV79yNP38UGa4N82th38Q4Fon3ogrmR4MVp52wV?cluster=devnet), [`gq9d3cCN`](https://explorer.solana.com/tx/gq9d3cCNtbkFeY7qkSJn7F3gZEBvzca3AfVqiq8m7DsfGtfaVcoZsQr1KNa6BxHForHi6fYqhDgrpeMwJXs57LZ?cluster=devnet), [`5JD38cUA`](https://explorer.solana.com/tx/5JD38cUAU3f2eTUt12aCfYubLETCZcFFpxiGK6JJP87WsjFSxgvQcRxvgFkp228YfoDBafWnQEyyMksmDFFJHjFZ?cluster=devnet) |
| Cost | 0.066097 SOL, after 0.026887 SOL came back from the buying wallets |

The sale token now moves freely: Meteora takes the hook off the mint in the trade
that completes the curve, so after graduation there are no Pangu rules on it at
all. That is by design and it is stated as a non-goal in the threat model.

## The banded sale, and what the oracle was doing at the time

`npm run launch -- --mode open --band 500 --quote wsol`, 09:30 UTC.

| Fact | Value |
| --- | --- |
| Mint | [`G8zhNPwrsdA47jiovYhwjkp8YYMMHnE3f48bWm5Hmp6G`](https://explorer.solana.com/address/G8zhNPwrsdA47jiovYhwjkp8YYMMHnE3f48bWm5Hmp6G?cluster=devnet) |
| Pool | [`5oUL86iKo8VsUui5V9imQiSzegmf7817uN4uc1XiiwD8`](https://explorer.solana.com/address/5oUL86iKo8VsUui5V9imQiSzegmf7817uN4uc1XiiwD8?cluster=devnet) |
| Sale rules | [`9DpYe4W42Ui9xD6EPXsrzDEDgYV8KGHPU6JQYSKWv7PY`](https://explorer.solana.com/address/9DpYe4W42Ui9xD6EPXsrzDEDgYV8KGHPU6JQYSKWv7PY?cluster=devnet) |
| Extra account list | [`GCN71zqv94KZFqxq4i1MR3Ggw83W1DnrJGKd2SzbTpRr`](https://explorer.solana.com/address/GCN71zqv94KZFqxq4i1MR3Ggw83W1DnrJGKd2SzbTpRr?cluster=devnet) |
| Price account named in the rules | [`7uPLLyB29H9sATzjKi1DKWgqD2YXrjp8YS8QpEZi5b1Z`](https://explorer.solana.com/address/7uPLLyB29H9sATzjKi1DKWgqD2YXrjp8YS8QpEZi5b1Z?cluster=devnet) |
| Pool and rules, one transaction | [`Yr3KeH7D`](https://explorer.solana.com/tx/Yr3KeH7D4tZ8Cjz1ZegZHYsBCryiEK1EGukN2LzNTzZWbMRNyKJ9ukGJWhbr38chK6pikQWASAXpgCVhLbYQTkZ?cluster=devnet) |
| Sizes | 662 bytes for the template, 1,043 for the pool and rules, limit 1,232 |
| Cost | 0.019923 SOL |

Two honest facts about this run, both of which show up in the table below.

1. **The US market was shut.** It was 09:30 UTC, about 05:30 in New York, and the
   clock feed's last regular trade was 54,022 seconds earlier.
2. **The price refresh could not be sent.** Switchboard's Crossbar answered a
   request for devnet gateways with an empty list, and the same for mainnet, so
   `pangu-sdk/price` had no gateway to ask for a signed quote. Earlier the same
   day two refreshes went through, at slots 502,034,846 and 502,034,927
   (docs/measurements/sdk-fork-test.md). The launch says so and opens the sale
   anyway, because the quote account's address comes from the queue and the two
   feed ids and not from anyone having written to it. The band then refuses
   every buy until a refresh lands, which is the fail-closed half of C9.

So the quote in the account was 325,674 slots old against a limit of 400, and the
band's answer was `PriceStale` rather than `MarketClosed`. Both are the same rule
doing the same thing: no usable price, no buy.

## Attacking the banded sale

`npm run prove`, on the mint above.

| Attack | Invariant | Expected | Actual | Signature |
| --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | [`5ts814i6`](https://explorer.solana.com/tx/5ts814i6THcq9PVUmS4dwebPrEd2qQqcFVQgoSfNjth151Sv9QVvi4WFU7esYymgq9eUaFWjexDtxUjnovVWMNQh?cluster=devnet) |
| buy past the cap in one go | C3 | PriceStale | PriceStale | [`57z7VtGm`](https://explorer.solana.com/tx/57z7VtGmtWPSobBYNLrMf37MXz1DXRVV3TUxEaRzJqbVQE4rcay3xZAGPuNEXPfJddFqrMmznemKHAFTVuZgj7rV?cluster=devnet) |
| buy while the sale's price cannot be used | C9 | PriceStale | PriceStale | [`4QFG9BVj`](https://explorer.solana.com/tx/4QFG9BVjaZhfS4A7pL3hqog4iFqXR3x4uBBjVLmHjedDedKkrNwNbYEmuRd5RZoa67Ca7zmrzE8Ea7jivjdrZggd?cluster=devnet) |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | [`4iwZsJY9`](https://explorer.solana.com/tx/4iwZsJY9nfuMEDuLZiYADbGJRubrUdCVBAcGfXSPgtsRnjnP3WFQsgD5JZ8J5KoYTn2g2c5gmuM3y3vmzgCWBdLd?cluster=devnet) |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | [`4mYvXLV9`](https://explorer.solana.com/tx/4mYvXLV9btXRJDC7NXFWrm31BByGL3AujaDbAX5XVT3g1pTgmbAKRXVMznJcW41xrqLSrZNMebtrye1GmEtJ41dt?cluster=devnet) |

```
5 attacks run, 5 refused as expected, 0 allowed as expected, 6 not applicable, 0 off the standard
```

The six that were not run say why on their own line: this sale has open access,
so there is no approved list to be left off and nobody to revoke, and with the
price unusable no buy could land to set up the cap attacks or the wallet to
wallet transfer. The cap attacks on the same code path are proven on the list
mode sale above, in the same run of the same script.

**The ceiling itself.** `PriceOutsideBand` cannot be provoked on a sale priced in
SOL. The band compares the curve's price, in paying tokens per sale token,
against the stock's price in dollars. With SOL as the paying token the curve sits
around 0.00000006 against a ceiling of 355, and no affordable buy moves it eight
orders of magnitude. A band only bites when the paying token is a dollar token,
which is what the fork test uses, and it is the fork test that covers that line:
docs/measurements/sdk-fork-test.md.

## What the whole run cost

The scripts pay from a demo keypair that lives outside the repository, public key
[`9QTJCGx2TLSre7dnjxn3hDs2EJznxr5F84DqrnU1n4FW`](https://explorer.solana.com/address/9QTJCGx2TLSre7dnjxn3hDs2EJznxr5F84DqrnU1n4FW?cluster=devnet).
It was funded twice from the project's devnet wallet, 0.6 SOL and then 0.5 SOL,
and ended the run holding 0.4374 SOL, so the whole thing cost 0.6626 SOL.

About 0.3 SOL of that was not spent on the sales at all. Three early runs of
`prove` were killed part way, twice by a bug of mine and once by the public RPC
rate limiting the client into a crash, and each one left its three attacking
wallets holding devnet SOL that nobody has the key to any more. The fixes are in
the code now: the attacking wallets are swept back to the payer in a `finally`
and again from a crash handler, and the connection spaces its calls 120
milliseconds apart so the public node does not end the process.

| Command | Cost |
| --- | --- |
| `launch --mode list --cap-share-bps 1000` | 0.019222 SOL |
| `seed` | 0.078416 SOL |
| `prove` on the list sale | 0.029905 SOL |
| `graduate` | 0.066097 SOL |
| `launch --mode open --band 500 --quote wsol` | 0.019923 SOL |
| `prove` on the banded sale | 0.003143 SOL |

A refused attack costs its 5,000 lamport fee and nothing else, because the
transaction is landed on purpose rather than stopped by the node's dry run.

# The second run, on the upgraded program (slot 502373496)

Program slot **502373496**, the build carrying every WO-10 and WO-11 fix, put
on chain by `deploy.sh devnet` on 22 September 2026 (see `docs/deployments.md`).
The same five commands were run again from scratch against it. Everything below
is a transaction that landed on devnet after the upgrade.

Program: `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG`, running `pangu-devnet.so`,
sha256 `58f22ae2136edc6f6fd35edc5aec1bb27f3a5548d39fb94b4c530c8dbad0eb34`.

**The new rule bit first.** The first `launch` against the upgraded program was
refused at simulation with `MintAuthorityStillSet` (error 6021, C14), because the
demo curve still asked DBC for `CreatorUpdateAndMintAuthority`, and that option
leaves the mint authority alive. That is the new check doing its job: a token
that can still be minted is one the cap can never hold.
`packages/scripts/src/curve.ts` now asks for `CreatorUpdateAuthority`, the option
every fork fixture already uses, and the launch went straight through.

## The list mode sale

`npm run launch -- --mode list --cap-share-bps 1000`, 10:15 UTC.

| Fact | Value |
| --- | --- |
| Mint | [`FToBcoyaCZtLpbaGFV8wdomngjwuQp5XShj6fHdzLyGv`](https://explorer.solana.com/address/FToBcoyaCZtLpbaGFV8wdomngjwuQp5XShj6fHdzLyGv?cluster=devnet) |
| Pool | [`CXDLF5wq9ei4amHmgtyQjaedrkqmaWCGhDMRqs4nPFHu`](https://explorer.solana.com/address/CXDLF5wq9ei4amHmgtyQjaedrkqmaWCGhDMRqs4nPFHu?cluster=devnet) |
| Launch template | [`4pnQkRMWPzVZQS3H9JsoLsLDVv2SEXDw51urFM5K7Xsh`](https://explorer.solana.com/address/4pnQkRMWPzVZQS3H9JsoLsLDVv2SEXDw51urFM5K7Xsh?cluster=devnet) |
| Sale rules | [`2uTcUMEko35W9vP4Fd6n2ftYjhYpQkzs72uhf1UEb4Y4`](https://explorer.solana.com/address/2uTcUMEko35W9vP4Fd6n2ftYjhYpQkzs72uhf1UEb4Y4?cluster=devnet) |
| Extra account list | [`BjUoW8cmKwFkyJwwXqnYKamdoCnmkrdZvu9q4brd7U8w`](https://explorer.solana.com/address/BjUoW8cmKwFkyJwwXqnYKamdoCnmkrdZvu9q4brd7U8w?cluster=devnet) |
| Template transaction | [`526NJoSp`](https://explorer.solana.com/tx/526NJoSpZHxJWy95YEwet2b3gUyKDXSW5rBRGjs3nDTtBuNgB3h2tFwafLHXvSNDdvjsRQtn3s9uzGzvD2ZScmGq?cluster=devnet) |
| Pool and rules, one transaction | [`23s4BVPA`](https://explorer.solana.com/tx/23s4BVPAH32bSTM9QphHZMucrikhj1ixyqGcE7hB3LJftVHGMbf5tVPydxrHQDVzicYYBJRowLoUAYsSfE32eUJ9?cluster=devnet) |
| Cap | 79,999,967,072,171 raw units, 10 percent of what the curve sells |
| Sizes | 662 bytes for the template, 1,013 for the pool and rules, limit 1,232 |
| Cost | 0.019222 SOL |

## Seeding the list mode sale

`npm run seed`. Six demo wallets, six buys under the cap, two of them selling a
quarter of it back. 389,123,803,662,293 raw units held net of the sells, the
largest wallet on 20.13 percent of that against a cap worth 20.56 percent of it.
0.078416 SOL, most of it the rent for their token accounts and buyer records.

## Attacking the list mode sale

`npm run prove`, exit code 0.

| Attack | Invariant | Expected | Actual | Signature |
| --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | [`4HnSQqse`](https://explorer.solana.com/tx/4HnSQqsevXgaPTaPwEeB8YC2C1L8Ax6zLotHoSxVgWig5Lf5AxhdWCrjAgU5TRYhSf5XVnU8ZL3BCf2AGNptRUYd?cluster=devnet) |
| buy while not on the approved list | C6 | NotApproved | NotApproved | [`549vJCdN`](https://explorer.solana.com/tx/549vJCdNFguFHCEGEkNTPRBxSHrXLapbDZq5mFzhhkBf5e2WEZUABjoGwFBryFEgA6W72xhFbEcA4y7Bt8L1Kx75?cluster=devnet) |
| buy past the cap in one go | C3 | OverCap | OverCap | [`2PJuHfzp`](https://explorer.solana.com/tx/2PJuHfzpkM1rbeyUw8ZeYSm7TXKQFDPqjatw8j8WEPM4xxJoubYxJ7XpEdZGnnCEFzwB6HLfdheotRGJuqhU19Px?cluster=devnet) |
| a second buy that crosses the cap | C3 | OverCap | OverCap | [`5NVjg5xs`](https://explorer.solana.com/tx/5NVjg5xse23HqzWfxjHVBUiA6e3LxjrcEZrTZqJNFLjAwnG5KRsyzEW51VXRkHTBjuoBRaHEudb7YQKKtTgQ36dJ?cluster=devnet) |
| buy into a second token account of the same wallet | C3 | OverCap | OverCap | [`2zK4gSTC`](https://explorer.solana.com/tx/2zK4gSTC4xWLev4tMV27cLUn8ubrnhRS2HQ3k6Kpcf1aP4UjKp1duZ75KBnXNvQf1HDEbNv2eAmHswMxZWHJZU9M?cluster=devnet) |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | [`5mKWFBtb`](https://explorer.solana.com/tx/5mKWFBtbUQi6S1dk92c26AiuPDRtQYZy3kiRWKSAG1n4ySYrLD1wR67gxQLDqMu9eGcEy9ZLwQDwtYeZWixL26pq?cluster=devnet) |
| send tokens straight to another wallet | C4 | WalletToWalletDuringSale | WalletToWalletDuringSale | [`4k9Aiot3`](https://explorer.solana.com/tx/4k9Aiot33BububatD31ku3DzVJgDTyXuHchACXbk2Ebfi7LXFRR7xfZcUhtEcJRu6kD2WrmYUTSkUy9euowYnLAP?cluster=devnet) |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | [`3PUW1bT9`](https://explorer.solana.com/tx/3PUW1bT9iKM5pLSGpRqdKe9HkrcaFGkGdmEG4wLk7DvtbVKsD6Vqzz9WZrBkXU6tRbN7PS5HNjc2EUdtJwdsJ7kg?cluster=devnet) |
| a revoked wallet sells back to the pool | C5 | it goes through | it goes through | [`WiANjhTm`](https://explorer.solana.com/tx/WiANjhTmTM6H9K1N23axK8GX5oEnYnFhqkgzNBHSdkUo4Gr2arvhqBsz8vequdXxPjNGpPgd1eQ8XPTwToj6BXo?cluster=devnet) |
| buy that would push the price past the ceiling | C9 | PriceOutsideBand | not run: this sale has no price band | |

```
proof    : the largest wallet holds 16.76 percent of the 467347859706336 raw units
           sold, against a cap worth 17.12 percent of them
9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
```

0.018713 SOL, after 0.081445 SOL came back from the attacking wallets.

## Graduating: not reached on this run

`npm run graduate` stopped before it sent anything, on the first filling buy:

```
curve    : 25993309 of 100000000 raw units raised, 26 percent
AnchorError thrown in programs/pangu/src/instructions/execute.rs:188.
Error Code: OverCap. Error Number: 6009.
```

This is the script's own sizing, not the program. `graduate.ts` line 73 reads
`const finishing = left < sale.cap`, where `left` is what is still to be raised
in the paying token (74,006,691 lamports) and `sale.cap` is a number of sale
tokens (79,999,967,072,171). The two sides are different units, so the test is
always true, every buy takes the finishing branch, and `buyWithin`, the helper
that sizes a buy to fit under the cap, never runs. On the first run the curve
happened to be 63 percent full when `graduate` was called, where the price was
high enough that the unsized buy stayed under the cap by luck. This time the
curve was at 26 percent, the same 0.01 SOL bought far more tokens, and the cap
refused it. The rule the hook applied is right. The fix belongs in the script,
and it was not part of this work order.

## The price refresh, three days before Switchboard shuts down

`npm run refresh-price`, run before the banded launch, answered the way WO-8 saw
on the morning of 22 September:

```
Failed to fetch gateway from crossbar: No gateways available for network: devnet
```

Checked by hand at the same moment:

- `GET https://crossbar.switchboard.xyz/gateways?network=devnet` answers `200`
  with an empty list, `[]`. The registry is up and has nothing in it.
- The one devnet oracle gateway the spike found alive,
  `https://141.95.35.110.xip.switchboard-oracles.xyz/devnet`, still answers `200`
  on `/gateway/api/v1/test`.

So a signed quote can still be fetched today, but only by pointing the client
straight at that one box, and `refresh-price` has no way to be told to do that.
Nothing in `@switchboard-xyz/on-demand` 3.10.6 takes a gateway URL on the price
path: the only route that works is pre-seeding the Crossbar client's gateway
cache, an undocumented field inside a third-party package. The background, the
measurements and Switchboard's announced shutdown on 25 September 2026 are in
`docs/RD-SWITCHBOARD-GATEWAYS.md`. **A live price refresh cannot be promised at
demo time from the shipped command.** The band behaves correctly without one:
no usable price, no buy.

## The banded sale

`npm run launch -- --mode open --band 500 --quote wsol`, 10:22 UTC. The launch
reported the failed refresh and opened the sale anyway, because the quote
account's address comes from the queue and the two feed ids and not from anyone
having written to it.

| Fact | Value |
| --- | --- |
| Mint | [`61mgkLjdQrdJF5TxmUq4oxggeF96GNLuQsTFUx47K5q4`](https://explorer.solana.com/address/61mgkLjdQrdJF5TxmUq4oxggeF96GNLuQsTFUx47K5q4?cluster=devnet) |
| Pool | [`2YKWt21s6X5y66EbwcxSDbgYwkyFf8EFiuUBSF6dybDh`](https://explorer.solana.com/address/2YKWt21s6X5y66EbwcxSDbgYwkyFf8EFiuUBSF6dybDh?cluster=devnet) |
| Launch template | [`9LGUfhXPjnfnwFzn97kKMqmzSBS4UMXN5PwjGfhDpeEk`](https://explorer.solana.com/address/9LGUfhXPjnfnwFzn97kKMqmzSBS4UMXN5PwjGfhDpeEk?cluster=devnet) |
| Sale rules | [`r68kxWcAipmr17EjzWV46C4ovyFm1FWUdKTLQm5FXZV`](https://explorer.solana.com/address/r68kxWcAipmr17EjzWV46C4ovyFm1FWUdKTLQm5FXZV?cluster=devnet) |
| Extra account list | [`HruCkKYCM73r4a7af5JBJAbcLDjaUizok5myLJedbYz1`](https://explorer.solana.com/address/HruCkKYCM73r4a7af5JBJAbcLDjaUizok5myLJedbYz1?cluster=devnet) |
| Price account named in the rules | [`7uPLLyB29H9sATzjKi1DKWgqD2YXrjp8YS8QpEZi5b1Z`](https://explorer.solana.com/address/7uPLLyB29H9sATzjKi1DKWgqD2YXrjp8YS8QpEZi5b1Z?cluster=devnet) |
| Template transaction | [`3dx4uJmA`](https://explorer.solana.com/tx/3dx4uJmAu4n7ptppXQanJQfiXHktvsMANazjZWrCTQPXy2WUeVu1XpWEBnTEHKgPkYRJ9QHXxPfk1YbfcbXhF9Lr?cluster=devnet) |
| Pool and rules, one transaction | [`3UEhiyk1`](https://explorer.solana.com/tx/3UEhiyk1krPn8Rg3p4p7k1vniMss2Whfujns8PNoRVLomsN9Tdm3h4inVfHbooGh5wLkMgntmcfEcNEfV4xnXbMR?cluster=devnet) |
| Sizes | 662 bytes for the template, 1,043 for the pool and rules, limit 1,232 |
| Cost | 0.019923 SOL |

## Attacking the banded sale

`npm run prove` on that mint, exit code 0.

| Attack | Invariant | Expected | Actual | Signature |
| --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | [`2w8LdX5P`](https://explorer.solana.com/tx/2w8LdX5PWXBJTqK11nyD1jEyhqy6f9GtNJdLFF3uV3bjP14xTzqJBwnKu5VL29Q8U1Z7djoe5TScgMaKYhKm9EGE?cluster=devnet) |
| buy past the cap in one go | C3 | PriceStale | PriceStale | [`7pNLsop6`](https://explorer.solana.com/tx/7pNLsop6fy65BiSncecGnF9nAcEuD6GaXmoATW7xGvqpc8UQpRFcVQbSRNY5oQyQ83K4WkgxT2nnJoCS6ZqkaNq?cluster=devnet) |
| buy while the sale's price cannot be used | C9 | PriceStale | PriceStale | [`saZdtc4K`](https://explorer.solana.com/tx/saZdtc4Kf2gzZYDqhGpynw6yFfUEhzEzjN6dsSSr9tfvDn8d4zYTP1SkouP7vED54PgxULEuqNbCTpngeEnkibm?cluster=devnet) |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | [`59FtAdTD`](https://explorer.solana.com/tx/59FtAdTDNM821ytA19teTX3ER56iLx5NnMjNnFACbYKeTdGXeMyCCF3pAiRXfzkRTa8HQS56fd4E6geV8K4bEq6Z?cluster=devnet) |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | [`3nJQQTiS`](https://explorer.solana.com/tx/3nJQQTiSAooPyD6g5Z9tEciGCGAJK2zXAL8T3yRnE7PoWKyUY3kE8C1TPBuPQ8jrakZttTunCtyVUsuULUqmVDzA?cluster=devnet) |

```
5 attacks run, 5 refused as expected, 0 allowed as expected, 6 not applicable, 0 off the standard
```

0.003143 SOL, after 0.094872 SOL came back from the attacking wallets. The six
that were not run say why on their own line, the same six as the first run: open
access has no list and nobody to revoke, and with no usable price no buy can
land to set up the cap and the wallet to wallet attacks. Those are proven on the
list sale above, in the same run of the same script.

## What the second run cost

| Command | Cost |
| --- | --- |
| `launch --mode list --cap-share-bps 1000` | 0.019222 SOL |
| `seed` | 0.078416 SOL |
| `prove` on the list sale | 0.018713 SOL |
| `graduate` | nothing sent, stopped at simulation |
| `refresh-price` | nothing sent, no gateway to ask |
| `launch --mode open --band 500 --quote wsol` | 0.019923 SOL |
| `prove` on the banded sale | 0.003143 SOL |

The demo keypair started the run on 0.434244 SOL and ended on 0.265359 SOL, then
was topped up by 0.6 SOL from the project wallet. The project wallet holds
10.94148008 SOL after that top up and after paying for the program upgrade. The
upgrade needed 1.88780928 SOL free for the temporary upload buffer, which came
back when it landed, and the wallet stays well clear of that.

# The third run, on the Pyth build (slot 502436678)

Program slot **502436678**, the build whose price band reads Pyth instead of
Switchboard, on chain since 22 September 2026 at 13:02:53 UTC (see
`docs/deployments.md`). Program `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG`,
running `pangu.so`, sha256
`08746faa7b4ac83ada7bfa0cd2fcf0b04aabc9c335ebfc310fd2a06d486d3a7c`, hash checked
against the local build again at 13:25 UTC.

## What was already run against this build

The refresh, the list mode sale, the attacks and the graduation were run
straight after the upgrade and are written up in full in
`docs/measurements/sdk-pyth.md`, under "Devnet, end to end". The pointers:

| Command | What landed | Where to read it |
| --- | --- | --- |
| `refresh-price` | Apple at 340.2997 dollars, published the same second, into `9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb`. Signatures `2xiHPArYKpXTFR2cU81maow3KSB2VuN2BNqrXuEXdvfSTZLzdDuJaNUFMKARVPLKc34rmNu9kfYFiVJqNhyKQsu4` and `vf232DYgcwfgETHg5998J6SJaNgaziZCZxBBRmC6Zz4JQXeP7JhT5uSbaYBFKigd2BBY1PSEao4ejacRtuhodvB`, 35,180 lamports | sdk-pyth.md, "The refresh" |
| `launch --mode list --band 500` | Mint `E1PSmsUoxvwJas6e1UY8soQq3nhSTUsaP3oBS9eLws4f`, pool `AGzisymETq3hPYrqkt4gw648xTeMhEmWECQLjafaTEjX`, sale `4WQZxg6H7cmMDP6rzGG2QzeWbH36dZQjbwnZUJuLSSMuV5icsMLD7csf74jJK4mWNJ7ihkWRtRxh4zFt5oiJQYyo`, 0.019283 SOL | sdk-pyth.md, "The banded sale" |
| `prove` | 9 attacks, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard. Exit 0 | sdk-pyth.md, "The attacks" |
| `graduate` | Curve filled by ten wallets, DAMM v2 pool `4NYMEmSNcUQ4n3r1Q1jT9W3Lupfxcvw5Z3W2f3oVy116`, migration `XvGgdBj7ibyKW1NXjjkcDAQt4nSSMvC859fYaaFPjBhGapUBcLYj3fbU4bLb9rTqXFKxfj5fU8H4mFFxb5smXUn`, hook gone, 0.149953 SOL | sdk-pyth.md, "Graduation, with the buy sizing fixed" |

One line in that run was not a refusal and not a pass: the ceiling itself. That
sale was priced in SOL, the ceiling is in dollars, and a curve raising 0.1 SOL
cannot reach 357 dollars a share whatever anybody buys. So `prove` reported it
as not applicable and said why. The rest of this section is the sale that can
reach it.

## A sale that can reach the ceiling

The band compares the curve's price, in dollars a share, against the stock's
price plus the band. For that comparison to bite, buyers have to be paying in
something that is a dollar, and the curve has to open somewhere near a share
price. So this sale is priced in a dollar token and opens at 400 dollars a share
while Apple trades at about 345. Every buy is refused until Apple rises through
the ceiling, which is exactly what a price band is for: Pangu will not let an
issuer sell a tokenised Apple share at 400 dollars while Apple is worth 345.

### The dollar token

Devnet has no dollar anybody can get in quantity, so the demo mints its own.

```
npx tsx src/mint-dollars.ts
mint     : HSawBqXvK3vRvcuxp3HdDytDbmj8ffBH5PfS7vvpHT5X
decimals : 6
holder   : A7pBuE2gKddYxSZWR3ZuukPoWHBvJE5J1RuNPiNvXg5, owned by 9QTJCGx2TLSre7dnjxn3hDs2EJznxr5F84DqrnU1n4FW
minted   : 1000000000000 whole tokens, 1000000000000000000 raw units
signature: aE6Ah9sS3eb7t8NjbPv6vRQwecJbzVX2pwzSqjzw2W3yRs6s929VoAjKdhG3uiihnDtp7sMHiVmyDTazFgcpoH7
spent    : 0.002575 SOL
```

Six decimals, like every real dollar token on Solana. No freeze authority, so
nobody can strand a buyer mid sale. The mint authority stays with the demo
keypair, which is what lets `prove` hand its attacking wallets something to pay
with. It is a devnet demo token and nothing else.

### The curve

```
npx tsx src/launch.ts --mode open --band 500 \
  --quote HSawBqXvK3vRvcuxp3HdDytDbmj8ffBH5PfS7vvpHT5X \
  --threshold 360000000000 --base-decimals 9 --migration-percent 40 \
  --name "Pangu Priced Share" --symbol PBAND
```

Three of those flags are new, and all three exist for one reason: to move the
curve up into share price territory. Meteora's `buildCurve` works the opening
price out from the raise, the supply and the share kept back for migration, so
the opening price is not something a launch can set directly. It comes out as
the threshold times the migration share, over the supply times the square of
what is left to sell: 360,000,000,000 times 0.4, over a billion times 0.36,
which is 400 dollars.

The raise is a silly number, and it is meant to be. Nobody is filling a curve
that asks for 360 billion dollars. What matters is where it starts, and the only
way to start a billion share curve at 400 dollars with Meteora's own builder is
to ask it for a raise that large. Nine decimal shares are the other half of it:
the builder works in raw units, and six decimal shares run out of precision
somewhere around five dollars a share.

| Fact | Value |
| --- | --- |
| Sale | Pangu Priced Share (PBAND), open access, cap 10 percent of the curve |
| Mint | [`4vyCQRLeowhSzaZqbPVpdNy7upxVtqaCZdono2z8JeoT`](https://explorer.solana.com/address/4vyCQRLeowhSzaZqbPVpdNy7upxVtqaCZdono2z8JeoT?cluster=devnet) |
| Pool | `Fkaw1opbQSxfSKvEhjNAHQm3J2CRwCW7mM4ihy964QnB` |
| Rules | `FsApXMXBrcPQHDXekEwNisFnpBB4tEHaUqvgvDjSnWHt` |
| Launch template | `2MDhHJ7uTB2SE5VzyRtEXrtCq2xBpQELSCoNMCRHLBVB` |
| Extra account list | `7BKdnmMkE7rFdXhWNEQeqmEjG51aL1hnoSZ44kLxVV8M` |
| Price account | `9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb`, Pyth shard 7700 |
| Paying token | `HSawBqXvK3vRvcuxp3HdDytDbmj8ffBH5PfS7vvpHT5X`, 6 decimals |
| Opening price | 400 dollars a share |
| Cap | 59,999,999,997,545,703 raw units, a tenth of what the curve sells |
| Template signature | `3WubQPUZqXKXptdpUqgCGLGhAQrEucRTvxB7dVbcDmxSDtScTWUbfWncAknbhcCUp1WcHSN22gRsC2wZjNrTTMav` |
| Sale signature | `4i9on6ciyq1jst9VGjhmSpNDMoSctwAX8TpUzR2rrVm26NH56A8ocDbChR1bkbJ5YWCxSVQBnThsM41ML4oxmP3h` |
| Bytes | 662 for the template, 947 for the pool and rules, of 1232 |
| Cost | 0.019283 SOL |

The launch refreshed Apple's price itself before opening the sale, at 13:33 UTC:
344.6438 dollars, published the same second, confidence 3 basis points.
Signatures
`2fyY9jdsESFRUnwRErnYkChjm58gEk1kCT3UoAdMCDKz5veMhTVYC9CgPgVKcVeqBNVYLZoUGjAkgBgxaN52GDpF`
and
`4hyKbAJTiAewaZhJ7gPM5DpDP2U7trbmt2ppQNLDAx6MeTDRF33MZDHCT2cWYFiYkPU3cwNYZJPnHU9hREYZ62in`.

### The ceiling, refused on chain

`npx tsx src/prove.ts`, 13:33 to 13:34 UTC on Tuesday 22 September. That is
9:33 in New York, three minutes after the opening bell, so Pyth was publishing
Apple and the price the program read was 18 seconds old against the hour this
sale allows. Had the run happened at a weekend or overnight, the same line would
have said `PriceStale` instead: Pyth stops publishing an equity when its market shuts, the account ages
out, and the band refuses the buy for that reason rather than the ceiling.

```
band     : 5 percent over Equity.US.AAPL/USD at 344.6438 dollars, from Pyth shard 7700
price    : usable, published 18 seconds ago of an allowed 3600, confidence 3 of an allowed 100 basis points
account  : 9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb, fully verified by the Wormhole guardians
curve    : 400.0000 dollars a share against a ceiling of 361.8759, so every buy is refused
```

| Attack | Invariant | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | ok |
| buy while not on the approved list | C6 | NotApproved | open access, no list to be left off | skipped |
| buy past the cap in one go | C3 | PriceOutsideBand | PriceOutsideBand | ok |
| buy while the curve stands above the ceiling | C9 | PriceOutsideBand | PriceOutsideBand | ok |
| a second buy that crosses the cap | C3 | OverCap | no buy can land to set this up | skipped |
| buy into a second token account of the same wallet | C3 | OverCap | no buy can land to set this up | skipped |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | ok |
| send tokens straight to another wallet | C4 | WalletToWalletDuringSale | no buy can land to set this up | skipped |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | ok |
| a revoked wallet sells back to the pool | C5 | it goes through | nothing to revoke, open access | skipped |
| buy that would push the price past the ceiling | C9 | PriceOutsideBand | PriceOutsideBand | ok |

```
6 attacks run, 6 refused as expected, 0 allowed as expected, 5 not applicable, 0 off the standard
cost     : 0.007609 SOL, after 0.032867 SOL came back from the attacking wallets
```

The three that matter, each a transaction that really landed and was really
refused, with the refusal read out of the program's own logs by
`panguErrorFromLogs` rather than from "it failed":

| What was tried | Signature |
| --- | --- |
| A buy past the cap, which meets the band first because the hook reads the band before the cap | [`38mR5tkSHA5DPHvGWgN1qtDSxwgsZGVq6eE52aSkQyGfAo64dxr8v4ZqEcjotzm3V8sqMTCvuPNaovkGjaLsdVhe`](https://explorer.solana.com/tx/38mR5tkSHA5DPHvGWgN1qtDSxwgsZGVq6eE52aSkQyGfAo64dxr8v4ZqEcjotzm3V8sqMTCvuPNaovkGjaLsdVhe?cluster=devnet) |
| An ordinary buy, well under the cap | [`3boLTHs2ZHfMPTURkDYVMV14RgamvqooQDGRco1nn24879gKgvn59Pef8HBfa6PcuQXLTGKCaSy43ohKDvA35aSM`](https://explorer.solana.com/tx/3boLTHs2ZHfMPTURkDYVMV14RgamvqooQDGRco1nn24879gKgvn59Pef8HBfa6PcuQXLTGKCaSy43ohKDvA35aSM?cluster=devnet) |
| The buy the SDK's preflight had already said would break the ceiling | [`2iJnchxoJLgyixCS56VcxB1Aac1pRfoLhXywyK2RYmQvQmx6wYM97cZRW5R2ss7AFjPjZ27oCC9VAJeC13aEKb3B`](https://explorer.solana.com/tx/2iJnchxoJLgyixCS56VcxB1Aac1pRfoLhXywyK2RYmQvQmx6wYM97cZRW5R2ss7AFjPjZ27oCC9VAJeC13aEKb3B?cluster=devnet) |

The five that were not run say why on their own line. A sale that refuses every
buy cannot be walked up to its cap, and the cap and the wallet to wallet rules
need a wallet that holds something. Those are proven on the list sale in the
same build, in `sdk-pyth.md`.

### What this run needed from the scripts

Three things had to change before a dollar priced sale could be attacked at all,
and each one was a hole rather than a preference.

1. **The curve's shape.** `launch` now takes `--threshold`, `--base-decimals` and
   `--migration-percent`, and `curve.ts` says what opening price they add up to.
   Without them every demo curve opened at a fraction of a cent.
2. **Sizing in the paying token's own units.** `prove` worked its buy sizes out
   in lamports, which is right for a SOL sale and a thousand times wrong for a
   six decimal dollar token. It now reads the paying mint's decimals off the
   chain and works in whole numbers throughout.
3. **Paying the attacking wallets in the paying token.** A wallet holding only
   devnet SOL cannot buy in a dollar priced sale: the swap takes the dollar token
   out of the buyer's own account, so the refusal would come from the token
   program and would say nothing about Pangu's rules. `prove` now hands each
   wallet the paying token as well as its fees.

`prove` also learned one thing about the band itself. A sale whose curve already
stands above the ceiling refuses every buy for the same reason a stale price
does, so it takes the same path through the run: nothing that needs a buy to
land is attempted, and every attack that is sent expects `PriceOutsideBand`.

## What the third run cost

| Command | Cost |
| --- | --- |
| `mint-dollars` | 0.002575 SOL |
| `launch --mode open --band 500 --quote <dollar mint>` | 0.019283 SOL |
| `prove` on the banded dollar sale | 0.007609 SOL |

The demo keypair started this part of the run holding 0.653845 SOL and ended on
0.624379 SOL. The dollar tokens handed to the attacking wallets are not swept
back the way devnet SOL is: they are a demo token the same keypair can mint more
of.

# The fourth run, on the layout version build (slot 502476730)

Program slot **502476730**, the build that stamps a layout version into every
SaleRules account so a reader refuses rules written by any other layout, on
chain since 22 September 2026 at 14:53:26 UTC (see `docs/deployments.md`).
Program `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG`, running `pangu.so`,
sha256 `a937c610ab35442df59e0ead889a98ea8acafb396f2de9f2c37355ee5a555beb`,
358,248 bytes, hash checked against the local build at 14:55 UTC.

Upgrade signature
[`fomCUUu2u7MThsTpUyxwHXwyGTpNawwqKNZW8HaKExWZJpp3bKNS1xGhepZKKPxVFjJ4MdeL3MSPGqfqTK96eX7`](https://explorer.solana.com/tx/fomCUUu2u7MThsTpUyxwHXwyGTpNawwqKNZW8HaKExWZJpp3bKNS1xGhepZKKPxVFjJ4MdeL3MSPGqfqTK96eX7?cluster=devnet).
It took two attempts. The first died part way through the upload when WSL lost
its DNS for a moment, leaving the upload buffer holding 1.82077868 SOL, and the
same command run again picked that buffer up, landed the upgrade, and got the
buffer's SOL back. Both attempts together cost 0.001785 SOL in fees, and no new
rent: the program account was sized on the first deploy and this build still
fits it.

## The four earlier sales, refused by the reader

The first `status` after the upgrade found every sale in `sales.json`
unreadable, which is the point of the change. Two different reasons, both stated
plainly rather than decoded from the wrong offsets:

```
sale PLIST 22qdWVND...  WARN  opened by an earlier build: a SaleRules account is 362 bytes
                              and these are 427, so they were written by another build
sale PLIST FToBcoya...  WARN  opened by an earlier build: a SaleRules account is 362 bytes
                              and these are 427, so they were written by another build
sale PLIST E1PSmsUo...  WARN  opened by an earlier build: these are layout version 0 and this
                              package reads version 1, so they were written by another build
sale PBAND 4vyCQRLe...  WARN  opened by an earlier build: these are layout version 0 and this
                              package reads version 1, so they were written by another build
4 passed, 4 warned, 0 failed, 1 not checked, at 2026-09-22T14:55:36Z
```

The two from the Switchboard build are caught by size, since that layout held a
different set of fields. The two from the Pyth build are the same size as the
new one and are caught by the version byte alone, which is the case the size
check could never have covered. Every row said to retire the sale, so all four
came out of `sales.json` and the rest of this run opens fresh ones.

## The list mode sale

`npm run launch -- --mode list --cap-share-bps 1000`, 0.018892 SOL.

| What | Address or signature |
| --- | --- |
| Mint | `2ARD1KwvxyjLPwe46rivjxPRyMzvxSEPGvwKTqcNXpFR` |
| Pool | `FXVJFvSDma6UC49Co8uukPDxJn6XMA4VxbusGPo1Az4u` |
| Config | `6aYDwmt8PAwn5ekrYs9LECLAah38huxgKnktfRndxwqU` |
| Rules | `7BCDcQhXeGhwu58wwQZCwSknFcADD2uVwD3ymeAo1wCb` |
| Extra account list | `3HZrEpTb4RRhS9pPtJuGjsu9pTJk1QZPzACCk3PzzfjH` |
| Template | [`3GfKrXvNR6bimZg6DZsdk25Yje4BXQTeRyij7K7qYJCNhn9zWjNDqgvFUFfefQSH6c3h3m6Y6oeVx9FY2YFkDxSE`](https://explorer.solana.com/tx/3GfKrXvNR6bimZg6DZsdk25Yje4BXQTeRyij7K7qYJCNhn9zWjNDqgvFUFfefQSH6c3h3m6Y6oeVx9FY2YFkDxSE?cluster=devnet) |
| Sale | [`b8Exg5CBMy9rpGTnyFnj7bputieZUA3Bes4VSJ23SJKERahYsSLZmdPQDRZEozWbGXPSScAUrCmQqY35wq3EtAf`](https://explorer.solana.com/tx/b8Exg5CBMy9rpGTnyFnj7bputieZUA3Bes4VSJ23SJKERahYsSLZmdPQDRZEozWbGXPSScAUrCmQqY35wq3EtAf?cluster=devnet) |

## Seeding it

`npm run seed`, 0.078416 SOL. Six wallets bought and two of them sold part of it
back: 389,123,803,662,293 raw units sold net of what came back, the largest
wallet on 20.13 percent of that against a cap worth 20.56 percent.

| Step | Signature |
| --- | --- |
| Approve buyers, first batch | `3UVoQXNvM76rKreuuTp1Y8TSzHv2eYUtNsmFw7ZSmQrBrZQJUXS1zL7Bfwftkyv6YywgAjXB8Aw3K3fRJUU2gfV9` |
| Approve buyers, second batch | `3WbBGAnFZGcwNE3t46qhc4GgewKGQ5Sid7PGCQ2Xru8Zmami28Gi3745nCtgpMq4DVtQVPHfvWZLgouuFvrPPcQu` |
| Buy 1 | `2GA5NNYazdXGp6xTgFc5cWZZw7wXVNZV5DbbLNmJHCdqrQJgm9f43suNx8QnVwJV2PVdpzSGuy6TEY9pZAzePboq` |
| Buy 2 | `2qiwBX45VvjJ89CHpBFfZbV5q8TVj31FwNZFn73sgmufVho5ez9qtfruvspSRm7f2VGXPSD26PZHKSccb7qGqffV` |
| Buy 3 | `5HQ4zC4wzLH7aswRLGyz1qrvWiqXQXzJQH3FXpaPaYLERSHYozAhued7pUYnUPMHrM1K41mBRWcLk2zGzUcMwGYJ` |
| Buy 4 | `tvoKtCFj4gaHBLEo5dz2Xg46dLuye4YLBgUvULLy6pcVprsqXiXUmrDTsEDhjAUT2Q1ThV27EJWcs36MKbACRRw` |
| Buy 5 | `5Smu9JcSLFEsm13VJVYYHcnuYQmK3NG8eRKtEaiKujFmMGqoZAkt1WBf8zMyz27G6HxpbTU8RmGZohvN3c88Xfnx` |
| Buy 6 | `4esuMw8HCPE6rA5pJi2WJobhwSryHyfPmNHUZPESSVkqvqQForZ1mWVi6etWMzVYpMTN6BFKDpHMVu6SL8p8Qgbs` |
| Sell 1 | `3YjhU2RaW1dg5pRcmdiGTFin5gHZx2Mi4RPK2QN8SdS4EjdV5FUj18qQiGY6kNs4L2c45okPdbfLM3JMkZVSvvSS` |
| Sell 2 | `3N7HbtU7fb7fBu4rT9W9pJGrHabuVYjt5pCZadz8UoC7PkopJwcNf7kiP1NbcZDprGS4az4Pjx5cGi44H5tvJmEF` |

The first two buy signatures scrolled past the console, so they were read back
off the chain afterwards: each is a `Swap2WithTransferHook` on this mint paid
for by one of the demo wallets, in the right place in the sale's history.

## Attacking the list mode sale

`npm run prove`, exit 0, 0.018713 SOL after 0.081445 SOL came back from the
attacking wallets.

| Attack | Invariant | Expected | Actual | Result | Signature |
| --- | --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | ok | `2aTdo77ZoCamFFeJzbbX9EUaJy7LgBvBtt7tvbwZjWufjBSoSq7SyvnqtCUYykRU9Xv3J8CGqwQt6dxpAZQx1txL` |
| buy while not on the approved list | C6 | NotApproved | NotApproved | ok | `3G9Zi2nmamuSL6sEEBSmMwi2ZhWrwxm3DZSihVxgRdvCUM8UQb43Ei4PtDUeD51U1vJHZH4Esrah6PXn5konnH7T` |
| buy past the cap in one go | C3 | OverCap | OverCap | ok | `MKgaRrm3PTP8pnP1jaKVwojhVxg6z3MRdGWU3TMMCSCAy7EQhKWGJB92gZecXXQYZ7cr6bRCATkGeWz9AJY62QF` |
| a second buy that crosses the cap | C3 | OverCap | OverCap | ok | `dKvEh8oUgDVrAKcyLwdiLdwocHSrgKA1sfHaUnSxKJaPHPndbGf4scnkQpaLDhA5jSVvauXNS5s1QDCdRTQtqxd` |
| buy into a second token account of the same wallet | C3 | OverCap | OverCap | ok | `eogLUNtvJvTZZmtAup7kqU7uq47AUPDMgFaLzDNMVkFDdbZD3uz9d6WwjettR3o3c3sFwjoUDZyPhbDjJZZ4ria` |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | ok | `5cxM3AKXxE27yLdQjddUkfweQboLVXuX7stFQaoUAe6oWFh3fJ1voGx5kNY6Nz7vS4jyWgzrp3ChC95s1hZf8PZu` |
| send tokens straight to another wallet | C4 | WalletToWalletDuringSale | WalletToWalletDuringSale | ok | `5WJfRUae6MXqQfYCA7dU5mwJSx6ifUsHHtzbhVD6aXpd5NmQ3ikiaFhgxbH3Bp28G5up5VpiKtC4fpM1LiCdNh6X` |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | ok | `65FRU9jESSiNy67UCF357j5QHx68Ui8jsswGZf8gxhD8SkB5ZPD2zz56S16dAMwB3YT34YkQfgmzQ4MHmbqpyETS` |
| a revoked wallet sells back to the pool | C5 | it goes through | it goes through | ok | `3XdFBPUSFTMRGXcxSSiHnGac5rtNMyTykNAamAHfMohtLfBvSk7aVvgMFFYZ6en7SwnGSrjGoGWb41uJFsPikv1B` |
| buy that would push the price past the ceiling | C9 | PriceOutsideBand | this sale has no price band | skipped | not run |

```
proof    : the largest wallet holds 16.76 percent of the 467347859706336 raw units sold, against a cap worth 17.12 percent of them
9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
```

## Graduating it

`npm run graduate`, 0.119753 SOL after 0.063791 SOL came back. Seven buys filled
the curve to 100,000,002 of 100,000,000 raw units, the pool migrated to DAMM v2
`2cEAoE9zi53y736DsaPBzgfdrUqJnVgqwutZTGsmsSLc`, and the mint's transfer hook
came back as `11111111111111111111111111111111`: the rules are gone and the
token moves freely.

| Step | Signature |
| --- | --- |
| Buy 1 | `2BoZKKqgpsYhZa8vy5sBASrh7jSVDZSyyshht37GdH2UQK2PXGe8QAn1xtR784rAoLkfREeWvxoSwdkZCU3ZsZUM` |
| Buy 2 | `aw8Lwd5sYhrKhQjYatLzFCBhoEQMF3Fj42GNht6xwo36qmoVYwo2iYcnNxxpmNJz6aSmxcT4cAvnNDnfuHAp67M` |
| Buy 3 | `5c9M7wR4GucqGruV6ZARUEY2WKpGgPBrwWU9fK879v1kLdmAh513P2DeXaSAn4Cadw9U8Zt7dtAMqYseuVTyjT5n` |
| Buy 4 | `4H14KwtyV6FU63gA37op7Xd2p9RQyP6KtTZd8W8u4KBRpKXW9MvjoNScJgNg66cKUxrRmtZRKXTowK6zGgyrXHMz` |
| Buy 5 | `2U4uzRHWpQ2CiT1CCgV1QpsxDwG1pWrQ6X7MmMW1D8FUwYGBBEUkyXeLacpRVTpPqj5dCHqBiucU2e82c4cFj1o9` |
| Buy 6 | `XH47A3bXqkBhfQsAi6iqgwotCqj4QeYq91r7mEWWmANPiYSJHSEDrVGa8j3BeRU487H1i9qrLEpAhbvJra23E7K` |
| Buy 7 | `5K1pKGMV2tq8YTCtYkTzgUBXRbDrMFBoRuR6E5tmrhTVvp8isSGP6mksrjxizKcM5SVscUfGSguGXFSHZub3ABye` |
| Migration | [`5CpV8KReoYeRqXzeLDvfxuGM2yp99Mex6bTKRjutccd9HcmzZ2b1X36fVsPeuVHb7sQA3PuCkLRE8RJHbogiEPVT`](https://explorer.solana.com/tx/5CpV8KReoYeRqXzeLDvfxuGM2yp99Mex6bTKRjutccd9HcmzZ2b1X36fVsPeuVHb7sQA3PuCkLRE8RJHbogiEPVT?cluster=devnet) |

## The banded dollar priced sale

A fresh dollar token first, `npm run mint-dollars`, 0.002575 SOL: mint
`2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5`, six decimals, signature
`2WLkpF2PokMQ4SVv4oZPegrkKnZsc2HgkkhWKL5nCdqW5h2wYFzDvURvhr5STrAiSQVJkkfSFfa48JvjHRnoB4EZ`.

Then `npm run launch -- --mode open --band 500 --quote 2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5 --threshold 360000000000 --base-decimals 9 --migration-percent 40`,
0.019273 SOL. The curve opens at 400 dollars a share while Apple trades at
343.4350, so the ceiling of 360.6068 sits under the curve and every buy is
refused.

| What | Address or signature |
| --- | --- |
| Mint | `CBckMjBpHHQtcqxbTu5dUd3nQjyV8oVA4nfBZiTwYXo7` |
| Pool | `CNYqYEFDWDM9ePcBxwYpMESDotTRduGpjE2WUY1Uf4NJ` |
| Config | `HVrPWgKyUKLi1tM5tGYnvmnfdHu3sQQgxSJV1rpd2DuV` |
| Rules | `4UAEuedtkUhz5g4TNmqLsbGaKmDQZ7nwLxUxJchgm77c` |
| Extra account list | `EXrzQG5tbZ1w344vMYFC2XwNQtN2cGwZBnanhpK6rvJH` |
| Pyth price account | `9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb` |
| Price refresh | `4qeN74GPHBmFGZWbL8zH5FfrnTpQEJQsDT325HPi6jj2QqW2wpsSes11NNatVLuLpjowTV9sxzb5iVPrinirfCAN` and `26qJrGxLbPLVVut3iebQKqWPxt4y5FT5VLgM3sPtkaykV81EBevkiaUkr1KSbBD4fesB2XSuAh7r5rcXEmfBtpxb` |
| Template | `32YVAnqBt4hQeSMxUVAD5QEJgAeXADj8zEyZBhKDitT9LTnKB5f5KE8YJX7WG5MyYAPWzuvNdHAeHDgHswTLrq46` |
| Sale | [`jcEYEoaHoEULyms1rpyBiQm3rdxFQF2vfW3rxHwUYa65MfL4YZ3ABji4hWvAdBmiKt7skxqkLkkP2yAw6GJ6eV3`](https://explorer.solana.com/tx/jcEYEoaHoEULyms1rpyBiQm3rdxFQF2vfW3rxHwUYa65MfL4YZ3ABji4hWvAdBmiKt7skxqkLkkP2yAw6GJ6eV3?cluster=devnet) |

## Attacking the banded sale

`npm run prove`, exit 0, 0.007609 SOL after 0.032867 SOL came back. The US
market was open at 15:03 UTC, so the price was fresh and the refusal is the
ceiling, `PriceOutsideBand`. Overnight or at a weekend the same line would read
`PriceStale`, because Pyth stops publishing an equity when its market shuts.

```
band     : 5 percent over Equity.US.AAPL/USD at 343.4350 dollars, from Pyth shard 7700
price    : usable, published 15 seconds ago of an allowed 3600, confidence 2 of an allowed 100 basis points
account  : 9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb, fully verified by the Wormhole guardians
curve    : 400.0000 dollars a share against a ceiling of 360.6068, so every buy is refused
```

| Attack | Invariant | Expected | Actual | Result | Signature |
| --- | --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | ok | `4wj9oiAEXJhvBaJgYbL7rPKnc7U8Sp6GNTqgTqYbBLr9spFNfwaaz11JeRe1CdBvnMYvv5BAvqUpvHo3hQPcKuKZ` |
| buy while not on the approved list | C6 | NotApproved | open access, no list to be left off | skipped | not run |
| buy past the cap in one go | C3 | PriceOutsideBand | PriceOutsideBand | ok | `WdP9LtJJuHLmuVbmfEoYiuXpUFV9LB61TCJ4aXKsaV68ToXirizWjfMKRborVun7E2G7GmUA93wkPsfLRpBM5pq` |
| buy while the curve stands above the ceiling | C9 | PriceOutsideBand | PriceOutsideBand | ok | `3fZ1QvhWAppPDeQ6gnRC1T2te7czBFio6i7QxxtQc2HrFnNd9iiJ7ni3qPWfYEd7KMcn82tXhoXzcbdCiYkUPWfU` |
| a second buy that crosses the cap | C3 | OverCap | no buy can land to set this up | skipped | not run |
| buy into a second token account of the same wallet | C3 | OverCap | no buy can land to set this up | skipped | not run |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | ok | `3HQMFmfeqcba3jzGENb9M3rGaFrNg1Z4FrzNJfgzx1CSzKZFZPfYqeM61C2tpHcXTQgW3QYK7sx2Q52W5vMk3rG5` |
| send tokens straight to another wallet | C4 | WalletToWalletDuringSale | no buy can land to set this up | skipped | not run |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | ok | `mfYzptwt2jZb9Ar3nthY3Mj913B3FrNNFKHYLFyG9bHwPqjdrCDGG2K1UVwmFksEQpQSf52q1r8rrrsRZMV91RP` |
| a revoked wallet sells back to the pool | C5 | it goes through | nothing to revoke, open access | skipped | not run |
| buy that would push the price past the ceiling | C9 | PriceOutsideBand | PriceOutsideBand | ok | `5KJGDNGjZRxZcPM9pg1R9ZuhKfwKMdcm4Uijm7bbsKUCHvS9rcVYSz6iQ2rXaMNiaV3fgDa9Ep44EBo5khAA72rj` |

```
6 attacks run, 6 refused as expected, 0 allowed as expected, 5 not applicable, 0 off the standard
```

## The demo, checked again at the end

```
program 4Nd46mDi...         PASS    executable, 358248 bytes, sha256 a937c610ab35 as recorded, slot 502476730
sale PLIST 2ARD1Kwv...      PASS    list, 15 buyers, graduated
sale POPEN CBckMjBp...      PASS    open, band 500 bps, 0 buyers, running
band POPEN CBckMjBp...      PASS    Equity.US.AAPL/USD published 2026-09-22T15:04:08Z, 70 seconds ago of an allowed 3600, at 343.44 dollars
pyth key                    PASS    HTTP 200, Apple published 0 seconds ago
wallet demo 9QTJCGx2...     PASS    holds 0.7591 SOL
wallet project Fwi8ejZ8...  PASS    holds 10.5379 SOL
app                         SKIP    APP_URL is not set in .env, so there is no site to check
7 passed, 0 warned, 0 failed, 1 not checked, at 2026-09-22T15:05:14Z
```

## What the fourth run cost

| Command | Cost |
| --- | --- |
| `deploy.sh devnet`, two attempts | 0.001785 SOL, from the project wallet |
| `launch --mode list --cap-share-bps 1000` | 0.018892 SOL |
| `seed` | 0.078416 SOL |
| `prove` on the list sale | 0.018713 SOL |
| `graduate` | 0.119753 SOL |
| `mint-dollars` | 0.002575 SOL |
| `launch --mode open --band 500 --quote <dollar mint>` | 0.019273 SOL |
| `prove` on the banded dollar sale | 0.007609 SOL |

The demo keypair held 0.624379 SOL before the run, took 0.4 SOL from the project
wallet to give the whole run room, started on 1.024379 SOL and ended on
0.759148 SOL. The project wallet ended on 10.53791508 SOL, which still clears
the 1.9 SOL an upgrade's temporary upload buffer needs several times over.
