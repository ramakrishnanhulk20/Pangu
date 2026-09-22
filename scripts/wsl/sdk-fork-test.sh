#!/bin/bash
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -uo pipefail

# Runs a whole Pangu sale against Meteora's real programs using nothing but the
# pangu-sdk package, and always stops the validator again.
#
# The same forked validator the program's own tests use: Meteora's mainnet
# Dynamic Bonding Curve and DAMM v2, the Pangu build, and the price band's quote
# accounts. See scripts/wsl/fork-validator.sh.
#
# The whole run takes longer than a single WSL call should, so start it detached
# and poll the log:
#
#   nohup setsid bash /mnt/d/Projects/Meteora/scripts/wsl/sdk-fork-test.sh \
#     > ~/pangu-sdk-fork-test.log 2>&1 &
#   tail -5 ~/pangu-sdk-fork-test.log

SCRIPTS=/mnt/d/Projects/Meteora/scripts/wsl
SRC=/mnt/d/Projects/Meteora/packages/sdk
WORK="$HOME/pangu-sdk-build"

bash "$SCRIPTS/build.sh" || exit 1
bash "$SCRIPTS/fetch-fixtures.sh" || exit 1

if ! bash "$SCRIPTS/fork-validator.sh"; then
  echo "the forked validator did not start" >&2
  exit 1
fi

# Windows and WSL cannot share one node_modules: the native binaries differ. So
# the package is mirrored to the WSL filesystem and installed there.
mkdir -p "$WORK"
rsync -a --delete --exclude node_modules --exclude dist "$SRC/" "$WORK/"

cd "$WORK" || exit 1
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install --no-audit --no-fund || {
    bash "$SCRIPTS/fork-validator.sh" stop
    echo "SDK-FORK-FAILED"
    exit 1
  }
fi

npx tsx fork-test/life.ts
RESULT=$?

bash "$SCRIPTS/fork-validator.sh" stop

if [ $RESULT -ne 0 ]; then
  echo "SDK-FORK-FAILED"
  exit $RESULT
fi

echo SDK-FORK-OK
