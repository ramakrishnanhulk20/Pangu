#!/bin/bash
# usage: mainnet-rehearsal.sh <mainnet sha256>
#
# Runs every step of going live on mainnet against a local validator that holds
# copies of mainnet's real programs and tokens, so nothing about the real run is
# being tried for the first time:
#   1. deploy-mainnet.sh --rehearse with the verified SBPF v3 mainnet build, after
#      seven runs it must refuse: no phrase, the wrong phrase, the wrong binary
#      for the hash, the devnet binary with its own correct hash, no deployer
#      key, a deployer holding 1 SOL, and an answer of "no"
#   2. the sales in packages/sdk/fork-test/rehearsal.ts: USDC with a ceiling on
#      Apple, AAPLx without one, and the demo dollar refused
#   3. the upgrade authority plan: a Squads v4 multisig, the upgrade authority
#      handed to its vault, and one upgrade carried out through a proposal
#
# It builds nothing. It needs verify-build.sh to have left ~/pangu-release, and
# fork-test.sh or build.sh to have left ~/pangu-build with its node modules,
# because the validator's AAPLx and price-band accounts are written from there.
# Nothing here sends a transaction anywhere but 127.0.0.1. Mainnet is only read,
# by the validator, to copy its accounts.
#
# The whole run takes longer than a single WSL call should, so start it detached
# and poll the log:
#
#   nohup setsid bash /mnt/d/Projects/Meteora/scripts/wsl/mainnet-rehearsal.sh <sha256> \
#     > ~/pangu-mainnet-rehearsal.log 2>&1 < /dev/null &
#   tail -5 ~/pangu-mainnet-rehearsal.log
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -uo pipefail

SCRIPTS=/mnt/d/Projects/Meteora/scripts/wsl
SDK_SRC=/mnt/d/Projects/Meteora/packages/sdk
SDK_WORK="$HOME/pangu-rehearsal-sdk"
REHEARSAL="$HOME/pangu-rehearsal"
RELEASE="$HOME/pangu-release"
MAINNET_SO="$RELEASE/pangu-mainnet.so"
DEVNET_SO="$RELEASE/pangu-devnet.so"
LOCAL="http://127.0.0.1:8899"
PROGRAM_ID="4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG"
PHRASE="deploy pangu to mainnet"
SQUADS_SDK="@sqds/multisig@2.1.4"

stop_validator() { bash "$SCRIPTS/fork-validator.sh" stop >/dev/null 2>&1; }
fail() {
  stop_validator
  echo "MAINNET-REHEARSAL-FAILED: $1"
  exit 1
}
hash_of() { sha256sum "$1" | cut -d' ' -f1; }
# The Solana CLI wants a signer even to read some accounts, so the rehearsal's
# throwaway deployer is named on every call rather than the machine's default key.
local_cli() { solana "$@" --url "$LOCAL" --keypair "$DEPLOYER"; }
show_authority() { local_cli program show "$PROGRAM_ID" | awk '/^Authority:/ {print $NF}'; }

WANT="$(printf '%s' "${1:-}" | tr 'A-F' 'a-f')"
[[ "$WANT" =~ ^[0-9a-f]{64}$ ]] || fail "give the mainnet sha256 verify-build.sh printed"
[ -f "$MAINNET_SO" ] && [ -f "$DEVNET_SO" ] || fail "no verified builds in $RELEASE, run verify-build.sh first"
[ "$(hash_of "$MAINNET_SO")" = "$WANT" ] || fail "$MAINNET_SO does not hash to $WANT"
# Both binaries Pangu ships are SBPF v3, the format that stays deployable once
# SIMD-0500 is active, so the rehearsal deploys and upgrades nothing older.
sbpf_version() { od -An -t u4 -j 48 -N 4 "$1" | tr -d ' '; }
for so in "$MAINNET_SO" "$DEVNET_SO"; do
  [ "$(sbpf_version "$so")" = "3" ] || fail "$so is SBPF v$(sbpf_version "$so"), not v3; run verify-build.sh again"
done
echo "rehearsal binaries: $MAINNET_SO and $DEVNET_SO, both SBPF v3"
[ -d "$HOME/pangu-build/node_modules" ] || fail "~/pangu-build has no node modules, run fork-test.sh once first"

# Every run must refuse with DEPLOY-REFUSED and exit code 2, and nothing else.
expect_refusal() {
  local label="$1"
  shift
  local output code
  output="$("$@" 2>&1)"
  code=$?
  if [ "$code" -ne 2 ] || ! printf '%s' "$output" | grep -q DEPLOY-REFUSED; then
    printf '%s\n' "$output" | tail -n 8
    fail "$label was not refused (exit $code)"
  fi
  printf '%s\n' "$output" | grep DEPLOY-REFUSED
  echo "REFUSED AS EXPECTED: $label"
}

