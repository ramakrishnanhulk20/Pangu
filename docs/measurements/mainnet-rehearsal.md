# The mainnet rehearsal

Date: 23 September 2026. Every number here came out of a command that ran. No
transaction was sent to mainnet: mainnet was only read, by the forked validator
copying its accounts and by a handful of read-only RPC calls noted below.

Going live is one command the founder runs with the founder's own key (`docs/deploy/mainnet.md`).
This is the record of running every line of it first, on a local validator that
holds copies of mainnet's real programs and tokens: Meteora's Dynamic Bonding
Curve and DAMM v2, USDC, AAPLx and its DBC badge, Squads v4, and mainnet's own
feature gates.

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/verify-build.sh
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/mainnet-rehearsal.sh f15f65ed8dcf4a64380babf010b2f132fd71645669b0c3b4fbd9ff2c00461358
```

Both run detached with a log (the header of each script shows how), and they
were run in separate WSL sessions, the build first.

## 1. The verified build

`verify-build.sh` builds the committed `packages/program` folder of commit
`3e9074c8e2bd2cec40a4ce3b0984a7b09e3d7c63` with `solana-verify build` 0.5.2 in
`solanafoundation/solana-verifiable-build:4.2.2`, twice, from two fresh copies,
and refuses unless the two hash the same. It then builds the devnet binary from
the same source with `--features devnet`.

```
MAINNET LENGTH: 366968 bytes
MAINNET SHA256: f15f65ed8dcf4a64380babf010b2f132fd71645669b0c3b4fbd9ff2c00461358
MAINNET SHA256, SECOND BUILD: f15f65ed8dcf4a64380babf010b2f132fd71645669b0c3b4fbd9ff2c00461358 (the same, so the build repeats)
MAINNET EXECUTABLE HASH (solana-verify): 474fa2628a7498fe71c3c21ebc459034ffcbe59eac86fae7b110ccd9fe8e86e0
DEVNET LENGTH: 367144 bytes
DEVNET SHA256: 3280a33969c174e18679a551b265d45b25da2e0411906302bcd1ec9b6346f2ad
VERIFY-BUILD-OK
```

The script was run a second time later the same day, after other folders had
moved on to commit `7c34136a1b9b345ca6fa9174139cb0aea8ac9efc` (nothing in
`packages/program` changed between the two). It built the same
`f15f65ed8dcf4a64380babf010b2f132fd71645669b0c3b4fbd9ff2c00461358` twice more:
four builds, one hash.

The two builds carry exactly one list apart, checked by looking for each program
id's eight 4 byte pieces in the binary: the mainnet build carries mainnet USDC
(8 of 8) and neither devnet dollar (0 of 8), the devnet build the reverse. Both
carry Pyth's receiver and price feed programs. The devnet binary is 176 bytes
longer because its list holds two dollars instead of one.

Docker Engine was already installed and running in the Ubuntu WSL distro, with
the `ram` user in the `docker` group, so nothing was installed for it.
`solana-verify` 0.5.2 was installed with `cargo install --locked`. Cargo inside
the build container stalled on the crates.io index until HTTP multiplexing was
turned off, the same fix this machine's own `~/.cargo/config.toml` carries; the
script writes that setting into each build copy, which changes how crates are
downloaded and not what is compiled.

## 2. deploy-mainnet.sh, rehearsed

Six runs that had to be refused, and were, each with exit code 2 and nothing
sent:

```
REFUSED AS EXPECTED: no phrase
REFUSED AS EXPECTED: the wrong phrase
DEPLOY-REFUSED: ~/pangu-release/pangu-devnet.so hashes to 3280a339..., not the f15f65ed... given. Deploy only the binary verify-build.sh printed.
REFUSED AS EXPECTED: the devnet binary under the mainnet hash
REFUSED AS EXPECTED: no deployer keypair given
DEPLOY-REFUSED: the deployer holds less than the 5.722503760 SOL this deploy needs. Fund DpHXvMG7... and run it again.
REFUSED AS EXPECTED: a deployer holding 1 SOL
DEPLOY-REFUSED: the answer was not yes, so nothing was sent
REFUSED AS EXPECTED: an answer other than yes
```

Then the real run, answered `yes`:

```
PROGRAM ALREADY ON CHAIN: no
  1. Upload the binary into a named buffer, about 363 write transactions,
     each paying a priority fee of 100000 micro-lamports per compute unit.
  2. Create the program account at 440361 bytes (the build plus 20 percent, ...)
