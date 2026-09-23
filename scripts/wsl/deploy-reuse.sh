#!/usr/bin/env bash
# Deploys the build that is already in ~/pangu-build, in a session with no cargo
# build in it. WSL has dropped its network right after heavy builds, so the
# build and the deploy are kept apart on purpose. Usage: deploy-reuse.sh <sha256>
set -euo pipefail
WANT="${1:?the sha256 the last BUILD-OK printed}"
LOG="$HOME/pangu-deploy-$(date +%Y%m%d-%H%M%S).log"

ok=0
for i in 1 2 3 4 5; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' https://api.devnet.solana.com || true)"
  if [ "$code" = "200" ]; then ok=$((ok + 1)); fi
done
echo "devnet answered $ok of 5 from WSL"
if [ "$ok" -lt 4 ]; then
  echo "DEPLOY-SKIPPED: the network is not steady enough to deploy"
  exit 2
fi

echo "log: $LOG"
REUSE_BUILD=1 BUILD_SHA256="$WANT" bash /mnt/d/Projects/Meteora/scripts/wsl/deploy.sh devnet 2>&1 | tee "$LOG"
