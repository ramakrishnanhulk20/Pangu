#!/bin/bash
# usage: program-info.sh devnet
# Reads the deployed program back off the chain and checks that the bytes running
# on devnet are byte for byte the bytes in packages/program/target/deploy.
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -euo pipefail

CLUSTER="${1:-}"
case "$CLUSTER" in
  devnet) URL="https://api.devnet.solana.com" ;;
  *)
    echo "INFO-REFUSED: devnet only for now. You asked for '${CLUSTER:-nothing}'."
    echo "usage: program-info.sh devnet"
    exit 2 ;;
esac

SRC=/mnt/d/Projects/Meteora/packages/program
SO="$SRC/target/deploy/pangu.so"
PAYER="$HOME/.config/solana/pangu-devnet.json"
PROGRAM_KEY="$HOME/.config/solana/pangu-program-keypair.json"

[ -f "$SO" ] || { echo "INFO-FAILED: no local build at $SO. Run build.sh first."; exit 1; }
[ -f "$PROGRAM_KEY" ] || { echo "INFO-FAILED: missing $PROGRAM_KEY"; exit 1; }

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEY")"
SHOW="$(mktemp)"
if ! solana program show "$PROGRAM_ID" --url "$URL" --keypair "$PAYER" > "$SHOW" 2>&1; then
  echo "INFO-FAILED: $PROGRAM_ID is not deployed on $CLUSTER."
  cat "$SHOW"; rm -f "$SHOW"; exit 1
fi

echo "CLUSTER: $CLUSTER ($URL)"
echo "BUILD COMPARED AGAINST: $SO"
echo "PROGRAM ID: $(awk '/^Program Id:/ {print $NF}' "$SHOW")"
echo "PROGRAM DATA ADDRESS: $(awk '/^ProgramData Address:/ {print $NF}' "$SHOW")"
echo "DEPLOYED SLOT: $(awk '/^Last Deployed In Slot:/ {print $NF}' "$SHOW")"
echo "UPGRADE AUTHORITY: $(awk '/^Authority:/ {print $NF}' "$SHOW")"
echo "PROGRAM DATA LENGTH: $(awk '/^Data Length:/ {print $3}' "$SHOW") bytes"
echo "RENT LOCKED IN PROGRAM ACCOUNT: $(awk '/^Balance:/ {print $2}' "$SHOW") SOL"
echo "PAYER BALANCE: $(solana balance "$PAYER" --url "$URL")"
rm -f "$SHOW"

LEN="$(stat -c%s "$SO")"
LOCAL_HASH="$(sha256sum "$SO" | cut -d' ' -f1)"
DUMP="$(mktemp)"
solana program dump "$PROGRAM_ID" "$DUMP" --url "$URL" --keypair "$PAYER" >/dev/null
# The account is padded to its max length, so the dump is trimmed to the local
# build's length before hashing. Anything past that is zero padding, not code.
ONCHAIN_HASH="$(head -c "$LEN" "$DUMP" | sha256sum | cut -d' ' -f1)"
DUMP_LEN="$(stat -c%s "$DUMP")"
rm -f "$DUMP"

echo "LOCAL BUILD LENGTH: $LEN bytes"
echo "DUMPED LENGTH: $DUMP_LEN bytes (trimmed to $LEN for the comparison)"
echo "LOCAL SHA256:    $LOCAL_HASH"
echo "ON-CHAIN SHA256: $ONCHAIN_HASH"
if [ "$LOCAL_HASH" != "$ONCHAIN_HASH" ]; then
  echo "HASH MATCH: NO. The chain is running different code from the local build."
  echo "INFO-FAILED"
  exit 1
fi
echo "HASH MATCH: YES"
echo "INFO-OK"