echo "== the mainnet program binaries"
bash "$SCRIPTS/fetch-fixtures.sh" || fail "the fixtures could not be fetched"

echo "== the SDK, mirrored to the WSL filesystem"
mkdir -p "$SDK_WORK"
rsync -a --delete --exclude node_modules --exclude dist "$SDK_SRC/" "$SDK_WORK/"
cd "$SDK_WORK" || fail "no $SDK_WORK"
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install --no-audit --no-fund || fail "npm install failed"
fi
# The Squads SDK is only needed here, so it is added to this copy without
# touching the package's own dependency list.
if [ ! -d node_modules/@sqds/multisig ]; then
  npm install --no-save --no-audit --no-fund "$SQUADS_SDK" || fail "the Squads SDK did not install"
fi

echo "== the accounts written before genesis: Apple's price and the USDC wallets"
stop_validator
rm -rf "$REHEARSAL"
mkdir -p "$REHEARSAL"
npx tsx fork-test/rehearsal-accounts.ts > "$REHEARSAL/account-list.txt" 2> "$REHEARSAL/accounts.log" \
  || { cat "$REHEARSAL/accounts.log"; fail "the rehearsal accounts could not be written"; }
grep -v "bindings" "$REHEARSAL/accounts.log"

echo "== the forked validator, with Pangu's address left empty"
LEAVE_PANGU_ADDRESS_EMPTY=1 MATCH_MAINNET_FEATURES=1 \
  REHEARSAL_ACCOUNT_LIST="$REHEARSAL/account-list.txt" \
  bash "$SCRIPTS/fork-validator.sh" || fail "the forked validator did not start"

DEPLOYER="$REHEARSAL/deployer.json"
THIN="$REHEARSAL/thin-deployer.json"
solana-keygen new --no-bip39-passphrase --silent --outfile "$DEPLOYER" >/dev/null
solana-keygen new --no-bip39-passphrase --silent --outfile "$THIN" >/dev/null
local_cli airdrop 10 "$(solana-keygen pubkey "$DEPLOYER")" >/dev/null || fail "no airdrop"
local_cli airdrop 1 "$(solana-keygen pubkey "$THIN")" >/dev/null || fail "no airdrop"
EMPTY="$(local_cli account "$PROGRAM_ID" 2>&1)" && fail "something is already at $PROGRAM_ID before the deploy"
printf '%s' "$EMPTY" | grep -q "AccountNotFound" || { echo "$EMPTY"; fail "the node did not say whether $PROGRAM_ID is empty"; }
echo "nothing at $PROGRAM_ID yet"
DEPLOY=(bash "$SCRIPTS/deploy-mainnet.sh" --rehearse)

echo "== 1. deploy-mainnet.sh refuses what it must"
expect_refusal "no phrase" env -u PANGU_MAINNET_GO "${DEPLOY[@]}" "$MAINNET_SO" "$WANT" "$DEPLOYER"
expect_refusal "the wrong phrase" env PANGU_MAINNET_GO="deploy pangu" "${DEPLOY[@]}" "$MAINNET_SO" "$WANT" "$DEPLOYER"
expect_refusal "the devnet binary under the mainnet hash" env PANGU_MAINNET_GO="$PHRASE" "${DEPLOY[@]}" "$DEVNET_SO" "$WANT" "$DEPLOYER"
# A hash only proves the binary is the one named. Typing the devnet build's own
# hash must still be refused, by the tool's own mainnet build check.
expect_refusal "the devnet binary with its own correct hash" env PANGU_MAINNET_GO="$PHRASE" "${DEPLOY[@]}" "$DEVNET_SO" "$(hash_of "$DEVNET_SO")" "$DEPLOYER"
expect_refusal "no deployer keypair given" env PANGU_MAINNET_GO="$PHRASE" "${DEPLOY[@]}" "$MAINNET_SO" "$WANT"
expect_refusal "a deployer holding 1 SOL" env PANGU_MAINNET_GO="$PHRASE" "${DEPLOY[@]}" "$MAINNET_SO" "$WANT" "$THIN"
expect_refusal "an answer other than yes" sh -c 'printf "no\n" | PANGU_MAINNET_GO="$0" "$@"' "$PHRASE" "${DEPLOY[@]}" "$MAINNET_SO" "$WANT" "$DEPLOYER"

