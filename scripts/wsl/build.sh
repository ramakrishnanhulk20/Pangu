#!/bin/bash
# usage: build.sh
# Builds the Pangu program for devnet. Pyth's receiver and price feed programs sit
# at the same addresses on every network, but the dollar tokens a price ceiling
# may be set on do not, so the build turns on the program's `devnet` feature and
# carries devnet USDC and the demo dollar instead of mainnet USDC.
#
# Two files come out of one source:
#   target/deploy/pangu.so                       SBPF v3, the binary devnet runs
#   target/deploy/pangu-v0-for-unit-tests.so     SBPF v0, read only by test.sh
# SBPF v3 is the one format the network will keep accepting for deploys and
# upgrades once SIMD-0500 switches the older ones off (docs/deploy/mainnet.md).
# The unit suite runs on solana-bankrun 0.4.0, which cannot load v3, so it gets
# the same source built as v0 under a name nothing deploys.
#
# The mainnet build is the same v3 command without the feature. scripts/wsl/verify-build.sh
# makes it reproducibly, and only a person deploys it, with scripts/wsl/deploy-mainnet.sh
# (see docs/deploy/mainnet.md):
#   cd ~/pangu-build && anchor build --arch v3
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -euo pipefail

SRC=/mnt/d/Projects/Meteora/packages/program
WORK="$HOME/pangu-build"

# Building straight on /mnt/d is several times slower than the WSL filesystem,
# so the workspace is mirrored to $HOME and only the artefacts travel back.
mkdir -p "$WORK"
rsync -a --delete \
  --exclude node_modules --exclude target --exclude .anchor \
  "$SRC/" "$WORK/"

OUT="target/deploy/pangu.so"
UNIT_OUT="target/deploy/pangu-v0-for-unit-tests.so"

# sbpf_version and check_list, shared with verify-build.sh and deploy-mainnet.sh.
source "$(dirname "${BASH_SOURCE[0]}")/lib-binary-checks.sh" || { echo "BUILD-FAILED: lib-binary-checks.sh could not be read"; exit 1; }

cd "$WORK"
rm -f "$OUT" "$UNIT_OUT"
# The v0 build goes first and is moved aside at once, so the name pangu.so only
# ever holds the v3 build by the time anything reads it.
anchor build --no-idl --arch v0 -- --features devnet
mv "$OUT" "$UNIT_OUT"
anchor build --arch v3 -- --features devnet

[ "$(sbpf_version "$OUT")" = "3" ] || { echo "BUILD-FAILED: $OUT is SBPF v$(sbpf_version "$OUT"), not v3"; exit 1; }
[ "$(sbpf_version "$UNIT_OUT")" = "0" ] || { echo "BUILD-FAILED: $UNIT_OUT is SBPF v$(sbpf_version "$UNIT_OUT"), not v0"; exit 1; }

mkdir -p "$SRC/target/deploy" "$SRC/target/idl" "$SRC/target/types"
cp "$OUT" "$SRC/$OUT"
cp "$UNIT_OUT" "$SRC/$UNIT_OUT"
cp target/idl/pangu.json "$SRC/target/idl/pangu.json"
cp target/types/pangu.ts "$SRC/target/types/pangu.ts"

# Proof that each build really carries Pyth's two program ids, the devnet dollar
# list and no trace of the oracle it replaced or of the mainnet dollar list,
# rather than a build that looks right because nothing complained. check_list
# is the one verify-build.sh and deploy-mainnet.sh run.
DEVNET_UNWANTED="$MAINNET_USDC $SWITCHBOARD"
echo "the v3 build, $OUT:"
check_list "$WORK/$OUT" "$PYTH $DEVNET_DOLLARS" "$DEVNET_UNWANTED" || { echo "BUILD-FAILED: this build does not carry exactly Pyth's two programs and the devnet dollar list."; exit 1; }
echo "the v0 unit-test build, $UNIT_OUT:"
check_list "$WORK/$UNIT_OUT" "$PYTH $DEVNET_DOLLARS" "$DEVNET_UNWANTED" || { echo "BUILD-FAILED: this build does not carry exactly Pyth's two programs and the devnet dollar list."; exit 1; }

echo "BINARY: $SRC/$OUT"
echo "SBPF: v$(sbpf_version "$OUT"), the binary devnet runs and deploy.sh ships"
echo "LENGTH: $(stat -c%s "$OUT") bytes"
echo "SHA256: $(sha256sum "$OUT" | cut -d' ' -f1)"
echo "UNIT-TEST BINARY: $SRC/$UNIT_OUT"
echo "UNIT-TEST SBPF: v$(sbpf_version "$UNIT_OUT"), the same source for the bankrun unit suite only, never deployed"
echo "UNIT-TEST LENGTH: $(stat -c%s "$UNIT_OUT") bytes"
echo "UNIT-TEST SHA256: $(sha256sum "$UNIT_OUT" | cut -d' ' -f1)"
echo "IDL SHA256: $(sha256sum target/idl/pangu.json | cut -d' ' -f1)"
echo BUILD-OK
