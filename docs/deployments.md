# Deployments

Where the Pangu program lives on chain, what it cost, and how to put a new build
there. Every number below was read back off the chain, not copied from a plan.

## Devnet (live)

| Fact | Value |
| --- | --- |
| Program id | `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG` |
| Program data account | `58UAoZWuoMpnV4HzydaVUai9U7DFzapFtN5KtAzkzDpY` |
| Running since slot | 502476730 |
| Running since | 2026-09-22 14:53:26 UTC |
| Upgrade authority (public key) | `Fwi8ejZ8kqF8PwcxssHFqJQZmVrkmBfoaXV5CTjqp5L` |
| Build running there | `pangu.so`, the one binary, with the SaleRules layout version |
| Build size | 358,248 bytes |
| Program account size | 442,320 bytes (the first build plus 20 percent headroom) |
| Rent locked | 2.24786444 SOL |
| sha256 of the deployed build | `a937c610ab35442df59e0ead889a98ea8acafb396f2de9f2c37355ee5a555beb` |
| sha256 of the IDL clients build against | `0b69e9d123c17266353293dce7627ec25493f7561bf6fc9a6522a6a98ddb5031` |
| Loader | BPF upgradeable loader, SBPF v0 bytecode |
| Toolchain | Anchor 1.2.0, solana-cli 4.2.2 |
| Explorer | https://explorer.solana.com/address/4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG?cluster=devnet |

The bytes running on devnet were checked against the local build again on 22
September at 14:55 UTC:

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/program-info.sh devnet
DEPLOYED SLOT: 502476730
LOCAL SHA256:    a937c610ab35442df59e0ead889a98ea8acafb396f2de9f2c37355ee5a555beb
ON-CHAIN SHA256: a937c610ab35442df59e0ead889a98ea8acafb396f2de9f2c37355ee5a555beb
HASH MATCH: YES
INFO-OK
```

## One build, not two

There is one binary and it serves every network. The price band reads Pyth, and
Pyth's receiver program and price feed program sit at the same addresses on
mainnet and devnet, so nothing about the band has to be chosen when the program
is compiled. `build.sh` takes no argument.

This replaced an earlier arrangement of two binaries. While the band read
Switchboard there had to be one build per network, because Switchboard's
On-Demand program has a different address on each, and a sale running the devnet
build on mainnet could have priced itself off a devnet queue where anyone can
stand up their own oracles. Moving the band to Pyth took that whole problem away
along with the second binary.

## The four deploys

Same address every time. An upgrade replaces the code in the account that is
already there, so nothing a client or a saved account points at ever moves.

| # | Slot | When (UTC) | What went on chain | Signature |
| --- | --- | --- | --- | --- |
| 1 | 502338042 | 2026-09-22 08:30:39 | First deploy, the Switchboard build | `5eR1vqbvD7jU2GEVerPoseofDFGiudGkdcP94o6Zx6xJJFmjHBVuZK1uAyjptZWNqV9hKchAFgm9CSCJjrFY9RoJ` |
| 2 | 502373496 | 2026-09-22 10:08:31 | The WO-10 and WO-11 review fixes | `2cXwvQZAGirGzY11ydL5aWKuF8WDogFCTXrobrnHNR9k7nHpbcfRvnpdus8E66EyJMkDB4JcBgT5xeeBsHaeDgMr` |
| 3 | 502436678 | 2026-09-22 13:02:53 | The price band moved from Switchboard to Pyth | `4RdQw1FvbULYtnyjY2mxBoj8Q9XpGCwygnJuDz7qXVwLSLqbVd8tp8BvHoxDwJKd3qVsBegt76PB3MiWHtm5pq7L` |
| 4 | 502476730 | 2026-09-22 14:53:26 | The SaleRules layout version, so a reader refuses rules written by another layout | `fomCUUu2u7MThsTpUyxwHXwyGTpNawwqKNZW8HaKExWZJpp3bKNS1xGhepZKKPxVFjJ4MdeL3MSPGqfqTK96eX7` |

| # | Build | sha256 | Size |
| --- | --- | --- | --- |
| 1 and 2 | `pangu-devnet.so`, built with `--features devnet` | `58f22ae2136edc6f6fd35edc5aec1bb27f3a5548d39fb94b4c530c8dbad0eb34` | 371,488 bytes |
| 3 | `pangu.so`, the one binary | `08746faa7b4ac83ada7bfa0cd2fcf0b04aabc9c335ebfc310fd2a06d486d3a7c` | 356,200 bytes |
| 4 | `pangu.so`, with the layout version | `a937c610ab35442df59e0ead889a98ea8acafb396f2de9f2c37355ee5a555beb` | 358,248 bytes |

What each one cost:

- **First deploy, 2.25054256 SOL.** 2.24786444 SOL of that is rent that stays
  locked in the program account and the rest went on fees. The temporary upload
  buffer held roughly another 1.87 SOL during the upload and was refunded
  automatically when the deploy landed.
- **Second, 0.001855 SOL**, all of it fees. The upload buffer held 1.88780928 SOL
  while the build was uploaded and it came back in the same transaction that
  flipped the new code into place: the payer went from 11.54334008 SOL to
  11.54148508 SOL, and a check straight afterwards found no buffer holding SOL.
- **Third, 0.001775 SOL**, all of it fees again. No new rent either time: the
  account was sized on the first deploy and both later builds still fit.
- **Fourth, 0.001785 SOL**, fees for two attempts rather than one. The first
  attempt died part way up: WSL lost its DNS for a moment and the CLI could not
  look up the devnet host, so it stopped with the upload buffer
  `6TPSWdu777syn8ML223w3LcLdWkzrTaT2xjKLSsMHJKE` holding 1.82077868 SOL. That is
  the case the named buffer keypair exists for. Running the same command again
  picked up that buffer instead of re-uploading 350 KB, landed the upgrade, and
  the buffer's SOL came back in the same transaction: the wallet went from
  10.93970508 SOL to 10.93792008 SOL across both attempts, and the closing check
  found no buffer holding SOL.

The account was created 20 percent larger than the first build so a later,
bigger build can still be upgraded in place at the same address. That headroom
costs 0.37449760 SOL of extra rent, locked for as long as the program exists.
Without it a bigger build would need a brand new address, and every client and
every saved account would have to be pointed somewhere else. The build on chain now is
13,240 bytes smaller than the Switchboard one it replaced, so the headroom is
wider than it was.

## Commands

All of these run inside WSL Ubuntu from Windows:

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/build.sh
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/deploy.sh devnet
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/program-info.sh devnet
```

