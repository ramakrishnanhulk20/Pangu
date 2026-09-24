# Going live on mainnet

Pangu is not on mainnet yet. Everything needed to put it there is ready and has
been run once on a forked copy of mainnet (`docs/measurements/mainnet-rehearsal.md`).
The founder decided on 23 September 2026: mainnet-ready now, deploy later, and
the founder keeps the upgrade key at launch. This page is the whole procedure,
in order.

No agent runs any of this against mainnet. The deploy is the founder's, with
the founder's own key.

## What it costs

For the SBPF v3 build, 337,856 bytes: rent at mainnet's rate as read on 23
September 2026, and fees as measured on the rehearsal:

| What | SOL | Comes back? |
| --- | --- | --- |
| Rent for the program's code account, 405,427 bytes of room (the SBPF v3 build plus 20 percent, so a bigger build can be upgraded in place later) | 2.06044800 | No, it stays locked while the program exists |
| Rent for the program account itself | 0.00083312 | No |
| Fees for the upload, about 334 write transactions at a priority fee of 100,000 micro-lamports per compute unit | about 0.0019 | No |
| The upload buffer, held while the code is uploaded | 1.71714668 | Yes, in the same transaction that puts the code in place |
| **Spent for good** | **about 2.063** | |
| **Held at the peak** | **about 3.780** | |

`deploy-mainnet.sh` refuses to start unless the deployer wallet holds at least
**4.5 SOL**, or the computed peak plus 0.1 SOL if that is ever higher. Put 4.6
SOL in it. What is left after the deploy stays in the wallet.

After the launch:

| What | Cost |
| --- | --- |
| A Squads v4 multisig for the upgrade key, later | about 0.0025 SOL of rent; Squads' creation fee is 0 today |
| A sale's template and pool plus rules, paid by the issuer | 10,000 lamports in fees each, plus the rent DBC takes for the accounts |
| A buy or a sell, paid by the buyer | 5,000 lamports in fees, 88,000 to 152,000 compute units on the rehearsal |
| One price refresh, paid by the refresher key | about 0.000035 SOL, measured on devnet |

## Before you start

1. **Windows, WSL and Docker.** The build runs in Docker inside WSL Ubuntu.
   Docker Engine is installed and running there today, and `solana-verify`
   0.5.2 is installed.
2. **A deployer wallet you control**, as a keypair file inside WSL, holding at
   least 4.5 SOL on mainnet. It pays for the deploy and becomes the upgrade
   authority. It is never assumed: the path is typed into the command.
3. **The program keypair** at `~/.config/solana/pangu-program-keypair.json` in
   WSL. It fixes the address `4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG`.
   The script checks it. Keep a second copy somewhere you control before the
   deploy.
4. **A keyed mainnet RPC node** (Helius, Triton, QuickNode) as
   `MAINNET_RPC_URL` in the repository root `.env`. The public node drops long
   uploads. The URL carries its key, and nothing prints it.
5. **One check of mainnet's feature gates.** Pangu is built as SBPF v3, and
   `verify-build.sh` refuses to hand over anything else. SIMD-0500 (feature
   `B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g`) stops SBPF v0, v1 and v2
   programs being deployed, upgraded or frozen once it is active, and leaves v3
   alone, so it no longer blocks this deploy or any later upgrade, whether it
   is active or not. The one thing that must hold is that mainnet still accepts
   v3 deploys, a gate active since epoch 993. Check it the day you deploy,
   reading the public node:

   ```
   solana feature status 5cC3foj77CWun58pC51ebHFUWavHWKarWyR5UUik7dnC --url mainnet-beta --keypair <your deployer file>
   ```

   "active" means go. Anything else means mainnet would refuse the v3 build:
   stop, and deploy nothing.

## The commands, in order

All of these run inside WSL from Windows. The long ones run detached with a log,
because WSL drops long calls; each script's header shows the detached form.
Build and deploy in separate WSL sessions (`wsl --shutdown` between them): WSL
has lost its network straight after heavy builds on this machine.

**1. Build the mainnet binary reproducibly.**

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/verify-build.sh
```

It builds the committed program twice in the Solana Foundation's pinned image
and refuses unless both builds hash the same. It ends with:

```
MAINNET SHA256: 16a13b7f8e9eab5f407d9564f8826bdca8390e6a28dc411a954adad7d3d7852e
VERIFY-BUILD-OK
```

That is the hash recorded in `docs/deployments.md`. If the program has changed
since commit `8ffda721`, the hash changes too; record the new one before going
on.

**2. Rehearse, if anything changed since the last rehearsal.**

```
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/Projects/Meteora/scripts/wsl/mainnet-rehearsal.sh <the sha256 from step 1>
```

It runs step 3 against a forked copy of mainnet, the sales, and the multisig
upgrade, and ends with `MAINNET-REHEARSAL-OK`. About fifteen minutes.

**3. Deploy.** In a fresh WSL session, inside WSL:

```
PANGU_MAINNET_GO="deploy pangu to mainnet" bash /mnt/d/Projects/Meteora/scripts/wsl/deploy-mainnet.sh \
  ~/pangu-release/pangu-mainnet.so \
  16a13b7f8e9eab5f407d9564f8826bdca8390e6a28dc411a954adad7d3d7852e \
  <path to your deployer keypair file>
