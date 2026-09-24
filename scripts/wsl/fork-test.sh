#!/bin/bash
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -uo pipefail

# Builds Pangu, fetches the mainnet program binaries the run needs, starts the
# forked validator, runs the life tests against Meteora's and the attestation
# service's real programs, and always stops the validator again.
#
# The whole run takes longer than a single WSL call should, so start it detached
# and poll the log:
#
#   nohup setsid bash /mnt/d/Projects/Meteora/scripts/wsl/fork-test.sh \
#     > ~/pangu-fork-test.log 2>&1 &
#   tail -5 ~/pangu-fork-test.log

SCRIPTS=/mnt/d/Projects/Meteora/scripts/wsl
WORK="$HOME/pangu-build"

bash "$SCRIPTS/build.sh" || exit 1
bash "$SCRIPTS/fetch-fixtures.sh" || exit 1

# The validator loads target/deploy/pangu.so, the binary devnet runs. This suite
# is what proves the SBPF v3 bytecode, so it refuses to run on anything else.
FORK_SO="$WORK/target/deploy/pangu.so"
FORK_SBPF="$(od -An -t u4 -j 48 -N 4 "$FORK_SO" | tr -d ' ')"
[ "$FORK_SBPF" = "3" ] || { echo "FORK-TEST-FAILED: $FORK_SO is SBPF v$FORK_SBPF, not v3"; exit 1; }
echo "fork suite binary: $FORK_SO, SBPF v3, sha256 $(sha256sum "$FORK_SO" | cut -d' ' -f1)"

if ! bash "$SCRIPTS/fork-validator.sh"; then
  echo "the forked validator did not start" >&2
  exit 1
fi

cd "$WORK" || exit 1
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install --no-audit --no-fund
fi

# life-band.ts runs first on purpose. Its price accounts carry a publish time set
# just before genesis, and the ageing sale only accepts a price a few minutes
# old, so the band tests have to happen while the chain is young.
npx ts-mocha -p ./tsconfig.json -t 1800000 \
  fork-tests/life-band.ts \
  fork-tests/life.ts \
  fork-tests/stock-quote.ts \
  fork-tests/life-credential.ts
RESULT=$?

bash "$SCRIPTS/fork-validator.sh" stop

if [ $RESULT -ne 0 ]; then
  echo "FORK-TEST-FAILED"
  exit $RESULT
fi

echo FORK-TEST-OK