DEPLOYED SLOT: 19
PROGRAM DATA LENGTH: 440361 bytes
RENT LOCKED IN PROGRAM ACCOUNT: 3.06611664 SOL
BALANCE BEFORE: 10.000000000 SOL
BALANCE AFTER: 6.930704080 SOL
SOL SPENT: 3.069295920 SOL, rent and fees together
UPLOAD BUFFER: closed, its SOL came back
LOCAL SHA256:    f15f65ed8dcf4a64380babf010b2f132fd71645669b0c3b4fbd9ff2c00461358
ON-CHAIN SHA256: f15f65ed8dcf4a64380babf010b2f132fd71645669b0c3b4fbd9ff2c00461358
HASH MATCH: YES
DEPLOY-MAINNET-OK
```

A second run found the code already there and sent nothing:
`ALREADY UP TO DATE: the code on chain already hashes to f15f65ed.... No
transaction was sent.`

**What it costs on mainnet.** The local validator charges the default rent,
which is higher than mainnet's. Mainnet's own answer, read with
`getMinimumBalanceForRentExemption` on 23 September:

| Account | Bytes | Mainnet rent | Fork rent |
| --- | --- | --- | --- |
| Program data (440,361 bytes of code room plus a 45 byte header), locked for good | 440,406 | 2.23791272 SOL | 3.06611664 SOL |
| Program account, locked for good | 36 | 0.00083312 SOL | 0.00114144 SOL |
| Upload buffer, held during the upload and refunded | 367,005 | 1.86503564 SOL | 2.55524568 SOL |

Fees measured on the fork: 3.069295920 - 3.066116640 - 0.001141440 =
0.00203784 SOL for the whole upload and deploy at 100,000 micro-lamports per
compute unit. So on mainnet: about **2.2408 SOL spent for good**, about **4.104
SOL held at the peak**, and `deploy-mainnet.sh` asks for at least **4.5 SOL**
in the deployer, the floor the plan set, because the computed need (peak plus
0.1 SOL) is below it there.

**A finding the rehearsal turned up.** The first attempt failed at the final
step: `Detected sbpf_version required by the executable which are not enabled`.
A local validator turns every feature gate on, including SIMD-0500 (feature
`B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g`), which stops SBPF v0, v1 and v2
programs being deployed. Pangu is built as v0. Mainnet's and devnet's feature
accounts were read the same day: SIMD-0500 has no feature account on either
network, so it is neither active nor scheduled, and SBPFv3 is active on both
(mainnet since slot 428976000). The rehearsal now starts the validator with
mainnet's own feature set (`MATCH_MAINNET_FEATURES=1`, which passes
`--clone-feature-set`). The day SIMD-0500 is scheduled on mainnet, a v0 build
can no longer be deployed or upgraded there; `docs/deploy/mainnet.md` says what
to check.

## 3. The sales, through pangu-sdk only

`packages/sdk/fork-test/rehearsal.ts`, against the program the rehearsed deploy
put there. Apple's price is the real Equity.US.AAPL/USD feed id on Pangu's own
shard 7700, written before genesis in the layout Pyth's receiver writes, the
way the program's own price-band fork test writes its prices. The throwaway
wallets were handed 200,000 USDC each the same way, as token accounts written at
genesis, because nobody local holds Circle's mint authority.

A price written at genesis never moves, so the ceiling cannot be lifted partway
through a sale, and a sale whose ceiling binds cannot graduate. So (a) runs two
USDC sales under the same Apple price and the same five percent ceiling: one
curve climbs through the ceiling, the other finishes below it. The program's
price-band fork test does the same with two pools.

```
apple 0.029760 dollars, ceiling 0.031248; crossing curve 0.015625 to 0.250000, graduating curve 0.000031 to 0.000500
```

**(a) USDC, a five percent ceiling on Apple, a fourteen day offering**

```
== a1. the mainnet build lists USDC and nothing else
== a2. a USDC template and a sale with a 5 percent ceiling on Apple and a 14 day offering
   mint JAzixszSUcmCVMTnpEH9F9SC29D1hE1Q6CQWygGuBL22, cap 399999999825 raw units, offering ends 2026-10-07T15:34:21.000Z
   Apple 0.02976 dollars on shard 7700, ceiling 0.031248, confidence 7 basis points
