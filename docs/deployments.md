# Deployments

Where the Pangu program lives on chain, what it cost, and how to put a new build
there. Every number below was read back off the chain, not copied from a plan.

## Devnet (live)

| Fact | Value |
| --- | --- |
| Program id | `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG` |
| Program data account | `58UAoZWuoMpnV4HzydaVUai9U7DFzapFtN5KtAzkzDpY` |
| Running since slot | 502981972 |
| Running since | 2026-09-23 14:08:42 UTC |
| Upgrade authority (public key) | `Fwi8ejZ8kqF8PwcxssHFqJQZmVrkmBfoaXV5CTjqp5L` |
| Build running there | `pangu.so`, the devnet build (`--features devnet`) of the rules v2 program |
| Build size | 363,800 bytes |
| Program account size | 442,320 bytes (the first build plus 20 percent headroom) |
| Rent locked | 2.24786444 SOL |
| sha256 of the deployed build | `e40ab680c3ff8a806e51b66b014765674b95ccbd6ead553729689ab20c4cb59f` |
| sha256 of the IDL clients build against | `48836ab193d10b8a58321a9f6777640bc43873f207a6210f2de18c1a47032772`, as the build writes it. The SDK's copy holds the same JSON with different whitespace |
| Loader | BPF upgradeable loader, SBPF v0 bytecode |
| Toolchain | Anchor 1.2.0, solana-cli 4.2.2 |
| Explorer | https://explorer.solana.com/address/4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG?cluster=devnet |

The bytes running on devnet were checked against the local build again on 23
September, straight after the fifth deploy:

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/program-info.sh devnet
DEPLOYED SLOT: 502899538
PROGRAM DATA LENGTH: 442320 bytes
ON-CHAIN SHA256: 191e9cf1ab6f9ababc1fb50c1f279b7f19e305934fff0952f8155b4f85a10731
HASH MATCH: YES
```

## Two builds, one list apart

The devnet and mainnet builds are the same program except for one list: the
dollar tokens a price ceiling may be paid in. A ceiling compares the curve's
price with a dollar price from Pyth, so it only means something when buyers pay
in a dollar. `DOLLAR_MINTS` in `create_sale.rs` holds USDC for mainnet, and,
with the `devnet` cargo feature, devnet USDC and the demo dollar. A sale with no
ceiling may be paid in any token, including a tokenized stock such as AAPLx.

`scripts/wsl/build.sh` builds the devnet binary and checks it holds both devnet
dollars and none of mainnet USDC. The mainnet build is the same command without
the feature, written at the top of `build.sh`; no script deploys it.

Pyth's receiver program and price feed program sit at the same addresses on both
networks, so nothing else differs between the builds. An earlier arrangement of
two binaries existed while the band read Switchboard, whose program has a
different address on each network; moving the band to Pyth removed that reason.

## The six deploys

Same address every time. An upgrade replaces the code in the account that is
already there, so nothing a client or a saved account points at ever moves.

| # | Slot | When (UTC) | What went on chain | Signature |
| --- | --- | --- | --- | --- |
| 1 | 502338042 | 2026-09-22 08:30:39 | First deploy, the Switchboard build | `5eR1vqbvD7jU2GEVerPoseofDFGiudGkdcP94o6Zx6xJJFmjHBVuZK1uAyjptZWNqV9hKchAFgm9CSCJjrFY9RoJ` |
| 2 | 502373496 | 2026-09-22 10:08:31 | The program and SDK review fixes | `2cXwvQZAGirGzY11ydL5aWKuF8WDogFCTXrobrnHNR9k7nHpbcfRvnpdus8E66EyJMkDB4JcBgT5xeeBsHaeDgMr` |
| 3 | 502436678 | 2026-09-22 13:02:53 | The price band moved from Switchboard to Pyth | `4RdQw1FvbULYtnyjY2mxBoj8Q9XpGCwygnJuDz7qXVwLSLqbVd8tp8BvHoxDwJKd3qVsBegt76PB3MiWHtm5pq7L` |
| 4 | 502476730 | 2026-09-22 14:53:26 | The SaleRules layout version, so a reader refuses rules written by another layout | `fomCUUu2u7MThsTpUyxwHXwyGTpNawwqKNZW8HaKExWZJpp3bKNS1xGhepZKKPxVFjJ4MdeL3MSPGqfqTK96eX7` |
| 5 | 502899538 | 2026-09-23 10:21:01 | Rules v2: the paying token is stored and checked, banded sales must be dollar priced, the cap stays below the curve's supply, every sale carries an offering period, and events name the sale's mint | `4GQ2J5s1QmypeiDfeRwCGpZN13TpmMTQoXNnWnQq3jtxFW88cudEr5fjyxA9c8qbBitT5JuC7AHRgtSCGaUpokZ4` |
| 6 | 502981972 | 2026-09-23 14:08:42 | A price ceiling only when buyers pay in a listed dollar for the network; the devnet build carries devnet USDC and the demo dollar | `4ep1rYGmZJXns7Efu22HmR1fHfKZQrnhznoMj3vjA7ZYxQi27yqkPPvix6fqv72ZHyrSVmFNiU6Kf4a4btauEPZ6` |

| # | Build | sha256 | Size |
| --- | --- | --- | --- |
| 1 and 2 | `pangu-devnet.so`, built with `--features devnet` | `58f22ae2136edc6f6fd35edc5aec1bb27f3a5548d39fb94b4c530c8dbad0eb34` | 371,488 bytes |
| 3 | `pangu.so`, the one binary | `08746faa7b4ac83ada7bfa0cd2fcf0b04aabc9c335ebfc310fd2a06d486d3a7c` | 356,200 bytes |
| 4 | `pangu.so`, with the layout version | `a937c610ab35442df59e0ead889a98ea8acafb396f2de9f2c37355ee5a555beb` | 358,248 bytes |
| 5 | `pangu.so`, rules v2 | `191e9cf1ab6f9ababc1fb50c1f279b7f19e305934fff0952f8155b4f85a10731` | 363,720 bytes |
| 6 | `pangu.so`, rules v2, devnet build with the dollar list | `e40ab680c3ff8a806e51b66b014765674b95ccbd6ead553729689ab20c4cb59f` | 363,800 bytes |

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
- **Fifth, about 0.0018 SOL**, fees only, no new rent: the payer went from
  9.93791008 SOL to 9.93609508 SOL. WSL was dropping its connection to the
  devnet node straight after heavy builds, so this one deployed a build already
  made and hash checked (`REUSE_BUILD=1` with `BUILD_SHA256`, through
  `scripts/wsl/deploy-reuse.sh`) from a fresh WSL session. The upgrade landed,
  and then the balance read inside `deploy.sh` failed on the same drop, which is
  why the facts above were read back with `program-info.sh` on its own.

The rules v2 build reads version 1 rules as well as its own, so the sales
already open on devnet before it (PBAND, and the list sales) keep working. They
simply have no offering period and read as never ending.

The account was created 20 percent larger than the first build so a later,
bigger build can still be upgraded in place at the same address. That headroom
costs 0.37449760 SOL of extra rent, locked for as long as the program exists.
Without it a bigger build would need a brand new address, and every client and
every saved account would have to be pointed somewhere else. The build on chain now is
7,768 bytes smaller than the Switchboard one it replaced, so the headroom is
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
