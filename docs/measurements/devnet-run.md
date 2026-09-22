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