== a3. a buy under the cap
   paid 100 USDC for 6380181455 raw units
== a4. a buy over the cap is refused
   buy over the cap, USDC: refused with OverCap
== a5. buying until the ceiling refuses
   round 19: the preflight says the curve would land at 0.031319 against a ceiling of 0.031248
   buy past the ceiling, USDC: refused with PriceOutsideBand
   curve at 0.030009, ceiling 0.031248
== a6. a holder sells back at the ceiling
   sold 199999930266 raw units back for 5835.239626 USDC
== a7. a second USDC curve under the same Apple price and ceiling, bought to graduation
   raised 100000.000001 of 100000 USDC, curve finished at 0.000500 under a ceiling of 0.031248
== a8. anyone migrates the graduated pool to DAMM v2
   DAMM v2 pool HVQRMoZ7yiH9q8hiXAB33BhS2gn2rCDU434dWEkeDkK8, 7 buyers, largest 20.00 percent against a cap share of 20.00 percent
```

Every buy was checked with `preflightBuy` first, and the chain agreed with the
preflight every time, including both refusals. The rules on chain record USDC
as the paying token and the end of the offering fourteen days out.

**(b) AAPLx, no ceiling**

```
== b1. an AAPLx template, with DBC's badge for AAPLx
== b2. the pool as openSaleTransaction builds it, with no badge on the pool instruction
   refused by DBC: AnchorError occurred. Error Code: InvalidTokenBadge. Error Number: 6080. Error Message: Invalid token badge.
== b3. a ceiling on a sale paid in AAPLx is refused
   ceiling on an AAPLx sale: refused with BandNeedsDollarQuote
== b4. the AAPLx sale with no ceiling, the badge added to the pool instruction
== b5. a buy and a sell, paid in AAPLx
   1 AAPLx bought 30992545499318 raw units; selling half returned 0.50483727 AAPLx
```

**A second finding.** DBC wants the AAPLx badge on the pool instruction as well
as on the template. `launchTemplateTransaction` takes a `tokenBadge`;
`openSaleTransaction` does not, so an AAPLx-paid sale opened through the SDK as
it stands is refused with `InvalidTokenBadge`. The rehearsal adds the badge to
the pool instruction itself (`withBadge` in `rehearsal.ts`), and with it the
sale opens, trades and refuses a ceiling as it should. The SDK needs the same
option before an issuer can open an AAPLx-paid sale through it.

**(c) the demo dollar on the mainnet build**

```
== c. a ceiling on the demo dollar is refused by the mainnet build
   ceiling on the demo dollar: refused with BandNeedsDollarQuote
```

The same mint, planted at genesis, is where every banded sale in the devnet
build's fork suite is paid, so the refusal is the build and not the token.

**What each action cost on the fork.** Fees are the base fee per signature;
no priority fee was added to the sales.

| Action | Bytes | Compute units | Fee (lamports) |
|---|---|---|---|
| USDC launch template | 662 | 30,863 | 10,000 |
| USDC pool plus rules with a ceiling | 953 | 94,838 | 10,000 |
| buy under the cap, USDC (opens the buyer's record) | 938 | 144,447 | 5,000 |
| a later buy on a banded sale, USDC | 912 | 115,992 to 127,956 | 5,000 |
| a buy on a banded sale that opens a record, USDC | 938 | 150,403 to 160,916 | 5,000 |
| sell back, USDC | 912 | 99,526 | 5,000 |
| the buy that fills the curve, USDC | 938 | 163,084 | 5,000 |
| migrate to DAMM v2, USDC | 1,139 | 152,453 | 15,000 |
| AAPLx launch template | 695 | 33,062 | 10,000 |
| AAPLx pool plus rules | 952 | 98,110 | 10,000 |
| buy, AAPLx | 872 | 113,832 | 5,000 |
| sell, AAPLx | 846 | 83,540 | 5,000 |

## 4. The upgrade authority plan, rehearsed

`packages/sdk/fork-test/rehearsal-squads.ts` against Squads v4's real mainnet
program, with its program config and treasury cloned. The creation fee in that
config is 0 lamports.

```
== s1. a two of three Squads v4 multisig
   multisig Heif8A4JFpVerhjSNWY3Ac4jqMHaGpU5zAfBCsRrDXU7, threshold 2 of 3
   the creator spent 0.00250864 SOL, rent for the multisig account included
