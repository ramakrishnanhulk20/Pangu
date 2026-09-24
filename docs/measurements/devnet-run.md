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

Program slot **502373496**, the build carrying every program and SDK review fix, put
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
and fixing it was outside this run.

## The price refresh, three days before Switchboard shuts down

`npm run refresh-price`, run before the banded launch, answered the way the first devnet run saw
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
cache, an undocumented field inside a third-party package. Switchboard's announced
shutdown on 25 September 2026 was reported by [Crypto
Briefing](https://cryptobriefing.com/switchboard-oracle-shuts-down-migration/). **A live price refresh cannot be promised at
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

# The fifth run: the demo sale

Same program, slot **502476730**, no upgrade. This run opens the sale a judge
lands on first. The 400 dollar sale from the fourth run refuses every buy by
design, so the front page showed nobody holding anything. This one has holders,
a curve price rising toward the ceiling, and a raise measured in thousands.

## The demo sale

### What it had to hit

Open access, a cap of 10 percent of the curve, a band 5 percent over Apple, an
opening price about 20 percent under Apple, a ceiling that bites after 60 to 70
percent of the curve's shares, and a raise of a few thousand dollars. With a
billion shares those last three cannot all hold, which is why the fourth run's
threshold read 360 billion dollars.

### The curve arithmetic

Meteora works the opening price out from four numbers: threshold times the
share kept back, over supply times the square of the share left to sell. With
20 shares, 45 percent kept back and a 3,700 dollar threshold that is
3,700 x 0.45 / (20 x 0.55 x 0.55) = 275.21 dollars, 19.6 percent under Apple
at 342.445. The curve is one stretch of constant liquidity from there to
275.21 x (0.55 / 0.45)^2 = 411.11 dollars, selling 11 of the 20 shares. Apple
plus 5 percent was 359.57 at launch, which the curve reaches once 68.8 percent
of those 11 shares have sold, about 2,380 dollars into the 3,700. At 40 percent
kept back the same 20 percent discount hits the ceiling at 37 percent of the
curve, and Meteora's own builder refuses 50 ("SafeMath: subtraction overflow"),
so 45 is the one value that gives both.

Three flags made this possible: `--supply` on `launch`, `--migration-percent`
raised to 45, and `--seed-to-share` on `seed`. See "What this run changed in the
scripts" below.

### Launch

`npm run launch -- --mode open --band 500 --quote 2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5 --supply 20 --threshold 3700 --base-decimals 9 --migration-percent 45 --name "Pangu Priced Share" --symbol PBAND`,
22 September 2026 at 16:31 UTC, 0.019283 SOL. It printed the arithmetic above
before it sent anything:

```
curve    : 20 shares of 9 decimals, 45 percent kept back for DAMM v2
price    : opens at 275.2066115702479 of the paying token a share, ends at 411.11111111111114
           Equity.US.AAPL/USD at 342.4450 dollars, published 0 seconds ago, confidence 2 basis points
           ceiling 359.5672 dollars, reached once 68.8 percent of the curve's shares have sold
cap      : 1099999999 raw units, the most one wallet may hold
```

| What | Address or signature |
| --- | --- |
| Mint | [`2dp5caL9PPVWafYkmNHBdHEX6zWfG42BmERcnLK75N4Y`](https://explorer.solana.com/address/2dp5caL9PPVWafYkmNHBdHEX6zWfG42BmERcnLK75N4Y?cluster=devnet) |
| Pool | `DyPagAtAHuip7duYL6wMeCswCH6BWxLNSavuvFhtW8MZ` |
| Config | `J62Yg3uqgjXggYyE1Vsh8XwF3RXJB4nEksveyEHri5nQ` |
| Rules | `2UXqmHrSPyh7bdnKafoHdjtgqvRsahQCEw5wTuzBSBrg` |
| Extra account list | `HHZUyy1VFNHgqTb4EWZaxkoeNg1EiLmb6GdpiRX7i5g6` |
| Paying token | `2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5`, the fourth run's dollar token. The demo keypair still held 776,800,000,000 of it, so none was minted |
| Pyth price account | `9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb` |
| Price refresh, before launch | `4bK5UyWmrovNkJtEWUFVxEzATSGWLA5D8APZ2c1pJwDM6MmmrWVdARMYbDNW5Kz5ebGNJiBZSfNCXKDMe5sbToWK` and `3ReZmgY5eN7xDq9ZeaYVRy5UNE9LJeswr5HriGb6Dy5u45j2tq6JgRVgCp6jracuTZ6ZrZzCkrPZ4FAiwYz8aYpC`, Apple at 342.5151 |
| Price refresh, by launch | `42KxFdd7GDLjegfrBZfueDTudoot3Fx8kKe6CQiqqc7T6Y1pSnh8HrAqwBeJJJAjG96gYaTTassk5Mt6DFngxYzV` and `56TsXtq3RPARgWyBroGXBxoS2vUzuNp9bPUPzRyGVA3o3BzchY2bLQt9LAQL96VTy1LMacNJbb61AgehDvNx1nJ8`, Apple at 342.4450 |
| Template | `5PTjF7Tz6dD2MKYFxLbgqepBdyfXfA2qUtB6UhAvHwr5anFo2Lwfior4Yk6GDN429ac1jGTfwQm54k2XcvLjwqof` |
| Sale | [`43HWjxMtisTZdt3Vw2D1C3Rh8WtCeypHLgPonKNrHnGdUmUffuiBace1JopDbinsvLvYVibAL8KD5MSn2k8dwjfo`](https://explorer.solana.com/tx/43HWjxMtisTZdt3Vw2D1C3Rh8WtCeypHLgPonKNrHnGdUmUffuiBace1JopDbinsvLvYVibAL8KD5MSn2k8dwjfo?cluster=devnet) |

### Seeding it

`npm run seed -- --seed-to-share 57`: eight wallets with eight different
weights, each handed exactly the dollars its buy spends. The public devnet node
rate limited this hard ("429 Connection rate limits exceeded"), so it took
three passes on 22 September. The resumable top-up in `seed` is what let the
later passes carry on from the chain rather than start over.

| Pass | Wallet | Raw units | Share of the curve | Signature |
| --- | --- | --- | --- | --- |
| 1 | 1 | 243,718,804 | 2.22 | `4JtnrbLWDhhQNpSTdzM5n2mHG7ZTia4zKeoRCpB72JfBZwoWpeSNAPVyc1oRk3CB69gKfXHzVzh8YAMnX2TH5cqQ` |
| 1 | 2 | 1,024,077,593 | 9.31 | `3KXKTF22rK3Y97Fb2wiVHtqAtJytyHrtNtdZqwKG3DujRAnsTqiAbczR96RoMtSwfRsM3U6sFgbZRVZV52uZR8RP` |
| 2 | 3 | 461,809,058 | 4.20 | `5pLvh2ZXtAvMad9ChQaAzKrC9rm2GTETe9F1LLEycuf6jCiS7CLUUWjUTYaTUCtkiTYQ8EtAA9tpTWz9wvE6DTu4` |
| 2 | 4 | 384,026,189 | 3.49 | `58JHJfJ8ZzuM9xxrNDc52H5FBhStwZ6ffRPv5ctBzpMaqGZ9WE1uak9Z19SDsV33AgrzpAEVvkWtapgTaGS7sH46` |
| 2 | 5 | 585,676,982 | 5.32 | `32FCiF6BCvKiY3ijqMGNRL1GVBReTw8R2vXSyGdLruWFPS8kDzPXu6bKwmzxJBEAcctWM74VBu5CobVwWcwLjZHd` |
| 2 | 6 | 834,036,845 | 7.58 | `5i66DQ7aKdxJTGNQdk944gRns9x6pZPDuF2JMrfpRsk9fP8crWEHwTWXasSBgyJLBUqEbxtQUgZT9RZZ3G2AFcm6` |
| 2 | 7 | 645,265,646 | 5.87 | `3Zduzn8U2kUfDH3S294ncZwpJYSRES1tZzcotQkeYpmybKpaS7zGvzHWGvusGFWW6taWRnxeHGHN9XjSi835uGA2` |
| 2 | 8 | 807,116,294 | 7.34 | `3La8Pu8nr9zHwUTyaK5VeyUgcxD33XeUZTYJpiP2PZS2Vys6pmVkTRN1RjRv5ArKtZ5V6J62M9bggkubpT5pBt9L` |
| 2 | 7 sells a quarter | 161,316,411 back | | `22RrWp8B2Urh5xfmzUk5HLrm6SRX6aB1xGwFSifUw9Cmw6xKYshNi3iZsGcvxjaHmkFqBLPc44jWKqVKozxGvxse` |
| 3 | 1 tops up | 112,621,939 | 1.02 | `67ir3gjQYE31gikxrgNSfHH8VxFoRSS3yeSi2bWSpsSv4ShVuXeoWQ9nizAAppaqQGq6baxvpeF1N3ctfNXzPYtU` |
| 3 | 2 tops up | 75,629,513 | 0.69 | `2ozL9K1jFoKNjaCS7awTaBFcDxGfcRxCrXVa5eV1YPKKN7a9HYHGh2X4NPrswZuiBLtNo9wahwfXM2HqiiC3P6hR` |
| 3 | 3 tops up | 158,124,373 | 1.44 | `55MXsCbhwWewQpsnVgTyAt7nnGsKBxnbj7qzYcXknDrQAzMGRyqe96uQE4JxV8CGwZJecmQfC5mR68Sik4fknyik` |
| 3 | 4 tops up | 258,475,944 | 2.35 | `4cEsa182Qj1tKLARyN78zNzqmXisXBVVfYHPLRC59yK8xEraFr5RUn5iGoJd1THoseZWLSHSwRmn2rLdDTvF53or` |
| 3 | 5 tops up | 172,965,803 | 1.57 | `36jCe9irs2FAKyTBV5FByb9GcyAu2gvmvWtH59gF59Bf4RGXa7ao6zaypZbfnN5FpcUzTKXiUkZRUfrN4V7Mg4v5` |
| 3 | 6 tops up | 245,069,203 | 2.23 | `5fNcEPXhQWQwpmurq1vNW8wdhGN9nFDtT7bEESu4khKbZ6AdnKe9BLK1GYNkMJB6dPfF2fSfB7sdw7VQxZLiRQqv` |
| 3 | 7 tops up | 188,362,038 | 1.71 | `2dTSv9aM7BtSCUsuPh625ftkk1wx5TD3viiWowamFxkgDZGZx88sfWyFbFj6rHcPuziKB1Z5zxgthxnC8jELCBGp` |
| 3 | 8 tops up | 232,755,370 | 2.12 | `4d1J3tUd9GZsBy3H62Y83UJFZaLTKLNesCaqTwR4VdzVBNGydRLw6rttgHCHfCiszMwyG4XwNjZPfasDTbQ4YKGp` |
| 3 | 8 sells a quarter | 259,967,916 back | | `2z72EiwsycWxsPs4zXfvowMv7oM7Hg9pFVJxSEJbzx3QAHiUBDq36wQ4wiexhBvpTi1wKn5wQJdoDZxxkg3RQY1M` |

The first two passes came out at about half their planned sizes. The cause was
the node, not the curve: the search inside `buyWithin` reads every failed quote
as "that size does not fit", so rate limited quotes walked the size down. A
double count in the new target logic, which counted a skipped wallet's holdings
as sold twice, made it worse and was fixed before pass 3. Pass 3 sized each buy
straight from the pool's price with at most two quotes, and a quote that will
not answer now stops the run instead of shrinking it.

After pass 3: 8 holders, 54.62 percent of the curve sold, 339.2433 dollars a
share against a ceiling of 359.8561, 5.73 percent under it.

### A prove run cut off halfway

The first `prove`, at about 17:00 UTC on 22 September, was cut off after it had
filled one wallet to its cap and made the careless wallet's normal buy. Its
throwaway keys lived only in that process, so their tokens are stranded for
good: 1,054,496,175 raw units (9.59 percent) in
`2Sj7r6uTqhrmm58hJS5pZpmNWpR3BqFkKZVsRzMzRjTW` and 208,431,229 (1.89 percent) in
`BYCDXQS1YtQENheEQaSyV8kb8i9f4iwAsXV2aU6HRXs3`. Their devnet SOL never came
back either, because the sweep runs at the end. They are two of the holders
below.

On the morning of 23 September the chain read 10 holders, 66.10 percent of the
curve sold, 355.5323 dollars against a ceiling of 357.6143, only 0.58 percent
under it. That is too close for `prove`: its over-cap buy would cross the
ceiling first, and the hook reads the band before the cap, so the refusal would
be `PriceOutsideBand` and say nothing about the cap. The seeded wallets are the
only ones that can still sign, so `seed` learned to sell back down to its
target, each wallet in proportion to what it holds.

`npm run seed -- --seed-to-share 52`, 23 September at about 06:38 UTC, after a
refresh at 06:32:17 (Apple 340.5850,
`4EUMnWrqx6APunn2gcLRQhpqoJhtnjPYZFvMnnmBKLbfjdNFkhSUupx1b8iWCoXnzDKnMveXQu1LBKwDnzSTJFQy`
and `5gUYXzxwizBsNcePnJgwKWLnxnutXHerYpvvmD8ypahbY2nCmgmVxTLc17fHpmfnLQCeiGFDqdGNrESR4RgEKCm6`).
1,551,374,677 raw units went back to the pool and the curve stood at 52.00
percent:

| Wallet | Signature |
| --- | --- |
| 1 | `2fPctT18YVfmxNeeJD3GgJQc31Z1uGLh9f9AbXSneATQXCDgmoPWo9LDFvtXSteoqMtVsbZXktTmqy8DfHS9D2br` |
| 2 | `2nw8kL6SFCVa2s2eaYs47oEJxfpPpBESW2TafHTzZcYCzmM4VpV5Y72i45xRaUgZyNNZJKdYZUBjsEz1HhBhn8rk` |
| 3 | `4mvyVUB9hwtiLtyBhp1h6nMV8yyZt5h8VMqXRNCiPPx6pMF1T7dyPN1NLQ35DNcjaocZn6AHqSLnUaBcVvXQc15y` |
| 4 | `3iFajWpktEdXWEPoUseQNSwCkxwXbX4kMVYfBhQZS9pXN2MyuEsoS3zZFkjyMcuZVqpo2cky2mUHoiRJ9dUDcCLS` |
| 5 | `41krzU923x84qR1if7RP8aFdZk5S9E8mNPiyJMg5qVzLeACoB37FMgxpt1oD6hrYLmqhybVKqeg92gekE2bwtkRt` |
| 6 | `43cbxmHAMkTxhW323s9mAgcdwiJGGeV3j4g7BLziNj7ejz1dVqrU45QNJFtGk4LevpdJNXaNFWSy3zJqWYtTsDty` |
| 7 | `3K7i1fdrPMksoCEtLczn6F6hr6bwfDxwM9Rn8y8nD6Rm74WhCQiy8Wb5UqLjpWauNtJspmP3ous1btfhdwCfFr1u` |
| 8 | `5PGgATsu5fXVeh4PcjX4TiwfCoQASP9R8AK1L4XYfmPHW1PgBf4Ey125bgqmXydp5VtUUGMREG7kBymrGazQecsm` |

Why 52: from there the over-cap buy, the fill to the cap and the small buys all
land under the ceiling, and after them a buy the size of one cap lands over it.
The window where both hold runs from about 47 to 56 percent.

### Attacking it

The first full `prove` on 23 September came back with one deviation. Every
OverCap row and the sell-back passed, but the ceiling row was refused by the
token program instead of Pangu:
`3PT4B8sPJfx6LGXR5uAtLA2P87RDPY7UAFfzYUHwEmXCX8a3WU8XZF4BjqxB93tsLMqn4Si2kFkZhHinnLd9NudF`
logs "Error: insufficient funds". The attacking wallet had been handed the
cap's worth of dollars and had already spent a small buy. No earlier run
reached that case, because no earlier banded sale let a buy land. It is now
handed both. That run's own buys had taken the curve to 62.90 percent, so
`seed` brought it back to 52 again after a refresh at 06:45:53 (Apple 340.5900,
`67CKgjDRQnhaUTvqZmekCxyV4PXKAN9yeY4GB6Ss5vqezPN4jT3aRqWtYdK56tAFyMvq56wmga4AXJAGb1dz6uyw`
and `28eiYTE54Sz2cz7y9fMtvCk7UPcmaqicKUmxg3tLuNrnh3CsxbKCXPUWUbaFdZuQyV1d7qsNZKM1N5gc1pv8Kuoi`),
selling 1,199,202,357 raw units back:
`yZsYtVNauwHZcSfz1xqHRMuAQK28aTSEnAp8USJNyeXnMjgEeRJQfkzNHpN9mPiyN35FR4hqbvggLYNffEFh1rg`,
`2Xo9wp4CGoxjeZe6v9RrQhETKA3RaU3r95UNvWeA4aEqzLAXf5ywdVXA1THXWS8iXjug6piVp9YharAz7LqawHef`,
`38KRiRwCpmQue97RPbYSVJiUF4FVe8qnx7G1RBs2EDcaAbPxmTB6v5v1y2eJ4ETqsvpfZtJyN4yCuBS8LNZyKTKu`,
`4xujeRtALmcLHUYpX2GqjBg9H9SEPqEQXrxFUWfH8GwkYLHECZbSs7TnAZ9hYF9sTGhnxb8XyjdKEEQKzHJP6ev`,
`SsMmqy1BsAgr7EPDGGNpcLZx7obmgDvDxu7eiDRrd3hPSQKtJbTuMriGqdNs79NmfFTznMga52upAVhdf3HaY4J`,
`2zopbP5ksZPqvaLRU9sSkCUPSkksnFGnF7nJkFKgPUCvgw5ETFDpmoj2sfmELkE7NLsyJnDPp2rusXjtmdsdhRyq`,
`33QT5TVKe8o5cdjcAxBQKfeQLLBUSpk4LEA2grDpeDqYLN3CoBA7LDaSytqWqqTdX2k3F3NXjRj8jpWdhPpgFEy9`,
`4YYfFxooxSPXso16mFbqLctroaz1uFKhGtK864yhzTExoxtGVRsFrsSXjxeZAyCWUp5XPWUbsz3dTxjhJN4gm1zp`.

Then `npm run prove`, 23 September at about 06:52 UTC, exit 0. That is 2:52 in
the morning in New York. Pyth was publishing Apple in its overnight session, so
the price was fresh and the refusal is the ceiling, not `PriceStale`.

```
band     : 5 percent over Equity.US.AAPL/USD at 340.5900 dollars, from Pyth shard 7700
price    : usable, published 310 seconds ago of an allowed 3600, confidence 1 of an allowed 100 basis points
curve    : 335.6801 dollars a share against a ceiling of 357.6195, so there is room under the band
filled   : one wallet holds 1054603637 of its 1099999999 raw unit cap
```

| Attack | Invariant | Expected | Actual | Result | Signature |
| --- | --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | ok | `4p6KZFmzx9U1VcgSApZqirHYUW3ZM8pmgUUE39sngkgDnkCjRaWmgkQiVVW7Xb8FyZGmv2aQhbjXBAQPbN6E4NsN` |
| buy while not on the approved list | C6 | NotApproved | open access, no list to be left off | skipped | not run |
| buy past the cap in one go | C3 | OverCap | OverCap | ok | `3c6qGyPfE3Eg5BW9yGHMfx3tRueGtnoEbfHDp1Gzzr7m5WW2iQahkAsVHWmhZUePNMNJnGD8WNq24ZBToM9vGWrp` |
| a second buy that crosses the cap | C3 | OverCap | OverCap | ok | `33S5coVwXvybSwSNYum5ibtYEht428XNJNHf2Hk2bJytiFVmgcgK9GK89gVMZjma5ijyRrNAY3MRrygiMNh1A31S` |
| buy into a second token account of the same wallet | C3 | OverCap | OverCap | ok | `5g7H5CyMmJMWUzevGiU6ESxtSGrVT1xKuSrk9FHKvWP8gXF1HyZQP3QKrQWmAiTceQe4woUYTf95y5iCA3LXXCPH` |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | ok | `267in58cehTWpkVbQWA6AAncru8rUuQzBxy5Rk1ZFivEogdDdwQu5tyYJ6rxv6G8wWwkV84H18aF7JrXh3DgibLN` |
| send tokens straight to another wallet | C4 | WalletToWalletDuringSale | WalletToWalletDuringSale | ok | `bcCHhpZtJRyUbLjwPiXbqfeVTtyao8MNv7NkdWvEZxmfc1C1Fx1N7ybhaQ6GKmjuurjxsV3BivWvL776eN967PE` |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | ok | `Gja1LAfe95AcUrokwnUPfsifC6SYWnrzeZeADuXTA5Ss9FkTuf9hJysm5ZJdfozyy3sXQivx7y6kCNzKwgnYt6x` |
| a seeded buyer sells part of it back to the pool | C5 | it goes through | it goes through | ok | `qqViNjapRzinafLkymNCQokhJuCEBP5EmLrj9dNkgq7FkVoQTqB7JnitHBmQzNeHsCXNkZodExabjJKfEYiVoqe` |
| buy that would push the price past the ceiling | C9 | PriceOutsideBand | PriceOutsideBand | ok | `3FMhcSoCkFCp3PBMBjaejwEiXVmdDAREJCDaP2bYw2u2hGxanesdx5vi2cEU2ZMK1obRZhcUgWFKQ1tqMUy8sXDU` |

```
9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
cost     : 0.011307 SOL, after 0.029169 SOL came back from the attacking wallets
```

This is the first run where the cap and the ceiling are both refused on the
same sale. The cap rows come back `OverCap`, which the hook only reaches after
it has checked the band, so each of those buys was inside the ceiling and too
big for the wallet. The last row is a buy of the same size one step further up
the curve, and it comes back `PriceOutsideBand`. The sell-back is the new open
access form of C5: with no approval to revoke, a seeded holder sells a quarter
of what it holds, and the hook lets it through. A sell never reaches the band
check at all, because in `execute.rs` the branch for a transfer into the pool's
vault returns before any buy rule is read.

### Where it stands

Read off the chain after that prove, 23 September at about 07:00 UTC:

| Fact | Value |
| --- | --- |
| Holders | 14: the 8 seeded wallets and 2 from each of the three prove runs |
| Sold | 6,949,259,034 of 10,999,999,990 raw units, 63.18 percent of the curve |
| Largest holder | 15.18 percent of everything sold, against a cap worth 15.83 percent of it |
| Curve price | 351.2680 dollars a share |
| Ceiling | 357.6195, Apple at 340.5900 plus 5 percent, so the curve sits 1.78 percent under it |

About 0.2 of a share bought at that price takes the curve past the ceiling, so
the next honest buy of any real size is refused. That is the point of the
screen.

## The list mode path, proven again

The changes to `prove` touch the list mode run too: the over-cap buy is now
sized from the cap's live worth, the fill to the cap is aimed rather than
searched for, and the careless wallet is handed more. No unit test reaches
those, because they only run against a live curve, so a fresh list sale was
proven on the changed code.

`npm run launch -- --mode list --cap-share-bps 1000`, 0.018892 SOL: mint
`4kzCbpEZxyzwXno1ZVnTJ9BAGSjD1HVgSBSwikEsxeaE`, pool
`74WGtHWKysNrcKPA2nd34FMobHefnNaWexZijuUAg5ks`, config
`HLQMKN3jKvCVjUxi3pvCYPiFpUXRFRQCy7XdcL2oHgMs`, rules
`4WsZvWcjVPdQWqxRmQeCiA6JAJJpVZVp4pwuEFe4M9CL`, extra account list
`Cstprk8HjzqRXmSiDVeFLiDxYQSVfYuLA7nDwJR5hHQM`, template
`5q3d9eHZzFAC8nQGG2Uqb4XUJJgwMCnmu9wsMcC1TzSaQMpDV6wCP2GDpR8r7AuseJ7bHNwxQm4wCh5sGP3ncJhD`,
sale `5fsSjFcL1sCebXZYSx5D947QbMziHstXv5KhABoGMQeU5S7RoMvCnuJT5J6cmkQjzKb4pMoDwG43whyQbJoR2hMx`.

The first `prove` on it stopped with "could not build a buy that passes the cap
on this curve" after the first two attacks (0.002179 SOL, 0.099975 came back).
The cause was one number read two ways: the curve price was read through the
quote decimals in the sale's rules, which are 0 on a sale with no band, while
the cap's worth was scaled by the mint's real 9. So the first try asked for
millions of SOL. On a banded sale both read 6, which is why PBAND's run was not
affected. Both now come from the mint.

The second run, exit 0:

| Attack | Invariant | Expected | Actual | Result | Signature |
| --- | --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | ok | `629M5Df1hXZJj6otfZC7NMiRZ5MUnxy5k9dr5LUoQAuYJkoZ5cvRZThbAxqHrN4PZ9bBuUByGVfSKYMt1d23GyAB` |
| buy while not on the approved list | C6 | NotApproved | NotApproved | ok | `3E4M3zTaFQURDt1tVMgYQyP4nJkKaSZ4T9kPR51kyekGLdBnAy34royCaskmuNeStpbbyHu8QZ3mV1yTVZmoL3Bd` |
| buy past the cap in one go | C3 | OverCap | OverCap | ok | `4aEakE16QDXtXGdLEEuApc9dvr7jW3yg6AfgKGwEkANpddw2nLuYc449A4inZ6krkDjVxn8PjSvdaqNJpXczNkdT` |
| a second buy that crosses the cap | C3 | OverCap | OverCap | ok | `2qJ8WdWdyzkkyuB6kNtQ9BvajzFkSHbHkzWUorK6astWDWcCNChKkkeqKpBYoV7nq6QbZLB1WcKypV4xUg6z9LYe` |
| buy into a second token account of the same wallet | C3 | OverCap | OverCap | ok | `356xjwfQ2SJUmbdzmgi3NVNr8DUPD6q9rGeXgmMgBQKNnaxX7w2dHr7QSfLEULaEH7QAajDoUWunEu5vEQk3Lxqx` |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | ok | `CpeFLx9Jnhnxujw3YMLVGDbgGEPEe5Vssi5mFUYJpkrm7GNuygXWLutESiCNQAa5P3V2HFFi3o1Ueem414opAve` |
| send tokens straight to another wallet | C4 | WalletToWalletDuringSale | WalletToWalletDuringSale | ok | `23dt6rtJ9w7NYP1o9WzhUZM9xuisy39ANNxy5jXvotCqGfVeuYENjte8yd28CVAdL5FcMhwY2uzpAUtVrPBaHA9Z` |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | ok | `3N2JgtUHMFhLFDZ1pYbFpfcCvnzKAAz7YvtahXDGxk3ALo7dqbv79vwEaf5XB947a3pFHjy1CPrS7QzQhCHQqsB5` |
| a revoked wallet sells back to the pool | C5 | it goes through | it goes through | ok | `3cJ6VwT9riVvjvZ4RAHFQcZthYrmxvteYrh3We2e29aiYKkb1Gxjg5YukiwruVqFhgXfNyccJuGMFsFsouDhwd3G` |
| buy that would push the price past the ceiling | C9 | PriceOutsideBand | no price band | skipped | not run |

```
9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
cost     : 0.014288 SOL, after 0.087870 SOL came back from the attacking wallets
```

`launch` appends every sale to `sales.json`, and the app's sale picker opens on
the newest one still running, so this list sale would have become the default
ahead of PBAND. PBAND's entry was moved back to the end of the file. It is the
sale a judge should land on, and `prove` and `graduate` with no `--mint` still
work on it.

## What this run changed in the scripts

1. `launch --supply`, with `curve.ts` taking the supply as part of the shape.
   `openingPrice()` used to assume a billion shares and printed 0 for any other
   supply. `launch` now also prints the price the curve ends at and how far up
   the curve the ceiling bites, before it sends anything.
2. `--migration-percent` runs to 45. Meteora refuses 50.
3. `seed --seed-to-share`: eight weighted buys, sized in the paying token's own
   decimals, each wallet handed exactly what its buy spends, stopping at the
   target, topping up wallets that already hold on a later pass, and selling
   back down when the curve stands above it. Without the flag a SOL priced sale
   seeds six even buys exactly as before.
4. `prove`: the over-cap buy starts at the cap's worth at the curve's live
   price and grows 5 percent a try; the fill to the cap is aimed, not searched;
   open access sales get the sell-back row; the careless wallet holds enough for
   both of its buys; the curve price is read through the mint's decimals.
5. The gap between calls to the public devnet node went from 120 to 300
   milliseconds, after 120 drew minutes of 429s.

## What the fifth run cost

Three devnet faucet requests were refused ("airdrop request failed. This can
happen when the rate limit is reached"), so the demo keypair took 0.6 SOL from
the project wallet at 16:29:39 UTC on 22 September
(`GaY4BTz1eTyL66PmfidvPCrWBoHC4YeSbzCMYnNia1YUZKMjaWo8QUG5vz3f9CRixZipS5aw5RiLybSa7pWCchd`).
It held 1.00313891 SOL after that and 0.7048 SOL at the end, so the whole run
cost 0.2983 SOL. Six minutes before the top-up, at 16:23:09 UTC, 0.050005 SOL
left the demo keypair in
`2buiGGvASCZaue8uvGKrZU2kxsNNyejXM4aqfZ1tnvGWMg5XrhnbHMLyyxaJPov2VPSds7UJHLGXFNAb9RAXTG6u`.
That was not part of this run and is not counted here.

| Command | Cost |
| --- | --- |
| `refresh-price`, three times | 0.000105 SOL |
| `launch` PBAND | 0.019283 SOL |
| `seed`, three passes, and the `prove` that was cut off, together | 0.2209 SOL, worked out from the balance because none of them finished with a total. About 0.1 of it is devnet SOL the eight seeded wallets keep so they can sell, and 0.036 is the cut off run's unswept attackers |
| `seed` selling back to 52 percent, twice | 0.000100 SOL |
| `prove` on PBAND, the insufficient funds run | 0.011307 SOL |
| `prove` on PBAND, exit 0 | 0.011307 SOL |
| `launch --mode list` | 0.018892 SOL |
| `prove` on the list sale, both runs | 0.016467 SOL |

## The demo, checked at the end

```
program 4Nd46mDi...         PASS    executable, 358248 bytes, sha256 a937c610ab35 as recorded, slot 502476730
sale PLIST 2ARD1Kwv...      PASS    list, 15 buyers, graduated
sale POPEN CBckMjBp...      PASS    open, band 500 bps, 0 buyers, running
band POPEN CBckMjBp...      PASS    Equity.US.AAPL/USD published 2026-09-23T06:45:53Z, 1366 seconds ago of an allowed 3600, at 340.59 dollars
sale PLIST 4kzCbpEZ...      PASS    list, 2 buyers, running
sale PBAND 2dp5caL9...      PASS    open, band 500 bps, 14 buyers, running
band PBAND 2dp5caL9...      PASS    Equity.US.AAPL/USD published 2026-09-23T06:45:53Z, 1369 seconds ago of an allowed 3600, at 340.59 dollars
pyth key                    PASS    HTTP 200, Apple published 0 seconds ago
wallet demo 9QTJCGx2...     PASS    holds 0.7048 SOL
wallet project Fwi8ejZ8...  PASS    holds 9.9379 SOL
app                         SKIP    APP_URL is not set in .env, so there is no site to check
10 passed, 0 warned, 0 failed, 1 not checked, at 2026-09-23T07:08:33Z
```

# The sixth run: rules v2 live, a second demo sale, credential mode on devnet

Program upgraded to the rules v2 build: slot **502899538**, sha256
`191e9cf1ab6f9ababc1fb50c1f279b7f19e305934fff0952f8155b4f85a10731`, deploy
signature
`4GQ2J5s1QmypeiDfeRwCGpZN13TpmMTQoXNnWnQq3jtxFW88cudEr5fjyxA9c8qbBitT5JuC7AHRgtSCGaUpokZ4`
(see `docs/deployments.md`). This run does two things for the first time on
devnet: it opens a sale that carries an offering period, and it proves
credential mode against the live program. Every command below ran from a
Windows shell on 23 September 2026. The public devnet node rate limited it
hard ("429 Connection rate limits exceeded"), so the commands were spaced
a minute or two apart.

## Before anything was opened

`npm run sdk:refresh` in `packages/scripts` and `packages/web`, then
`npx tsc --noEmit` in both: clean.

`npm run status`, 10:25:21 UTC. The program row showed the new hash, and the two
version 1 sales still open, PBAND and the graduated PLIST, read exactly as
before on the new build. The one FAIL was PBAND's price, last written at
07:50:00 UTC and 9,327 seconds old, with Apple's market open. The rows that matter, and the total:

```
program 4Nd46mDi...         PASS    executable, 363720 bytes, sha256 191e9cf1ab6f as recorded, slot 502899538
sale PLIST 2ARD1Kwv...      PASS    2ARD1KwvxyjLPwe46rivjxPRyMzvxSEPGvwKTqcNXpFR, list, 15 buyers, graduated
sale PBAND 2dp5caL9...      PASS    2dp5caL9PPVWafYkmNHBdHEX6zWfG42BmERcnLK75N4Y, open, band 500 bps, 16 buyers, running
band PBAND 2dp5caL9...      FAIL    Equity.US.AAPL/USD published 2026-09-23T07:50:00Z, 9327 seconds ago of an allowed 3600
8 passed, 0 warned, 1 failed, 2 not checked, at 2026-09-23T10:25:21Z
```

## Funding

The demo keypair held 0.397240949 SOL. Three faucet requests, at 10:25:42,
10:26:31 and 10:27:19 UTC, were all refused ("You've either reached your airdrop
limit today or the airdrop faucet has run dry"). `devnet-send.sh` moved 0.6 SOL
from the project wallet at 10:27:53 UTC
(`24yrCQ1RpZveqSheXdPoAdhCHfZkV3R6uASC4UntnGwobGTbUm2zLcvUL4bFyu1i7gn7KhK3pNVsxHSXPWdgS7r4`).
After it: demo 0.997240949 SOL, project 9.33609008 SOL.

## The credential sale

This one was opened first on purpose. The page opens on the newest open sale,
and the credential sale is not the one a judge should land on.

`npm run launch -- --mode credential --cap-share-bps 1000 --no-end`, 10:29 UTC.
Priced in SOL, no band, no end date. With no `--credential` or `--schema`,
`launch` opened the paying key's own verifier, so a list of one: the demo
keypair is the only signer who can attest a buyer.

| What | Address or signature |
| --- | --- |
| Mint | [`7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn`](https://explorer.solana.com/address/7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn?cluster=devnet) |
| Pool | `F4RJrH1MV6GTBZ73q4txHfCisBbyzQoMXtqE4nm5Wx8T` |
| Config | `8Hos7ZkAoYmBwETL8mzRdZHzYXDKQzHu75YFxAKNwtwD` |
| Rules | `BmuYEvTj3p2AjRpNqtrSxXsubkZsMoSCS2Cu49sLjepf` |
| Extra account list | `4uxRM3w85dm6pxsjHTvjHMk9MBE2BLQNpz6wrhTvQ2Sa` |
| Credential | `GWoT99X9CMhhJhY71KN7NNjLnB7gdWhfhG4cTW9DWXqY` |
| Schema | `FQ2XX4ht6gYgqzJdUTqrr6c2hzELiBZdqKMj92qur9rG` |
| Verifier opened | `668nxiSeGzxoYnY8WPW7HVinaTKtkiszyvX4WkRYt9nBd86EQSrw7XryL7ifEjxhgER7wEQ8WaYpRjFRydCp2Zoj` |
| Template | `5PyoiNYXXwLWTPfeJ5S6TforrhdQj7bz8p7h6sT5Hot1Gc8h5aHgA7uC85a9PD9trZDNQfVCCfFWCncewammf13b` |
| Sale | [`3NGu6WxguinVc8VyQSqA79kL3jkCXWhC5kAoaK2kdesSyP8ZHgcCwM8BhZgvLfVoAuZ9okAUbuwB8hwL7PEyVw5D`](https://explorer.solana.com/tx/3NGu6WxguinVc8VyQSqA79kL3jkCXWhC5kAoaK2kdesSyP8ZHgcCwM8BhZgvLfVoAuZ9okAUbuwB8hwL7PEyVw5D?cluster=devnet) |

The sale landed and `sales.json` was written with the cap read back. Then the
closing balance read got a 429, so the command exited 1 without printing its
cost. The cost below comes from the chain.

### Attacking it

The first `npm run prove -- --mint 7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn`
at about 10:30 UTC attested its two attacking wallets
(`3B2q6cC8xrU7g1d4GbnED981au6p8EcFu4UXgHPC1qDDYeTkjjGdNd7oP47ocsgRsYrDxKdbsMyDBNWgVhKpDfjc`).
Then, on the over-cap row, it was cut off by 429s before it printed a table. No
row came back wrong. The node stopped answering. Its sweep then failed on the
same 429s, so part of what the attacking wallets held stayed with them.

The same command again at 10:33 UTC, exit 0:

```
filled   : one wallet holds 72271041208236 of its 79999967072171 raw unit cap
```

| Attack | Invariant | Expected | Actual | Result | Signature |
| --- | --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | ok | `4jtZjc3Kk84ZTUKf4JNhvPG54mXe3mjvRY6hNVq7YTqhnPLWBZWjfKXKokvPH7dYcCDjJ9PyvcbPRK2rBjdfSYVD` |
| buy with no attestation from the sale's verifier | C2 | CredentialInvalid | CredentialInvalid | ok | `2dvaB2gcFvwmdmQbYHV2wuuGKtQfTdPUk6yZNWXTMyrFHE9XVkeWZM2N7tGiwysNDx8jHUTrGxMkBFWDK3G3iPGi` |
| an attested wallet buys under the cap | C3 | it goes through | it goes through | ok | `3ym4DSTuYLPZztEKQwGyA231RB6pfq5MAw7TUWWj6mw1EWHNH3k3v87aBEM1G2kvfKEW21gPdCSYKbchHYZmti4X` |
| buy past the cap in one go | C3 | OverCap | OverCap | ok | `3dg8z3XTWhjcw2CoXpgcFX1ogJ8qhrm6oQkYhxnL7mFAZFEU9Gj5ZXKoDiJwBJdm9rH94Bd4nQPtaoyGXixgSX9D` |
| a second buy that crosses the cap | C3 | OverCap | OverCap | ok | `4EkrP5iHRSSvchWrqDdmyiZTmk8UyvwBp8fWXBzuzqwtcyKaNW8GHZeGNerBA13M38xRtPd9YcQWi9xgjh8LBV9i` |
| buy into a second token account of the same wallet | C3 | OverCap | OverCap | ok | `wjCE8fHGgRWes49Gf98a8vfYGPfDYZDUT4gaxtkJzmLytMBwFpXr9KfheVc4pCHXi6HReQXo7GoqwJqkceDkhMD` |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | ok | `492nnf4qjMdwF8nfoqTGydTRZ7328rQRxdw1fHYTNWWTXxiT4XY7nqGGD5nNgbjfriccpiBRz4BEsADy25WrNa2z` |
| send tokens straight to another wallet | C4 | WalletToWalletDuringSale | WalletToWalletDuringSale | ok | `48ruUbgr1vBFuuQ1n64MokNvDikAxtmFHzgtLM1Lq8qw7hT5cDzutSFTtYHMe6aQPFsHGYZbZSmSiGVxBTUTwdVh` |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | ok | `5KZe7mM34d79h9EZ7xPav18LuQ9W8SKaWL22w3A1zNKtShgCmpQgAFiGDFyiWYRP7TD2J6zqrAwz4c1nSqaLj9Y2` |
| an attested wallet sells back to the pool | C5 | it goes through | it goes through | ok | `2p97iWgJTshgZVo9M3H1rfngqZcL1NpdCbK4ZpmLGTUKHe8UqhE1iP7jXqgjqEyBeRiAJ6f1TeCFpEN6rVEWtYZ1` |
| buy that would push the price past the ceiling | C9 | PriceOutsideBand | this sale has no price band | skipped | not run |

Attestation for that run:
`5w7EXiAacXXonG6GSsehcqz8ssetsfEf47uN8P4dSMNrY4fC7HV7uhVP3pn5DasG7tFoZGMwKsqLFn1ukbro44f8`.

```
proof    : the largest wallet holds 35.80 percent of the 168233737622413 raw units sold, against a cap worth 47.55 percent of them
cost     : 0.017973 SOL, after 0.077115 SOL came back from the attacking wallets

10 attacks run, 8 refused as expected, 2 allowed as expected, 1 not applicable, 0 off the standard
```

This is credential mode proven on the live program for the first time. A wallet
with no attestation gets the program's own `CredentialInvalid`. A wallet the
verifier attested buys, and it is still held to the same cap as every other
mode. The largest holder's 35.80 percent is of a thin sale: only the attacking
wallets hold anything, so one capped wallet is a large share of the little that
has sold.

## The demo sale, PBAND2

`npm run refresh-price`, 10:37:50 UTC, Apple at 340.1147
(`5VP6Q2WuUoR4vkLWBipm88dL5ZYTtLxn5u4TQKQqoVYvrTRtEY9jQ9xDMs4P8z7hRQkLk37q6ocvKvKgUZLUKrAs`
and `3XawmsVVug8cr3UGkeMU9vueZawMzJz7xbSxCFrZQc6oHYMLXiiQbzF17i4bQbPerq8pc77hqoFR5vQifNaA9rBm`).

`npm run launch -- --mode open --band 500 --quote 2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5 --supply 20 --threshold 3710 --migration-percent 45 --base-decimals 9 --ends-in 336 --name "Pangu Priced Share, second offering" --symbol PBAND2`,
10:38 UTC:

```
price    : opens at 275.95041322314046 of the paying token a share, ends at 412.22222222222223
offering : 2026-10-07T10:38:05.000Z, 336 hours after the chain clock at launch; every rule lifts then, cap and access included
band     : 5 percent over Apple, price at most 3600 seconds old and no wider than 1 percent
           Equity.US.AAPL/USD at 340.1523 dollars, published 3 seconds ago, confidence 8 basis points
           ceiling 357.1600 dollars, reached once 66.6 percent of the curve's shares have sold
```

It opens 18.9 percent under Apple, and its rules hold until 7 October, five
days past the end of judging. It is the first sale on devnet with an end date.

| What | Address or signature |
| --- | --- |
| Mint | [`5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo`](https://explorer.solana.com/address/5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo?cluster=devnet) |
| Pool | `L7jdZ7NYzqL5eWA45kXYD7rxfWp31gg2uf8AkrEhQRg` |
| Config | `62bUtSuLDFJu3fvoeGJqZtpCAEKHBDfwgSSsNWoqxYhb` |
| Rules | `4FyxFBPfFcryJn6y8JkhgqFCt774FPue8FwFGHTgZk7N` |
| Extra account list | `9zET3HQ1UTPrpNnLkxC2XoCmuj2VHswdNvZSZW5xTfV3` |
| Paying token | `2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5`, the fourth run's dollar token |
| Pyth price account | `9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb` |
| Price refresh, by launch | `5SdLXLvDpbSTmqPnU7vepmRNCqesffmDJp6vmRXUFuFxZuh2RZZ8Jb4pTYjszT6vooeJhfxGXRDy2Ju1D7Qv79N4` and `ajjKSWCrdSKq6bAgvk7Ni39oAkQJX1CM2gpRcxNBWTpW7ixs2qk22ncdWtyCzBNPTN6qa5GPNFCn3P8F6YZTfgm`, Apple at 340.1523 |
| Template | `DVUi5RtE5JksRkPDGRibg2nYz4sg3hPKtZY8fXCTHUGW4Q7DvMBFi97mWVSjaRerNFwAYZEZ6yKErkE5G5umsjR` |
| Sale | [`5Biy9QvCFgYNEPWFNzEA31aYF5c7vLFBu48jmSUkXa2ocb2akDLjmF6ARQQaZkTY21ZgARMVERpYWqLAocES1KYD`](https://explorer.solana.com/tx/5Biy9QvCFgYNEPWFNzEA31aYF5c7vLFBu48jmSUkXa2ocb2akDLjmF6ARQQaZkTY21ZgARMVERpYWqLAocES1KYD?cluster=devnet) |

As with the credential sale, the entry was written and its cap read back. Then
the closing balance read got a 429 and the command exited 1.

### Seeding it

`npm run seed -- --mint 5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo --seed-to-share 50`.
The first pass, at 10:40 UTC, funded the eight wallets (0.096005 SOL) and made
one buy before a 429 stopped it. The seed wallets are derived from the demo key
and the mint, so the second pass two minutes later picked up from the chain.

| Pass | What | Raw units | Share of the curve | Signature |
| --- | --- | --- | --- | --- |
| 1 | wallet 1 buys | 426,333,076 | 3.88 | `3ZjfFx4MjshbeyQdvjNv59u8hqEUAgdR3Rz5WJQQtiYzykJ8YcwQ7JPrEx9QHeTYKdqtU8xkKrvBDioCkjhrgK6v` |
| 2 | buy 1 | 393,482,604 | 3.58 | `3fwpSp7V5FprKsR6RhgFSApmZ3G5p2vtZAv1YtNhMckgyTmci1KSbChscoyPmrtepXr63mjbwLopGsSMsMfjiuqQ` |
| 2 | buy 2 | 825,232,734 | 7.50 | `usr1Nh5KmEN87hZMXqTqneNpqj3xqoEokJ4ts7Xy16ARQa2zQKX25TW6G3XGHHZ4sXUvvGybAek8hHUePbcvWUS` |
| 2 | buy 3 | 482,205,742 | 4.38 | `9TXQHpXzFbNVztVnTBR6eHoAYY84AqvDA2VKQAyBHEbHBjPVoBH4bzUKKXWQTaUqQRRcmhzd5L3AK4Xk1TGQexN` |
| 2 | buy 4 | 786,080,886 | 7.15 | `5wNqFkygtkv4NPEPDJNKPFUeK7A2TJwc2cgDpCvu1gv32cWPVJJZR78zGF9AWCDzVvjT52DgZCQkqjED4hx8vfmV` |
| 2 | buy 5 | 528,930,882 | 4.81 | `66nWpJzsnvY76tUFYcXT7Q9mK2MSSHnMFBjCqzPPEVJkZTf4dmbwGd4TVbk5B8faCfA8CnbbdWu5PvQnUgu7yKWK` |
| 2 | buy 6 | 748,613,177 | 6.81 | `54GseiN8eQRCXcK56QteRHobgH829gECVnLet6Z4L58c64N1WHrWNTVUej2NMXND5T6ijr9YrCUXRwC8t9BF7zo2` |
| 2 | buy 7 | 579,357,276 | 5.27 | `4CRyRHVeHSVas7UUwZWXL7hY2Kfg7QbMsEPZbBzKY4nbGx7vbkVkhyDzfbZgT1u2CHo1M8kV78FcBbg3uTLk3TcK` |
| 2 | buy 8 | 718,553,499 | 6.53 | `3MuZ6EHy8fmyg9nYTk3DVBbpHxSLLPod5BtXWJb5tyNLEMZK1zEcrZoFBAX8V8tvZRJ6Rcuu9yFp5FKARXZ3oaM7` |
| 2 | sell 1 | 144,839,319 back | | `4gZoLNwJPd3YbfKwRdKBr6jN7v8NnTz9xwPkqJZNoWpDnmV4FcvFGbtrXFfnGjAoZkX8wC9x7Y53DUhbRF2hE7sr` |
| 2 | sell 2 | 179,638,374 back | | `2WiXpe9ieV2owqEpfgDKe34dcW3fCnSwAuU9E9LTUoXLTMHDGoHRwJuzRh2CWrcy7C43q6NK2gfFPtAoZyjPgHJz` |

```
price   : 329.8612 dollars a share against a ceiling of 357.1600, 7.64 percent under it
buyers  : 8 wallets holding something
sold    : 5164312183 raw units, net of what came back
largest : 3g9zEuaL4XL9mGBsaraJEhE4V7pbbFRZLZaUG5QnmbWm with 15.98 percent of it
cap     : 21.30 percent of what has sold
```

5,164,312,183 of 10,999,999,990 raw units is 46.95 percent of the curve.

### Attacking it

`npm run prove -- --mint 5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo`, about
10:45 UTC, exit 0. That is 6:45 in the morning in New York. Pyth was publishing
Apple in its pre-market session, so the price was fresh, and the last row is the
ceiling itself (`PriceOutsideBand`), not `PriceStale`.

```
band     : 5 percent over Equity.US.AAPL/USD at 340.1523 dollars, from Pyth shard 7700
price    : usable, published 540 seconds ago of an allowed 3600, confidence 8 of an allowed 100 basis points
curve    : 329.8612 dollars a share against a ceiling of 357.1600, so there is room under the band
filled   : one wallet holds 1054807560 of its 1099999999 raw unit cap
ceiling  : the smallest buy over it is 1091860932 raw units, landing the curve at 357.1600 against 357.1600; sending 1091860932
preflight: PriceOutsideBand
```

| Attack | Invariant | Expected | Actual | Result | Signature |
| --- | --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | ok | `3Kc4345HGB25FPiDkoPPWTGDfBTQsUpHoXR3KxDbRcNW8gmwirYh7C7N9rwmojSYyVfZap2xSFx4EGZKDKQM4ehq` |
| buy while not on the approved list | C6 | NotApproved | this sale has open access, so there is no list to be left off | skipped | not run |
| buy past the cap in one go | C3 | OverCap | OverCap | ok | `2jbjpk64u5KUS9pZ5cFJfrwj1A95akaJYW95guv7FC2wrUC5Qh2tHueDYgxNsECKqsrmPszGDcH6BDPMsXMEKBXw` |
| a second buy that crosses the cap | C3 | OverCap | OverCap | ok | `4eF2Y3jwzvKM1kuBNmd5oRACgczwFUxQT7DGtWizkaR1z4DQbbAZNV9f9qN3TPUJJXTuaNHrcHpTPwZqHcmrwDaR` |
| buy into a second token account of the same wallet | C3 | OverCap | OverCap | ok | `fscqbBtg2GYkf7bV8oAfYuDrfF39fbKXw2YR9acJ7TDLU6PhE4CkdnVYdT1SveRvYLsUG1u7sWgEXdjUYt2DDi2` |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | ok | `3rY6mU7Mu35Y1dnkTMS8vyBr9wT56PSxXcfemdi7LU7VEqrEZaFxK72p3pU8rBKkm5rC3vwU2n4oC4dLiArtffn3` |
| send tokens straight to another wallet | C4 | WalletToWalletDuringSale | WalletToWalletDuringSale | ok | `4QqUvf2uhPUCMoayybHMdnPGcZL1BLdvFKPLbtLCHRLvDjNtt3dP3csJMiE82sDwSHaUNmAdvPhhyqPiBFpkZy3g` |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | ok | `2iMGBGacLguZCH7LSNWfTceQtarWDjxgBQBPtH4em73LjUiXnbQDGgLaMvoogxKzatDnhSDBK7VEb4yJEGJ2GPMT` |
| a seeded buyer sells part of it back to the pool | C5 | it goes through | it goes through | ok | `2K7W9QnZJkJof7ej2DCiaWFALfpNcomJrcvuqZnwvZK8dHJdAuUa4rNqt82fJWvdKfHxdEA6uXsqnA4VwfX7yMDV` |
| buy that would push the price past the ceiling | C9 | PriceOutsideBand | PriceOutsideBand | ok | `4LXby4FwaytfNkRtj6TwyMWsm92iZFbyTEG6mvf8iwMxMdbwgKFaczDWMuexBgiqmK58UDFJ6iusQQt51vaEAYRc` |

```
proof    : the largest wallet holds 16.93 percent of the 6229218448 raw units sold, against a cap worth 17.66 percent of them
cost     : 0.011317 SOL, after 0.033344 SOL came back from the attacking wallets

9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
```

### Where it stands

After that prove: 10 holders, the 8 seeded wallets and 2 of prove's, and
6,229,218,448 raw units sold, 56.63 percent of the curve. The largest wallet
holds 16.93 percent of what has sold against a cap worth 17.66 percent of it.
The curve is under the 357.16 ceiling, and a buy of one cap's size from here
is refused with `PriceOutsideBand`.

## What the sixth run cost

Every figure is the demo keypair's balance read off the chain before and after
each command's transactions, because three of the commands were cut off by
429s before they printed a total.

| Command | Cost |
| --- | --- |
| `launch` PVRFD: verifier, template and sale | 0.021874 SOL |
| `prove` on PVRFD, cut off by 429s | 0.081103 SOL, most of it SOL the attacking wallets kept when the sweep could not run |
| `prove` on PVRFD, exit 0 | 0.017973 SOL |
| `refresh-price` | 0.000035 SOL |
| `launch` PBAND2, its own refresh included | 0.019380 SOL |
| `seed`, pass 1 | 0.097498 SOL, 0.096005 of it held by the eight seed wallets so they can sell |
| `seed`, pass 2 | 0.013075 SOL |
| `prove` on PBAND2, exit 0 | 0.011317 SOL |

From 0.997240949 SOL after the top-up to 0.734985515 SOL at the end: 0.262255
SOL for the whole run. The project wallet paid 0.600005 SOL for the top-up and
about 0.0018 SOL for the deploy.

## The demo, checked at the end

```
program 4Nd46mDi...         PASS    executable, 363720 bytes, sha256 191e9cf1ab6f as recorded, slot 502899538
sale PLIST 2ARD1Kwv...      PASS    2ARD1KwvxyjLPwe46rivjxPRyMzvxSEPGvwKTqcNXpFR, list, 15 buyers, graduated
record PLIST 2ARD1Kwv...    PASS    pool, cap 79999967072171 and list access match the chain
sale PBAND 2dp5caL9...      PASS    2dp5caL9PPVWafYkmNHBdHEX6zWfG42BmERcnLK75N4Y, open, band 500 bps, 16 buyers, running
record PBAND 2dp5caL9...    PASS    pool, cap 1099999999 and open access match the chain
band PBAND 2dp5caL9...      PASS    Equity.US.AAPL/USD published 2026-09-23T10:38:07Z, 783 seconds ago of an allowed 3600, at 340.15 dollars
sale PVRFD 7ixMAMUm...      PASS    7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn, credential, 3 buyers, running
record PVRFD 7ixMAMUm...    PASS    pool, cap 79999967072171 and credential access match the chain
sale PBAND2 5VrNEfV1...     PASS    5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo, open, band 500 bps, 10 buyers, running
record PBAND2 5VrNEfV1...   PASS    pool, cap 1099999999 and open access match the chain
band PBAND2 5VrNEfV1...     PASS    Equity.US.AAPL/USD published 2026-09-23T10:38:07Z, 786 seconds ago of an allowed 3600, at 340.15 dollars
retired sales               SKIP    2 entries in sales.json are marked retired and not checked
pyth key                    PASS    HTTP 200, Apple published 0 seconds ago of an allowed 3600
wallet demo 9QTJCGx2...     PASS    9QTJCGx2TLSre7dnjxn3hDs2EJznxr5F84DqrnU1n4FW holds 0.7350 SOL
wallet project Fwi8ejZ8...  PASS    Fwi8ejZ8kqF8PwcxssHFqJQZmVrkmBfoaXV5CTjqp5L holds 9.3361 SOL
app                         SKIP    APP_URL is not set in .env, so there is no site to check
14 passed, 0 warned, 0 failed, 2 not checked, at 2026-09-23T10:51:04Z
```

# The seventh run: a demo sale banded on the round-the-clock AAPLx price

PBAND and PBAND2 are banded on `Equity.US.AAPL/USD`, Apple's exchange price.
Pyth only publishes that during US market sessions, so from an hour after the
close until the next pre-market every buy on them is refused with `PriceStale`.
Judging runs across a weekend. This run opens a third demo sale, PAAPLX, with
the same curve as PBAND2 but banded on `Crypto.AAPLX/USD`, the tokenised Apple
share, which Pyth publishes all week. A judge can then run every buy row at any
hour. It is a different instrument from the stock and carries its own basis
risk, which `feeds.ts` says. Decided by the founder on 23 September 2026. Every command
below ran from a Windows shell in `packages/scripts` on the keyed devnet node,
with no 429s, so nothing needed a second pass.

## The price

`npm run refresh-price -- --feed Crypto.AAPLX/USD`, 13:05 UTC, exit 0:

```
feed      : Crypto.AAPLX/USD (Apple, tokenised)
account   : 6TzXgoujavi3TRF8MchvtWdqaApXc2RXiF7m31eSkW4a
price     : 344.2560 dollars, confidence 7 basis points
published : 2026-09-23T13:05:14.000Z, 8 seconds ago, of an allowed 3600
verified  : Full, two thirds of the Wormhole guardians
cost      : 1366140 lamports (0.001366 SOL), 137831 compute units, 1606 bytes
```

Signatures
`5WWZwBPEhrUfFi8UE99LYzneUjDjvexch7AhPfmmXHwBpyD9usGyUGjP69T5kCsd2MN1a3v1DZPf2XJrG7anqoag`
and
`2kssxNYpHUviwneukDbALwXBCBEUtFi21xmQGUEf2vWUnFYncgVwzCBSxPagkXGsfxr3K9ZyQVZe8qmRTgsSB7h4`.
It cost more than the sixth run's Apple refresh (0.000035 SOL) because this was
the first write of the AAPLx feed on Pangu's shard: 1,330,960 lamports of it is
the rent that created the price account, read off the second transaction's
balances. The first transaction's 2,367,280 lamport account was closed in the
second and came back.

## The demo sale, PAAPLX

`npm run launch -- --mode open --band 500 --feed Crypto.AAPLX/USD --quote 2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5 --supply 20 --threshold 3710 --migration-percent 45 --base-decimals 9 --ends-in 336 --name "Pangu Priced Share, round the clock" --symbol PAAPLX`,
13:05 UTC, exit 0:

```
price    : opens at 275.95041322314046 of the paying token a share, ends at 412.22222222222223
offering : 2026-10-07T13:05:32.000Z, 336 hours after the chain clock at launch; every rule lifts then, cap and access included
band     : 5 percent over Apple, tokenised, price at most 3600 seconds old and no wider than 1 percent
           Crypto.AAPLX/USD at 344.3079 dollars, published 8 seconds ago, confidence 5 basis points
           ceiling 361.5232 dollars, reached once 69.5 percent of the curve's shares have sold
```

It opens 19.9 percent under the AAPLx price, and its rules hold until 7
October, five days past the end of judging. The curve is PBAND2's to the digit,
since the flags are the same. The ceiling is higher because AAPLx was trading
at 344.31 against Apple's 340.80 on the exchange in the same half hour.

| What | Address or signature |
| --- | --- |
| Mint | [`8FaBUEjMfkpYAzZLmLKwYHxd15BNC1ZBFkgTgN2WCQvK`](https://explorer.solana.com/address/8FaBUEjMfkpYAzZLmLKwYHxd15BNC1ZBFkgTgN2WCQvK?cluster=devnet) |
| Pool | `6T66LbaHCDGoB48TmhEUEYuNm59NcqGVTJABvsGxAo2i` |
| Config | `HprPCqAneB8YphVPz2gNkzgNinuvGxBA7oqwer9PQyTJ` |
| Rules | `9EnpQJobHkTTGebJGQFBEx3UQSsvQaKrXLVV5EeAYV15` |
| Extra account list | `Aam3YwCN7MFrJURZqGQkJnqYAEJ4mZoVvr219EspFtHc` |
| Paying token | `2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5`, the fourth run's dollar token, as PBAND2 |
| Pyth price account | `6TzXgoujavi3TRF8MchvtWdqaApXc2RXiF7m31eSkW4a`, `Crypto.AAPLX/USD` on shard 7700 |
| Price refresh, by launch | `3cqLyytNkfPqK2TzAVVmKn1NBbmenDgqKYwKmMDppKW1tWuoed8SJxuJdo1fQTCnKaYkWQ43vgofJ5EyRf7ZAzs3` and `2J4PssbjXTatQzGd6SQPjaVbCm5xpEDwtimVKbB2mWnobdRTmDZB7JwX8pbG57qVVy14SqWAGKc8G7QJjmLAJr9z`, AAPLx at 344.3079 |
| Template | `3an3aoDfVLS9FmHdrxCQzPGYB18aR2PETf5HhkiiBFrcrhFsoB2pSdXp7Hj84BAXD9yvAH4JvY5BxzAtBUdiBiDi` |
| Sale | [`4HN35oFemvfijyrNMwiS6vSeNU4BEvTd56NBGdScK9wzCTQ1vcgHJ4Gpj9Ze9eTXRbMjUEHJkYgPuy8yCbpVkSjZ`](https://explorer.solana.com/tx/4HN35oFemvfijyrNMwiS6vSeNU4BEvTd56NBGdScK9wzCTQ1vcgHJ4Gpj9Ze9eTXRbMjUEHJkYgPuy8yCbpVkSjZ?cluster=devnet) |

The cap read back is 1,099,999,999 raw units, and `sales.json` holds the entry
with the cap and the end date. The template was 662 bytes and the pool and
rules 974, against the 1232 byte limit.

### Seeding it

`npm run seed -- --mint 8FaBUEjMfkpYAzZLmLKwYHxd15BNC1ZBFkgTgN2WCQvK --seed-to-share 50`,
13:06 to 13:08 UTC, exit 0, one pass. It funded the eight wallets with 0.096005
SOL and handed each the dollars its buy spent.

| What | Raw units | Share of the curve | Signature |
| --- | --- | --- | --- |
| buy 1 | 426,333,076 | 3.88 | `4LQvvt5qNbiiZNMTqgH9mtxgpAcx4c3YLoEKc6yh2GZgiVDXT9MYJxpqw753vN3cqxyBxT2H4oVLVd65kFHpSHJK` |
| buy 2 | 893,662,309 | 8.12 | `54tvAFq9P2ZKydT4h7J63sUbzjTYkqGhVq42vjJerwVkJwQk2Nny9aNrb8QqtR9fhhDgLttCKsLnZCEphupXENNG` |
| buy 3 | 522,530,273 | 4.75 | `QGHcoHFa2CDu67fuyiX3LufBZaRTG6jYtPTCvtWDyqZuuz8AWyUEeBJF8FgQDstdPUdGdDRRe5xTfdM3pG44LCK` |
| buy 4 | 851,534,425 | 7.74 | `2NSQEgJK3Edz5nozKG7DVyi7B4DrtA1TaYAcsAcMNzMGgpXa32KQoohqVvAbas65aUuX26eP3TexkojBy54DzPe4` |
| buy 5 | 573,344,297 | 5.21 | `5YkBV9E5XDU7YxrE2qMBbJW24U3dUU15C7MNtbTPtsn1HWrsqTUJMqwgvhVR2HXQQMzexYW7VM7zGJ3NJdu3mVr4` |
| buy 6 | 811,359,291 | 7.38 | `3DtUM7JsEnudhGMfMGcjxXe39yrQudiu4XPiXKK9WHmgpPDzhgsdWM4X88BGhWSyegBcSZrKbjFciWzyDfVKCfSo` |
| buy 7 | 628,434,658 | 5.71 | `3JjGdneckFBS7JB9qCJbc8tfBUyiveYVUejB4KW8uVbRzrfqSV5hNrdUssydJrt42CKngAC9kaVKnUh5aE4P2JeS` |
| buy 8 | 779,767,065 | 7.09 | `4GMSu3hg3cNMWFsieametZH1RAVscrpRiGtiVcFcf6Ss3ffDsTgKttQnDfaDxUumqRG7GxeswmfvH9SU7icMRiAV` |
| sell 1 | 157,108,664 back | | `5pneFKGFjfrvputHQ6tmy8LzJ7byYdzSUMmEJkmtAzm8Ew2xrMknj3uB1V9PX6n2fr8BTLZhCDocpejbUjkxLz4K` |
| sell 2 | 194,941,766 back | | `4UUE3iRqZYaEjHdUSfZo8Cp4p9UxkMU2mhYwHSEujghPx2rgiULP18fRfuxwMJbVXuHb4MvxYQzzS8aKZ1czyjuj` |

```
price   : 329.5110 dollars a share against a ceiling of 361.5232, 8.85 percent under it
buyers  : 8 wallets holding something
sold    : 5134914964 raw units, net of what came back
largest : CaXDoyEvKSMrj58RXgKxTXzNRcct3ndQtaX5UDn1dRvx with 17.40 percent of it
cap     : 21.42 percent of what has sold
spent   : 0.107953 SOL from the issuer
```

5,134,914,964 of 10,999,999,990 raw units is 46.68 percent of the curve.

### Attacking it

`npm run prove -- --mint 8FaBUEjMfkpYAzZLmLKwYHxd15BNC1ZBFkgTgN2WCQvK`, 13:09
to 13:12 UTC, exit 0. The AAPLx price was 206 seconds old, so the last row is
the ceiling itself (`PriceOutsideBand`), not `PriceStale`.

```
band     : 5 percent over Crypto.AAPLX/USD at 344.3079 dollars, from Pyth shard 7700
price    : usable, published 206 seconds ago of an allowed 3600, confidence 5 of an allowed 100 basis points
account  : 6TzXgoujavi3TRF8MchvtWdqaApXc2RXiF7m31eSkW4a, fully verified by the Wormhole guardians
curve    : 329.5110 dollars a share against a ceiling of 361.5232, so there is room under the band
filled   : one wallet holds 1054818232 of its 1099999999 raw unit cap
ceiling  : the smallest buy over it is 1344531670 raw units, landing the curve at 361.5232 against 361.5232; sending 1344531670
preflight: PriceOutsideBand
```

| Attack | Invariant | Expected | Actual | Result | Signature |
| --- | --- | --- | --- | --- | --- |
| buy with no buyer record | C2 | BuyerRecordMissing | BuyerRecordMissing | ok | `37NmkHhCSPaWvuoQVxP4M1scr2Uho6JdpZZYDEoDHG1X6uYEh6XLnSAhqjCPpnabWb7VhKgW51dNJej59subZSs9` |
| buy while not on the approved list | C6 | NotApproved | this sale has open access, so there is no list to be left off | skipped | not run |
| buy past the cap in one go | C3 | OverCap | OverCap | ok | `3FqJJi3ocCT13oLaPA7pBchGF9c4LrqVoZFKdfiNxsmMLHDzKdz8ny7G8TrLr6bAcCJwP2Mbcwvikyf2C9Anp5d8` |
| a second buy that crosses the cap | C3 | OverCap | OverCap | ok | `iRcEGauyt5MQzsgthaLEapmP6zbr4PeQuz2VAPwnqxdtkAj2bDWFdQPWqQ2Vbin3bmks3BHtfQ5aQzAztzR8Zh8` |
| buy into a second token account of the same wallet | C3 | OverCap | OverCap | ok | `3qvm9zseC8nxnQeKruhaiWXUnRaC2X2W9NgGDLxUcmEECydLyV6gshmvdK4DCexhHrvQDjE75mh6tLD3kU3wd3FM` |
| buy into an account whose owner can still change | C13 | ReceivingAccountOwnerCanChange | ReceivingAccountOwnerCanChange | ok | `4pSxSuDz1k6jQAj2B4pcAizduFyd7RJn3931PYwNSqQKW5HdRYZyLRQsGgWssn1xfDY3KkfhibBXTbcCPfJYX8Fe` |
| send tokens straight to another wallet | C4 | WalletToWalletDuringSale | WalletToWalletDuringSale | ok | `n5w2RNRdNzu3TdhaNiRvMMPqjd1vP5qykkNDjVCgDS5Rvgu11Sd1KSJ4zD3MUY1uKgfxLz2TmyHr3dF33ax6hK3` |
| call the hook on its own, with no transfer | C1 | NotTransferring | NotTransferring | ok | `v3a7Z9oqZHUEkeJzEUhEdSfi8aqmAzepfWsRxaa2L61TkPXCfgZ7fz94FLffqyadNrxabsZ2qmnPFK7MDoxUsRp` |
| a seeded buyer sells part of it back to the pool | C5 | it goes through | it goes through | ok | `2R6YEahbtnBfKu5ec2qH8QAfH9tRqePtejtzSgnDGYyNBtUH4mtTs62WTxN2eJb8xAn8RYaiKdpzg2Hj5P6G6YB9` |
| buy that would push the price past the ceiling | C9 | PriceOutsideBand | PriceOutsideBand | ok | `5TbBnGrVHCkEj2GkdpRR7cR5p5TMUFrwubhqub5GVYQrTK3QsSTmhoLGYTZ1fEQ5diUm4C6M6acVAu6aUNTUGm8v` |

```
proof    : the largest wallet holds 16.75 percent of the 6298435003 raw units sold, against a cap worth 17.46 percent of them
cost     : 0.011317 SOL, after 0.033344 SOL came back from the attacking wallets

9 attacks run, 8 refused as expected, 1 allowed as expected, 1 not applicable, 0 off the standard
```

This is the band proven against a feed that publishes all week: the program
read the AAPLx account, found it fresh and fully verified, and refused the one
buy that would have taken the curve past 5 percent over it.

### Where it stands

After that prove: 10 holders, the 8 seeded wallets and 2 of prove's, and
6,298,435,003 raw units sold, 57.26 percent of the curve. The largest wallet
holds 16.75 percent of what has sold against a cap worth 17.46 percent of it.
The curve is under the 361.52 ceiling, and a buy of one cap's size from here is
refused with `PriceOutsideBand`.

## What the seventh run cost

Every command printed its own total, and the total checks against the demo
keypair's balance: 0.733421715 SOL before the first refresh, read off that
transaction, and 0.5934 SOL in the status row at the end.

| Command | Cost |
| --- | --- |
| `refresh-price --feed Crypto.AAPLX/USD` | 0.001366 SOL, 0.001331 of it the rent that created the AAPLx price account |
| `launch` PAAPLX, its own refresh included | 0.019380 SOL |
| `seed`, one pass | 0.107953 SOL, 0.096005 of it held by the eight seed wallets so they can sell |
| `prove` on PAAPLX, exit 0 | 0.011317 SOL |

0.140016 SOL for the whole run. The project wallet paid nothing.

## The demo, checked at the end

`npm run status`, 13:12:43 UTC, exit 0:

```
program 4Nd46mDi...         PASS    executable, 363720 bytes, sha256 191e9cf1ab6f as recorded, slot 502899538
sale PLIST 2ARD1Kwv...      PASS    2ARD1KwvxyjLPwe46rivjxPRyMzvxSEPGvwKTqcNXpFR, list, 15 buyers, graduated
record PLIST 2ARD1Kwv...    PASS    pool, cap 79999967072171 and list access match the chain
sale PBAND 2dp5caL9...      PASS    2dp5caL9PPVWafYkmNHBdHEX6zWfG42BmERcnLK75N4Y, open, band 500 bps, 16 buyers, running
record PBAND 2dp5caL9...    PASS    pool, cap 1099999999 and open access match the chain
band PBAND 2dp5caL9...      PASS    Equity.US.AAPL/USD published 2026-09-23T12:37:56Z, 2092 seconds ago of an allowed 3600, at 340.80 dollars
sale PVRFD 7ixMAMUm...      PASS    7ixMAMUmysN4qsCpthdznhq7aRbiCNB5Xeg3X9vBSLWn, credential, 3 buyers, running
record PVRFD 7ixMAMUm...    PASS    pool, cap 79999967072171 and credential access match the chain
sale PBAND2 5VrNEfV1...     PASS    5VrNEfV1gQrBrMLSxyaK3AXRa2yj9Xp9i65MZzKHGZSo, open, band 500 bps, 11 buyers, running
record PBAND2 5VrNEfV1...   PASS    pool, cap 1099999999 and open access match the chain
band PBAND2 5VrNEfV1...     PASS    Equity.US.AAPL/USD published 2026-09-23T12:37:56Z, 2097 seconds ago of an allowed 3600, at 340.80 dollars
sale PAAPLX 8FaBUEjM...     PASS    8FaBUEjMfkpYAzZLmLKwYHxd15BNC1ZBFkgTgN2WCQvK, open, band 500 bps, 10 buyers, running
record PAAPLX 8FaBUEjM...   PASS    pool, cap 1099999999 and open access match the chain
band PAAPLX 8FaBUEjM...     PASS    Crypto.AAPLX/USD published 2026-09-23T13:05:35Z, 440 seconds ago of an allowed 3600, at 344.31 dollars
retired sales               SKIP    2 entries in sales.json are marked retired and not checked
pyth key                    PASS    HTTP 200, Apple published 0 seconds ago of an allowed 3600
wallet demo 9QTJCGx2...     PASS    9QTJCGx2TLSre7dnjxn3hDs2EJznxr5F84DqrnU1n4FW holds 0.5934 SOL
wallet project Fwi8ejZ8...  PASS    Fwi8ejZ8kqF8PwcxssHFqJQZmVrkmBfoaXV5CTjqp5L holds 9.3361 SOL
app                         SKIP    APP_URL is not set in .env, so there is no site to check
17 passed, 0 warned, 0 failed, 2 not checked, at 2026-09-23T13:12:43Z
```

PBAND2 shows 11 buyers against the 10 the sixth run left: one wallet bought on
it between the two runs, not from these commands.

# The eighth run: a ceiling refused on a paying token outside the dollar list

23 September 2026, against the sixth deploy (binary SHA256 `e40ab680...`). The
demo wallet `9QTJCGx2TLSre7dnjxn3hDs2EJznxr5F84DqrnU1n4FW` made a fresh token
with six decimals and no freeze authority,
[`AqZqxdCUeu2WgGx57Xc8Cag4SDsUh4E37gFKgM7a2Bg4`](https://explorer.solana.com/address/AqZqxdCUeu2WgGx57Xc8Cag4SDsUh4E37gFKgM7a2Bg4?cluster=devnet),
opened a launch template paid in it, then sent the banded pool and rules (a 5
percent ceiling over the AAPLx feed) for real with preflight skipped. The
program refused it with `BandNeedsDollarQuote` (6029):
[`M9GmvWbF...`](https://explorer.solana.com/tx/M9GmvWbFTHCPBJnPbX1k2hmHUzqdBgAQnf7LevymftEjcjTbfM6wy3YXrUieCg2NWsfNdoP9qXESgQP4C9wcYCG?cluster=devnet).

What exists afterwards: the token (nothing minted) and the template
[`AxmLxENZxPdWCaMZzQca1NJphJSHfj7ZHdXmjBkSVHsr`](https://explorer.solana.com/address/AxmLxENZxPdWCaMZzQca1NJphJSHfj7ZHdXmjBkSVHsr?cluster=devnet).
No pool, no sale rules and no sale token: they go in the one refused
transaction. Cost, read off each transaction: 0.001077 SOL for the token,
0.006390 for the template, 0.00001 for the refused transaction, 0.007477 SOL in
all.