- **Deploy and upgrade are the same command.** `deploy.sh devnet` builds, checks
  the program keypair against `declare_id!`, checks the payer can afford the run,
  then either creates the program account or upgrades the code at the same
  address. It ends with `DEPLOY-OK`.
- **Running it with an unchanged build spends nothing.** It dumps the deployed
  bytes, trims them to the local build's length, compares the sha256, and reports
  `ALREADY UP TO DATE` without sending a transaction.
- **Inspect:** `program-info.sh devnet` reads the program id, slot, upgrade
  authority, size and rent back off the chain and proves the running bytes match
  the local build. It ends with `INFO-OK`.
- **It refuses anything except devnet.** `deploy.sh mainnet` exits with
  `DEPLOY-REFUSED` before it builds or touches a key.
- **The buffer warning is read twice.** A devnet node can still be serving the
  upload buffer for a few seconds after the transaction that closed it, so the
  first count of one means nothing. The script waits and counts again before it
  says anything about SOL being parked.

Keys live inside WSL at `~/.config/solana/` and never enter the repo: the program
keypair `pangu-program-keypair.json` (this is what fixes the address), the payer
and upgrade authority `pangu-devnet.json`, and the upload buffer keypair
`pangu-deploy-buffer.json` that makes a failed upload resumable.

## How to recover a failed deploy

A deploy uploads the program into a temporary buffer account first, then flips it
into place in one transaction. If the upload dies part way, on a dropped
connection or a busy RPC, that buffer keeps your SOL. Nothing is lost, but nothing
is returned on its own either.

1. See what is parked:

   ```
   solana program show --buffers --keypair ~/.config/solana/pangu-devnet.json --url https://api.devnet.solana.com
   ```

2. To finish the job, just run `deploy.sh devnet` again. It reuses the same buffer
   keypair, so it picks up where it stopped instead of re-uploading 348 KB.
3. To abandon it and take the SOL back:

   ```
   solana program close --buffers --keypair ~/.config/solana/pangu-devnet.json --url https://api.devnet.solana.com
   ```

`deploy.sh` prints these same three lines whenever an attempt fails, and its
closing report says how many buffers are still holding SOL.

## Mainnet

Not deployed. Mainnet is the team's decision and gets its own run, its own
funded wallet and its own upgrade authority plan. `deploy.sh` refuses it today.

| Fact | Value |
| --- | --- |
| Program id | not deployed |
| Program data account | not deployed |
| First deployed in slot | not deployed |
| First deployed at | not deployed |
| Deploy signature | not deployed |
| Upgrade authority (public key) | not deployed |
| Build size | not deployed |
| Program account size | not deployed |
| Rent locked | not deployed |
| sha256 of the deployed build | not deployed |
| Explorer | not deployed |