UPGRADE AUTHORITY: H8FGrWXQRVKahmtQKxDMN9ay2n6JG7hJLS3SkL7AGq6C, the multisig vault
== 3. the old key alone can no longer upgrade
REFUSED AS EXPECTED: Error: Upgrading program failed: ... Incorrect authority provided
== s2. a proposal to upgrade Pangu from the buffer, signed by the vault
   proposal 1 created and approved by one member
== s3. one approval of two cannot carry it out
   refused: ... Error Code: InvalidProposalStatus. Error Number: 6008.
== s4. the second approval, and the upgrade carried out through the vault
   deployed slot 19 to 349, the upgrade authority is still the vault
SQUADS-UPGRADE-OK
ON-CHAIN SHA256 AFTER THE PROPOSAL: 3280a33969c174e18679a551b265d45b25da2e0411906302bcd1ec9b6346f2ad
DEVNET BUILD SHA256:                3280a33969c174e18679a551b265d45b25da2e0411906302bcd1ec9b6346f2ad
MAINNET-REHEARSAL-OK
```

The upgrade authority was handed over with the exact command the runbook gives
(`solana program set-upgrade-authority ... --skip-new-upgrade-authority-signer-check`),
the buffer's authority with `solana program set-buffer-authority`, and the
upgrade went through a vault transaction, a proposal and two approvals. The
proposal carried the devnet build only so the change shows in the hash.

## What this does not cover

- A live Pyth price. Apple's price is planted and never moves, so the guardian
  signatures and a price that moves mid-sale are not exercised here; the devnet
  runs in `docs/measurements/sdk-pyth.md` cover a real update.
- Mainnet's rent and fee market. The fork charges default rent; the mainnet
  figures above were read from mainnet. Priority fees on a busy mainnet can be
  higher than on a quiet local chain.
- The Squads web app, a time lock, and freezing the program with `--final`,
  which cannot be undone and was not run.
- Anything USDC's or AAPLx's issuers can do with their own powers over their
  tokens (freeze, permanent delegate, pause).
- The web app. Its mainnet build was run against this forked validator separately, in `packages/web/lab-evidence/network-fork.txt`.

## Run of 23 September 2026: the SBPF v3 build

Everything above was rehearsed again after both shipped binaries moved to SBPF
v3, the format that stays deployable once SIMD-0500 switches v0, v1 and v2 off.
No transaction was sent to mainnet.

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/verify-build.sh
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/mainnet-rehearsal.sh 16a13b7f8e9eab5f407d9564f8826bdca8390e6a28dc411a954adad7d3d7852e
```

**The verified build.** `verify-build.sh` now passes `--arch v3` to every
`solana-verify build` and refuses a binary whose ELF header says anything but
version 3. Commit `8ffda72100f07046fe85a6132f126f915acb29f8`, the same image:

```
TOOLS: solana-verify 0.5.2, docker 29.1.3, SBPF v3
MAINNET SBPF: v3
MAINNET LENGTH: 337856 bytes
MAINNET SHA256: 16a13b7f8e9eab5f407d9564f8826bdca8390e6a28dc411a954adad7d3d7852e
MAINNET SHA256, SECOND BUILD: 16a13b7f8e9eab5f407d9564f8826bdca8390e6a28dc411a954adad7d3d7852e (the same, so the build repeats)
MAINNET EXECUTABLE HASH (solana-verify): 3b8cea90deb0efdda3de722f36a5d0324eec217e710c318f2c48bebcbb3d93b8
DEVNET SBPF: v3
DEVNET LENGTH: 338016 bytes
DEVNET SHA256: d53b0d8520fb325f03345649e300be4d2a0f9682c7046270ed1b62282c38e09e
VERIFY-BUILD-OK
```

The dollar lists check out as before: the mainnet binary carries mainnet USDC
and neither devnet dollar, the devnet binary the reverse, both carry Pyth's two
programs. The v3 mainnet binary is 29,112 bytes smaller than the v0 one.