```

It checks the phrase and the binary's hash, then proves by itself that the
binary is the mainnet build: SBPF v3, carrying mainnet USDC and neither devnet
dollar, judged by the same code `verify-build.sh` runs
(`scripts/wsl/lib-binary-checks.sh`). The hash is a second check, not the only
one, so typing the devnet build's own hash still gets it refused before
anything is read from the network. Then it checks the program keypair, that the node is
mainnet (by its genesis hash), and the deployer's balance. Then it prints the
plan and the costs and waits. Read them, type `yes`, and it uploads, deploys and
reads the code back. It ends with:

```
ON-CHAIN SHA256: 16a13b7f8e9eab5f407d9564f8826bdca8390e6a28dc411a954adad7d3d7852e
HASH MATCH: YES
DEPLOY-MAINNET-OK
```

If the upload stops part way, run the same command again: it resumes from the
named buffer at `~/.config/solana/pangu-mainnet-buffer.json`. Running it after a
successful deploy sends nothing and says `ALREADY UP TO DATE`.

**4. Read it back.** `deploy-mainnet.sh` has already dumped the code and
compared its hash. `program-info.sh` reads devnet only today, so for a second
look use the Solana CLI and solana-verify, both reading only:

```
solana program show 4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG --url "$MAINNET_RPC_URL" --keypair <your deployer file>
solana-verify get-program-hash 4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG --url "$MAINNET_RPC_URL"
```

The second prints `3b8cea90deb0efdda3de722f36a5d0324eec217e710c318f2c48bebcbb3d93b8`,
the executable hash `verify-build.sh` printed for the same binary.

**5. Status, read only.** From Windows, in `packages/scripts`:

```
npm run status -- --network mainnet
```

It checks that the program on mainnet is the verified build, who holds the
upgrade key, every Pangu sale on the chain, and how fresh each banded sale's
price is. It loads no key, and every command that writes still refuses anything
but devnet. Before the deploy its program row says FAIL, not deployed yet.

**6. Record it.** Fill the Mainnet table in `docs/deployments.md` with what step
3 printed: program data address, slot, signature, upgrade authority, size, rent.

**Optional: the verified badge on explorers.** Once the repository is public at
the commit that was built:

```
solana-verify verify-from-repo https://github.com/ramakrishnanhulk20/Pangu \
  --program-id 4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG \
  --commit-hash 8ffda72100f07046fe85a6132f126f915acb29f8 \
  --mount-path packages/program --library-name pangu \
  --base-image solanafoundation/solana-verifiable-build:4.2.2 --arch v3 \
  --url "$MAINNET_RPC_URL" --keypair <your deployer file>
