#!/bin/bash
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -uo pipefail

# Runs the production feed scripts from the mirrored workspace, so the devnet
# wallet stays in WSL and never near the repository.
#
#   bash feeds.sh feeds              print the feed ids and their price accounts
#   bash feeds.sh refresh [--dump]   refresh the devnet price and read it back
#
# The Pyth key and the payer's path come out of the repository's .env. Neither is
# printed, and .env is never committed.

SRC=/mnt/d/Projects/Meteora/packages/program
ENV_FILE=/mnt/d/Projects/Meteora/.env
WORK="$HOME/pangu-build"

# Read .env line by line rather than sourcing it. Sourcing would treat the
# backslashes in a Windows path as escape characters and quietly hand the script
# "C:UsersRam..." instead of the path Ram wrote. `read -r` keeps them.
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
      *=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    # A value the writer quoted keeps its quotes off.
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    export "$key=$value"
  done < "$ENV_FILE"
fi

mkdir -p "$WORK"
rsync -a --delete \
  --exclude node_modules --exclude target --exclude .anchor \
  "$SRC/" "$WORK/"

cd "$WORK" || exit 1
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install --no-audit --no-fund
fi

WHAT="${1:-refresh}"
shift || true

case "$WHAT" in
  feeds) npx ts-node -P ./tsconfig.json feeds/pyth-feeds.ts "$@" ;;
  refresh) npx ts-node -P ./tsconfig.json feeds/refresh.ts "$@" ;;
  *) echo "usage: feeds.sh [feeds|refresh] [args]" >&2; exit 1 ;;
esac
RESULT=$?

# The dump is an artefact the Rust test reads, so it has to travel back.
if [ -f "$WORK/feeds/live-price.bin" ]; then
  cp "$WORK/feeds/live-price.bin" "$SRC/feeds/live-price.bin"
fi

exit $RESULT