echo "== 1. deploy-mainnet.sh --rehearse, answered yes"
printf 'yes\n' | PANGU_MAINNET_GO="$PHRASE" "${DEPLOY[@]}" "$MAINNET_SO" "$WANT" "$DEPLOYER" \
  | tee "$REHEARSAL/deploy.txt"
grep -q '^DEPLOY-MAINNET-OK' "$REHEARSAL/deploy.txt" || fail "the rehearsed deploy did not finish"
echo "== 1. run again, which must change nothing"
printf 'yes\n' | PANGU_MAINNET_GO="$PHRASE" "${DEPLOY[@]}" "$MAINNET_SO" "$WANT" "$DEPLOYER" \
  | tee "$REHEARSAL/deploy-again.txt"
grep -q '^ALREADY UP TO DATE' "$REHEARSAL/deploy-again.txt" || fail "a second run did not see the deploy"

echo "== 2. the sales"
npx tsx fork-test/rehearsal.ts || fail "the rehearsal sales failed"

echo "== 3. the upgrade authority moves to a Squads multisig vault"
npx tsx fork-test/rehearsal-squads.ts create | tee "$REHEARSAL/squads-create.txt"
VAULT="$(awk '/^VAULT / {print $2}' "$REHEARSAL/squads-create.txt")"
[ -n "$VAULT" ] || fail "no Squads vault was made"
local_cli program set-upgrade-authority "$PROGRAM_ID" \
  --new-upgrade-authority "$VAULT" --skip-new-upgrade-authority-signer-check \
  --upgrade-authority "$DEPLOYER" || fail "set-upgrade-authority failed"
[ "$(show_authority)" = "$VAULT" ] || fail "the upgrade authority is not the vault"
echo "UPGRADE AUTHORITY: $VAULT, the multisig vault"

echo "== 3. the old key alone can no longer upgrade"
STRAY_BUFFER="$REHEARSAL/stray-buffer.json"
solana-keygen new --no-bip39-passphrase --silent --outfile "$STRAY_BUFFER" >/dev/null
local_cli program write-buffer "$MAINNET_SO" --buffer "$STRAY_BUFFER" --use-rpc >/dev/null \
  || fail "write-buffer failed"
if local_cli program upgrade "$(solana-keygen pubkey "$STRAY_BUFFER")" "$PROGRAM_ID" \
    --upgrade-authority "$DEPLOYER" > "$REHEARSAL/stray.txt" 2>&1; then
  fail "the deployer key upgraded the program on its own after handing the authority over"
fi
echo "REFUSED AS EXPECTED: $(grep -m1 -i "error" "$REHEARSAL/stray.txt")"
local_cli program close "$(solana-keygen pubkey "$STRAY_BUFFER")" >/dev/null 2>&1

echo "== 3. an upgrade through a proposal, to the devnet build so the change shows in the hash"
UPGRADE_BUFFER="$REHEARSAL/upgrade-buffer.json"
solana-keygen new --no-bip39-passphrase --silent --outfile "$UPGRADE_BUFFER" >/dev/null
BUFFER="$(solana-keygen pubkey "$UPGRADE_BUFFER")"
local_cli program write-buffer "$DEVNET_SO" --buffer "$UPGRADE_BUFFER" --use-rpc >/dev/null \
  || fail "write-buffer failed"
local_cli program set-buffer-authority "$BUFFER" --new-buffer-authority "$VAULT" \
  --buffer-authority "$DEPLOYER" || fail "set-buffer-authority failed"
npx tsx fork-test/rehearsal-squads.ts upgrade "$BUFFER" | tee "$REHEARSAL/squads-upgrade.txt"
grep -q '^SQUADS-UPGRADE-OK' "$REHEARSAL/squads-upgrade.txt" || fail "the upgrade through the proposal failed"
DUMP="$(mktemp)"
local_cli program dump "$PROGRAM_ID" "$DUMP" >/dev/null || fail "no dump"
ONCHAIN="$(head -c "$(stat -c%s "$DEVNET_SO")" "$DUMP" | sha256sum | cut -d' ' -f1)"
rm -f "$DUMP"
echo "ON-CHAIN SHA256 AFTER THE PROPOSAL: $ONCHAIN"
echo "DEVNET BUILD SHA256:                $(hash_of "$DEVNET_SO")"
[ "$ONCHAIN" = "$(hash_of "$DEVNET_SO")" ] || fail "the code on chain is not the build the proposal carried"
[ "$(show_authority)" = "$VAULT" ] || fail "the upgrade authority moved away from the vault"

stop_validator
echo MAINNET-REHEARSAL-OK