**The rehearsal.** `mainnet-rehearsal.sh` now refuses unless both release
binaries are v3, and the validator still runs mainnet's own feature gates
(`MATCH_MAINNET_FEATURES=1`). All six refusals held, then:

```
rehearsal binaries: ~/pangu-release/pangu-mainnet.so and ~/pangu-release/pangu-devnet.so, both SBPF v3
PROGRAM DATA LENGTH: 405427 bytes
RENT LOCKED IN PROGRAM ACCOUNT: 2.822976 SOL
SOL SPENT: 2.825992003 SOL, rent and fees together
UPLOAD BUFFER: closed, its SOL came back
ON-CHAIN SHA256: 16a13b7f8e9eab5f407d9564f8826bdca8390e6a28dc411a954adad7d3d7852e
HASH MATCH: YES
DEPLOY-MAINNET-OK
ALREADY UP TO DATE: the code on chain already hashes to 16a13b7f.... No transaction was sent.
```

The sales gave the same answers as on v0: a USDC buy under the cap, `OverCap`,
`PriceOutsideBand` at the ceiling, a sell back at the ceiling, a second USDC
curve bought to graduation and migrated (7 buyers, largest 20.00 percent
against a cap share of 20.00 percent), `InvalidTokenBadge` without the pool
badge, `BandNeedsDollarQuote` on AAPLx and on the demo dollar, and an AAPLx buy
and sell. The upgrade authority went to a Squads 2 of 3 vault, the old key was
refused with `Incorrect authority provided`, one approval was refused with
`InvalidProposalStatus`, and two carried a v3 to v3 upgrade:

```
SQUADS-UPGRADE-OK
ON-CHAIN SHA256 AFTER THE PROPOSAL: d53b0d8520fb325f03345649e300be4d2a0f9682c7046270ed1b62282c38e09e
DEVNET BUILD SHA256:                d53b0d8520fb325f03345649e300be4d2a0f9682c7046270ed1b62282c38e09e
MAINNET-REHEARSAL-OK
```

**Cost on mainnet for the v3 build.** The program data account is 405,472
bytes (405,427 of code room plus a 45 byte header) and the upload buffer
337,893. At mainnet's rent rate as read on 23 September (the rate that gave
2.23791272 SOL for 440,406 bytes above), that is 2.06044800 SOL locked for the
code, 0.00083312 SOL for the program account, and 1.71714668 SOL held by the
buffer during the upload. Fees on the fork were 0.00187456 SOL. So about
**2.063 SOL spent for good** and about **3.780 SOL held at the peak**, against
2.241 and 4.104 for the v0 build. These mainnet figures are computed from the
rate, not read for these exact sizes. `deploy-mainnet.sh` still asks for its
4.5 SOL floor.

**What each action cost on the fork, v0 against v3.** Whole transactions, one
sample each, DBC's work included:

