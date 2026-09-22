# Deployments

Where the Pangu program lives on chain, what it cost, and how to put a new build
there. Every number below was read back off the chain, not copied from a plan.

## Devnet (live)

| Fact | Value |
| --- | --- |
| Program id | `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG` |
| Program data account | `58UAoZWuoMpnV4HzydaVUai9U7DFzapFtN5KtAzkzDpY` |
| First deployed in slot | 502338042 |
| First deployed at | 2026-09-22 08:30:39 UTC |
| Deploy signature | `5eR1vqbvD7jU2GEVerPoseofDFGiudGkdcP94o6Zx6xJJFmjHBVuZK1uAyjptZWNqV9hKchAFgm9CSCJjrFY9RoJ` |
| Last upgraded in slot | 502373496 |
| Last upgraded at | 2026-09-22 10:08:31 UTC |
| Upgrade signature | `2cXwvQZAGirGzY11ydL5aWKuF8WDogFCTXrobrnHNR9k7nHpbcfRvnpdus8E66EyJMkDB4JcBgT5xeeBsHaeDgMr` |
| Upgrade authority (public key) | `Fwi8ejZ8kqF8PwcxssHFqJQZmVrkmBfoaXV5CTjqp5L` |
| Build running there | `pangu-devnet.so`, built with `--features devnet` |
| Build size | 371,488 bytes |
| Program account size | 442,320 bytes (the first build plus 20 percent headroom) |
| Rent locked | 2.24786444 SOL |
| sha256 of the deployed build | `58f22ae2136edc6f6fd35edc5aec1bb27f3a5548d39fb94b4c530c8dbad0eb34` |
| Loader | BPF upgradeable loader, SBPF v0 bytecode |
| Toolchain | Anchor 1.2.0, solana-cli 4.2.2 |
| Explorer | https://explorer.solana.com/address/4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG?cluster=devnet |

The account was created 20 percent larger than the build so a later, bigger build
can still be upgraded in place at the same address. That headroom costs
0.37449760 SOL of extra rent, locked for as long as the program exists. Without it
a bigger build would need a brand new address, and every client and every saved
account would have to be pointed somewhere else.

The upgrade of 22 September cost 0.001855 SOL, all of it transaction fees. The
temporary upload buffer held 1.88780928 SOL while the 371,488 byte build was
uploaded and it came back in the same transaction that flipped the new code into
place: the payer went from 11.54334008 SOL to 11.54148508 SOL, and a check
straight afterwards found no buffer holding SOL. No new rent was locked, because
the account was sized on the first deploy and the new build still fits.

First deploy cost 2.25054256 SOL: 2.24786444 SOL of rent that stays locked in the
program account, and the rest in transaction fees. The temporary upload buffer
held roughly another 1.87 SOL during the upload and was refunded automatically
when the deploy landed.

## Two builds, one per network

The price band only accepts a Switchboard queue owned by Switchboard's On-Demand
program, and that program has a different address on each network. Which one the
code accepts is fixed when the program is compiled, so there are two binaries and
they are not interchangeable. Running the devnet build on mainnet would let a
sale price itself off a devnet queue, where anybody can stand up their own
oracles.

```
build.sh devnet     writes target/deploy/pangu-devnet.so   (--features devnet)
build.sh mainnet    writes target/deploy/pangu-mainnet.so  (no argument means mainnet)
```

Neither run overwrites the other's binary. `build.sh` decodes the queue owner
address and looks for its bytes inside the binary it just produced, so a build
that was named devnet but compiled without the feature fails on the spot rather
than reaching the chain. The two builds of 22 September:

| Build | sha256 | Length |
| --- | --- | --- |
| `pangu-devnet.so` | `58f22ae2136edc6f6fd35edc5aec1bb27f3a5548d39fb94b4c530c8dbad0eb34` | 371,488 bytes |
| `pangu-mainnet.so` | `e1da195b2da672ace966817c4014934b0ace1a4735d4f084981c74c31f00228c` | 371,488 bytes |

The IDL is the same file either way, sha256
`f59f7fed66a759ecef66053fe84b497ef521ec17a20f0956f7378ba7ecd84e79`: the feature
changes one address inside the program, not the interface clients build against.
The test suite and the fork tests run the mainnet build, because the fork clones
Switchboard's mainnet queue.

## Commands

All of these run inside WSL Ubuntu from Windows:

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/build.sh devnet
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/deploy.sh devnet
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/program-info.sh devnet
```

- **The cluster argument decides the binary.** `deploy.sh devnet` builds the
  devnet binary and deploys that one; `program-info.sh devnet` hash-checks the
  chain against that same file. Both print the path they used.
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
   keypair, so it picks up where it stopped instead of re-uploading 363 KB.
3. To abandon it and take the SOL back:

   ```
   solana program close --buffers --keypair ~/.config/solana/pangu-devnet.json --url https://api.devnet.solana.com
   ```

`deploy.sh` prints these same three lines whenever an attempt fails, and its
closing report says how many buffers are still holding SOL.

## Mainnet

Not deployed. Mainnet is Ram's decision and gets its own work order, its own
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
