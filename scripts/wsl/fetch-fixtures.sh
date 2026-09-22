#!/bin/bash
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -euo pipefail

# Copies the program binaries the fork tests need out of mainnet, once.
#
# The Solana Attestation Service publishes no compiled binary anywhere, so the
# only way to test against the code that is really running is to dump it from
# mainnet. Mainnet is read, never written.
#
# The binaries live outside the repository on purpose: they are hundreds of
# kilobytes of someone else's build and have no business in git.

FIXTURES="$HOME/pangu-fixtures"
MAINNET="https://api.mainnet-beta.solana.com"

SAS_ID="22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG"
SAS_SO="$FIXTURES/sas.so"

mkdir -p "$FIXTURES"

if [ ! -s "$SAS_SO" ]; then
  echo "dumping the attestation service from mainnet"
  solana program dump "$SAS_ID" "$SAS_SO" --url "$MAINNET"
fi

echo "sas.so: $(stat -c %s "$SAS_SO") bytes at $SAS_SO"
echo FIXTURES-OK