| Action | v0 | v3 |
| --- | --- | --- |
| USDC pool plus rules with a ceiling | 94,838 | 102,302 |
| buy under the cap, USDC (opens the buyer's record) | 144,447 | 138,361 |
| a later buy on a banded sale, USDC | 115,992 to 127,956 | 108,419 to 121,917 |
| a buy on a banded sale that opens a record, USDC | 150,403 to 160,916 | 138,351 to 151,850 |
| sell back, USDC | 99,526 | 93,466 |
| the buy that fills the curve, USDC | 163,084 | 142,029 |
| migrate to DAMM v2, USDC | 152,453 | 146,453 |
| AAPLx pool plus rules | 98,110 | 99,566 |
| buy, AAPLx | 113,832 | 119,791 |
| sell, AAPLx | 83,540 | 88,017 |

The USDC buys and sells, where Pangu's band check runs, came in lower on v3;
the AAPLx pair and the two pool creations came in higher. A single figure moves
by up to about 15,000 units with the wallet, so no one row proves a change.

## Run of 24 September 2026: the deploy tool checks the build itself

The code review of 24 September found that `deploy-mainnet.sh` proved only
that the binary hashes to the hash typed in. The devnet build with its own
hash typed in reached the plan and would have deployed on `yes`, and mainnet
would then accept a ceiling on the demo dollar, whose mint authority is a
devnet key. The tool now runs the checks `verify-build.sh` runs, from the same
file (`scripts/wsl/lib-binary-checks.sh`): SBPF v3 in the ELF header, mainnet
USDC present, devnet USDC and the demo dollar absent. They run right after the
hash check, before anything is read from the network. No transaction was sent
to mainnet.

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/mainnet-rehearsal.sh 16a13b7f8e9eab5f407d9564f8826bdca8390e6a28dc411a954adad7d3d7852e
```

Seven refusals now, each with exit code 2 and nothing sent. The new one is the
devnet build given its own correct hash:

```
DEPLOY-REFUSED: ~/pangu-release/pangu-devnet.so hashes to d53b0d85..., not the 16a13b7f... given. Deploy only the binary verify-build.sh printed.
REFUSED AS EXPECTED: the devnet binary under the mainnet hash
DEPLOY-REFUSED: ~/pangu-release/pangu-devnet.so is not the mainnet build: it lacks mainnet USDC (0 of 8 pieces), carries devnet USDC (8 of 8 pieces), carries the demo dollar (8 of 8 pieces). Deploy only the mainnet binary verify-build.sh made.
REFUSED AS EXPECTED: the devnet binary with its own correct hash
```

The other five held as before (no phrase, the wrong phrase, no deployer key, a
deployer holding 1 SOL, an answer other than yes). The mainnet build passed the
new check, `BINARY BUILD: SBPF v3, mainnet USDC and neither devnet dollar (the
mainnet build)`, and the rest gave the same answers as the SBPF v3 run above:
`HASH MATCH: YES`, `DEPLOY-MAINNET-OK`, `ALREADY UP TO DATE` on the second run,
`OverCap`, `PriceOutsideBand`, `InvalidTokenBadge`, `BandNeedsDollarQuote` on
AAPLx and on the demo dollar, the old key refused, one approval refused with
`InvalidProposalStatus`, two carrying the upgrade, and `MAINNET-REHEARSAL-OK`.

**The SBPF check, run on its own.** Three files hit that check: the real SBPF
v0 build `build.sh` makes for the unit suite, a copy of the mainnet build with
the four version bytes at offset 48 set to 0, and a three byte file. Each was
given its own correct hash, under `--rehearse`, with the phrase set, and the
tool refused all three before any network call (the deployer path was an empty
file, because the check runs before a key is read):

```
bash scripts/wsl/deploy-mainnet.sh --rehearse ~/pangu-build/target/deploy/pangu-v0-for-unit-tests.so "$(sha256sum ~/pangu-build/target/deploy/pangu-v0-for-unit-tests.so | cut -d' ' -f1)" ~/identity-dummy-deployer
DEPLOY-REFUSED: ~/pangu-build/target/deploy/pangu-v0-for-unit-tests.so is SBPF v0, not SBPF v3. Deploy only the mainnet binary verify-build.sh made.
bash scripts/wsl/deploy-mainnet.sh --rehearse ~/identity-v0.so "$(sha256sum ~/identity-v0.so | cut -d' ' -f1)" ~/identity-dummy-deployer
DEPLOY-REFUSED: ~/identity-v0.so is SBPF v0, not SBPF v3. Deploy only the mainnet binary verify-build.sh made.
bash scripts/wsl/deploy-mainnet.sh --rehearse ~/identity-short.so "$(sha256sum ~/identity-short.so | cut -d' ' -f1)" ~/identity-dummy-deployer
DEPLOY-REFUSED: ~/identity-short.so is too short to carry an SBPF version, not SBPF v3. Deploy only the mainnet binary verify-build.sh made.
```

The three byte file first stopped the script with exit code 1 on `od`'s error
rather than a refusal; `sbpf_version` now never fails, so a file too short to
be a program is refused like any other wrong binary.

**A finding on the way.** The first two attempts stopped at the forked
validator: `clone_accounts failed: Failed to fetch: error sending request`. WSL
on this machine has no IPv6 route (a request to the keyed mainnet node over
IPv6 got no answer, the same request over IPv4 got 200), and that node's host
now publishes an IPv6 address, which the validator tried first. WSL's resolver
now lists IPv4 addresses first (one `precedence ::ffff:0:0/96 100` line in
`/etc/gai.conf`), and the third attempt passed.
