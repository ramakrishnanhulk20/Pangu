#!/bin/bash
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -euo pipefail

# bankrun turns the Solana runtime's debug logging on by default, which buries the
# test output. Only real errors are wanted here.
export RUST_LOG=error

WORK="$HOME/pangu-build"

bash /mnt/d/Projects/Meteora/scripts/wsl/build.sh

cd "$WORK"
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install --no-audit --no-fund
fi

# The Rust tests run first and their summary line is printed, because the price
# maths and the quote parser are proven there and nowhere else. Before the forged-quote hardening they
# had no script entry at all, so an independent runner never saw them.
RUST_LOG_FILE="$(mktemp)"
if cargo test -p pangu --lib 2>&1 | tee "$RUST_LOG_FILE"; then
  grep -E "^test result:" "$RUST_LOG_FILE" | sed 's/^/rust: /'
else
  grep -E "^test result:" "$RUST_LOG_FILE" | sed 's/^/rust: /'
  rm -f "$RUST_LOG_FILE"
  echo "TEST-FAILED: the Rust unit tests did not pass"
  exit 1
fi
rm -f "$RUST_LOG_FILE"

# The suite's fixture always loads target/deploy/pangu.so next to its tests
# folder, and in ~/pangu-build that name holds the v3 build. So the suite runs
# from a second folder whose pangu.so is the v0 build of the same source, and
# the shipped v3 file is never renamed, copied over or touched.
UNIT="$HOME/pangu-unit-tests"
UNIT_SO="$WORK/target/deploy/pangu-v0-for-unit-tests.so"
[ "$(od -An -t u4 -j 48 -N 4 "$UNIT_SO" | tr -d ' ')" = "0" ] \
  || { echo "TEST-FAILED: $UNIT_SO is not an SBPF v0 build"; exit 1; }
mkdir -p "$UNIT"
rsync -a --delete --exclude node_modules --exclude target --exclude .anchor "$WORK/" "$UNIT/"
mkdir -p "$UNIT/target/deploy" "$UNIT/target/idl" "$UNIT/target/types"
cp "$UNIT_SO" "$UNIT/target/deploy/pangu.so"
cp target/idl/pangu.json "$UNIT/target/idl/pangu.json"
cp target/types/pangu.ts "$UNIT/target/types/pangu.ts"
ln -sfn "$WORK/node_modules" "$UNIT/node_modules"
echo "unit suite binary: $UNIT_SO, SBPF v0, sha256 $(sha256sum "$UNIT_SO" | cut -d' ' -f1). solana-bankrun 0.4.0 cannot load SBPF v3, so the unit suite runs the same source built as v0; the shipped v3 binary is proven by fork-test.sh, sdk-fork-test.sh and mainnet-rehearsal.sh"

cd "$UNIT"
npx ts-mocha -p ./tsconfig.json -t 400000 'tests/**/*.ts'

echo TEST-OK
