#!/bin/bash
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Starts a local validator that holds copies of Meteora's real mainnet programs, so
# a Pangu sale can be run end to end against the code that is actually deployed.
#
#   bash fork-validator.sh          start it and wait for it to answer
#   bash fork-validator.sh stop     kill it
#
# Nothing here ever sends a transaction to mainnet. Mainnet is only read.

set -uo pipefail

WORK="$HOME/pangu-build"
LEDGER="$HOME/pangu-fork-ledger"
LOG="$HOME/pangu-fork-validator.log"
PIDFILE="$HOME/pangu-fork-validator.pid"
# Test wallets and the rewritten stock-token accounts live outside the repo, so no
# keypair can ever reach a tracked file.
ACCOUNTS="$HOME/pangu-fork-accounts"
# The node the validator clones Meteora's accounts from. The public node refuses
# the clone under load, so a keyed MAINNET_RPC_URL from the root .env is used
# when it is set. The URL carries a key and is never printed.
MAINNET="https://api.mainnet-beta.solana.com"
ENV_FILE="/mnt/d/Projects/Meteora/.env"
if [ -f "$ENV_FILE" ]; then
  KEYED="$(grep -E '^MAINNET_RPC_URL=https' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r')"
  [ -n "$KEYED" ] && MAINNET="$KEYED"
fi
LOCAL="http://127.0.0.1:8899"

PANGU_ID="4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG"
PANGU_SO="$WORK/target/deploy/pangu.so"

# The Solana Attestation Service, dumped from mainnet by fetch-fixtures.sh. It is
# loaded from disk rather than cloned so a fork run needs no mainnet call of its
# own, and so the credential tests always run against one known binary.
SAS_ID="22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG"
SAS_SO="$HOME/pangu-fixtures/sas.so"

stop_validator() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" >/dev/null 2>&1
    rm -f "$PIDFILE"
  fi
  pkill -f solana-test-validator >/dev/null 2>&1
  sleep 3
  pkill -9 -f solana-test-validator >/dev/null 2>&1
  return 0
}

if [ "${1:-start}" = "stop" ]; then
  stop_validator
  echo FORK-DOWN
  exit 0
fi

if [ ! -f "$PANGU_SO" ]; then
  echo "missing $PANGU_SO, run build.sh first" >&2
  exit 1
fi

if [ ! -s "$SAS_SO" ]; then
  echo "missing $SAS_SO, run fetch-fixtures.sh first" >&2
  exit 1
fi

stop_validator
rm -rf "$LEDGER"
mkdir -p "$ACCOUNTS"

# The stock-quote test needs a wallet that already holds AAPLx. A wallet cannot be
# given a Token-2022 balance by minting, so a real mainnet AAPLx account is copied,
# its owner and amount rewritten, and loaded at the test wallet's own ATA address.
STOCK_ARGS=""
if node "$WORK/fork-tests/stock-accounts.js" "$ACCOUNTS" > "$ACCOUNTS/args.txt" 2>"$ACCOUNTS/prepare.log"; then
  while read -r address file; do
    [ -z "$address" ] && continue
    STOCK_ARGS="$STOCK_ARGS --account $address $file"
  done < "$ACCOUNTS/args.txt"
else
  echo "could not prepare the stock-token accounts, see $ACCOUNTS/prepare.log" >&2
  cat "$ACCOUNTS/prepare.log" >&2
  exit 1
fi

# The price-band test reads Pyth price feed accounts. Pyth's receiver program
# does not run on a local chain, and the accounts are program addresses only
# Pyth's price feed program could produce, so they are written here in the real
# layout, owned by the receiver, and handed to the validator. Their publish time
# is set now and Pyth's freshness rule counts in seconds, which is why
# life-band.ts runs first: see the comment in band-accounts.ts.
BAND_ARGS=""
cd "$WORK" || exit 1
if npx ts-node -P ./tsconfig.json fork-tests/band-accounts.ts "$ACCOUNTS" \
    > "$ACCOUNTS/band-args.txt" 2>"$ACCOUNTS/band.log"; then
  while read -r address file; do
    [ -z "$address" ] && continue
    BAND_ARGS="$BAND_ARGS --account $address $file"
  done < "$ACCOUNTS/band-args.txt"
  cat "$ACCOUNTS/band.log" >&2
else
  echo "could not prepare the price-band quote accounts, see $ACCOUNTS/band.log" >&2
  cat "$ACCOUNTS/band.log" >&2
  exit 1
fi

# Why each cloned account is here:
#   dbcij...  Dynamic Bonding Curve, the program under test.
#   cpamd...  DAMM v2, where the sale graduates to.
#   FhVo...   DBC pool authority. Owns every pool vault and pays rent forward on
#             pool creation, so it has to arrive with its mainnet lamports.
#   8Ks1...   DBC event authority, the signer for its emit_cpi events.
#   HLnp...   DAMM v2 pool authority, same rent role during migration.
#   A8gM...   DAMM v2 "Customizable" migration fee config, named by the launch
#             template. Migration reads it as remaining account 0.
#   So11...   Wrapped SOL, the quote token of the main test.
#   XsbE...   AAPLx, the Token-2022 stock token used as quote in the second test.
#   8VeV...   AAPLx's DBC token badge. Without it DBC refuses a stock-token quote.
#   22zo...   The Solana Attestation Service, loaded from the dumped mainnet
#             binary so the credential tests run against the real program.
# DAMM v2's event authority is deliberately absent: it does not exist on mainnet
# either, because an event-authority PDA never needs an account of its own.
nohup setsid solana-test-validator \
  --reset \
  --quiet \
  --ledger "$LEDGER" \
  --limit-ledger-size 100000 \
  --url "$MAINNET" \
  --clone-upgradeable-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN \
  --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
  --clone FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM \
  --clone 8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF \
  --clone HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC \
  --clone A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck \
  --clone So11111111111111111111111111111111111111112 \
  --clone XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp \
  --clone 8VeVZe3Zxfpax2qQUp7i68FCLspLYErm2FJChc5NDuVn \
  --bpf-program "$PANGU_ID" "$PANGU_SO" \
  --bpf-program "$SAS_ID" "$SAS_SO" \
  $STOCK_ARGS \
  $BAND_ARGS \
  > "$LOG" 2>&1 &

echo $! > "$PIDFILE"

for _ in $(seq 1 120); do
  if solana cluster-version --url "$LOCAL" >/dev/null 2>&1; then
    echo FORK-UP
    exit 0
  fi
  if ! kill -0 "$(cat "$PIDFILE")" >/dev/null 2>&1; then
    echo "the validator died on startup:" >&2
    tail -40 "$LOG" >&2
    exit 1
  fi
  sleep 2
done

echo "the validator never answered, last log lines:" >&2
tail -40 "$LOG" >&2
stop_validator
exit 1
