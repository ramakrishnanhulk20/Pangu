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
# maths and the quote parser are proven there and nowhere else. Before WO-3b they
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

npx ts-mocha -p ./tsconfig.json -t 400000 'tests/**/*.ts'

echo TEST-OK