```

It rebuilds from GitHub, compares with the program on chain, and asks before
writing a small verification record on mainnet signed by the upgrade key. That
record is a mainnet transaction and it is yours to send.

## The web app on mainnet

`packages/web` has a mainnet mode. One build setting picks the network:
`NEXT_PUBLIC_PANGU_NETWORK=mainnet` for the product, `devnet` or unset for the
demo, and every per-network fact lives in `packages/web/lib/network.ts`. The
mainnet build was run against the forked-mainnet validator from the rehearsal,
with USDC and AAPLx, and every check passed:
`packages/web/lab-evidence/network-fork.txt`. The full variable list, with
where each is read, is in `docs/deploy/vercel.md`. These are the Vercel settings
that differ on mainnet:

| Setting | Devnet | Mainnet |
| --- | --- | --- |
| `NEXT_PUBLIC_PANGU_NETWORK` | `devnet`, or unset | `mainnet`. Read at build time, so changing it needs a redeploy; any other value stops the build |
| Server RPC | `DEVNET_RPC_URL`, keyed | `MAINNET_RPC_URL`, a keyed mainnet node, server only |
| Browser RPC | `NEXT_PUBLIC_DEVNET_RPC_URL` | `NEXT_PUBLIC_MAINNET_RPC_URL`, the public node when unset, or a key restricted to the site's origin; it must not contain the word devnet |
| Paying tokens at launch | the demo dollar, SOL | USDC, and the xStocks AAPLx, TSLAx, NVDAx and SPYx, each offered only while its Meteora token badge reads back from the chain |
| Dollar a ceiling is paid in | the demo dollar `2TYsrKmX...` | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, the only one the mainnet build accepts (`dollarMints("mainnet")`) |
| Demo dollars button | `DEMO_DOLLAR_MINT_AUTHORITY` | none: leave the key out, and `POST /api/break/dollars` answers 404 |
| Attack ledger | simulate, or send for real | simulate only |
| Price refresher's key | `DEMO_DOLLAR_MINT_AUTHORITY` pays for refreshes | `PRICE_REFRESH_KEY`, its own mainnet key holding real SOL, server only. At most one refresh a minute, about 0.000035 SOL each: worst case about 0.05 SOL a day, in practice only when a banded sale is visited with a price over ten minutes old. Fund it with 0.5 SOL; under 0.05 SOL it stops posting and the page says the price is waiting |
| `PYTH_API_KEY` | the granted trial key | the team's trial runs to 5 October 2026; mainnet needs a paid key after that |

## The DBC token badge for AAPLx-paid sales

A sale paid in a tokenized stock needs Meteora's token badge for that stock,
which only a Meteora operator can create. AAPLx has one on mainnet today, read
on chain on 23 September 2026 at slot 449746171:

| Fact | Value |
| --- | --- |
| Badge account | `8VeVZe3Zxfpax2qQUp7i68FCLspLYErm2FJChc5NDuVn` |
| Owner | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`, Meteora's Dynamic Bonding Curve |
| Token it badges | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`, AAPLx |

DBC wants the badge on the template and again on the pool. `pangu-sdk` takes
it in both places: `launchTemplateTransaction` and `openSaleTransaction` each
accept a `tokenBadge`, and a pool opened without it is refused with
`InvalidTokenBadge`, as the rehearsal shows. A sale with a price ceiling must
be paid in USDC on mainnet; AAPLx-paid sales run without one.

## The upgrade authority plan

**At launch the founder keeps the key.** The deployer wallet is the upgrade authority.
It can replace the program's code at any time, including during a live sale.
The README, the docs and the app say so openly.

**Then a Squads v4 multisig**, so no single key can change the code. Rehearsed
end to end on the fork with Squads' real mainnet program:

1. Create a multisig in the Squads app (app.squads.so) with, say, two of three
   members, each a key held by a different person or device. Its vault, index
   0, is the address that will hold the upgrade authority.
2. Hand the upgrade authority to the vault, signed by the current key:

   ```
   solana program set-upgrade-authority 4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG \
     --new-upgrade-authority <vault address> --skip-new-upgrade-authority-signer-check \
     --upgrade-authority <your deployer file> --keypair <your deployer file> --url "$MAINNET_RPC_URL"
   ```

   The vault cannot sign this itself, which is why the check is skipped. Paste
   the vault address, then read it back with `solana program show` before
   anything else: a wrong address here hands the program to nobody.
3. Test an upgrade proposal before you need one: build, upload the new code to
   a buffer with `solana program write-buffer`, hand the buffer to the vault
   with `solana program set-buffer-authority <buffer> --new-buffer-authority
   <vault address>`, then propose the upgrade in the Squads app, approve it
   twice, and execute it. On the fork: one approval was refused with
   `InvalidProposalStatus`, two carried the upgrade, the old key was refused
   with `Incorrect authority provided`, and the vault stayed the authority.
4. **Freeze** once an independent audit is done and the program has run quietly
   for a stretch: `solana program set-upgrade-authority 4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG --final`,
   proposed and approved through the multisig. This cannot be undone. After it,
   a bug can only be fixed by a new program at a new address.

## What to watch in the first week

- **`npm run status -- --network mainnet` every day.** A FAIL on the program row
  means the code on chain is not the verified build.
- **The upgrade key.** It can change everything. Keep it off any machine that
  browses the web, and move it to the multisig as soon as it is set up.
- **The price refresher's SOL and the Pyth key.** A banded sale shuts every buy
  an hour after its last price. The refresher's wallet running dry, or the Pyth
  trial ending on 5 October, stops refreshes; status shows a stale price as FAIL
  during market hours.
- **Leftover upload buffers.** `solana program show --buffers --keypair <your
  deployer file> --url "$MAINNET_RPC_URL"` should list none after the deploy; if
  one is there, `solana program close <buffer>` takes its SOL back.
- **SIMD-0500 on mainnet.** It does not touch this program: the build is SBPF
  v3, and SIMD-0500 only refuses v0, v1 and v2 binaries. Once it is active,
  every upgrade and the freeze must stay v3, which `verify-build.sh` already
  guarantees by refusing any other version.
- **The first real sales.** A ceiling only on USDC, a cap below the curve, an
  offering end in the future: the program refuses anything else, and the
  refusal names are in the SDK's error list.
