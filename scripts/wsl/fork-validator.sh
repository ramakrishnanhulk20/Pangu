#!/bin/bash
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Starts a local validator that holds copies of Meteora's real mainnet programs, so
# a Pangu sale can be run end to end against the code that is actually deployed.
#
#   bash fork-validator.sh          start it and wait for it to answer
#   bash fork-validator.sh stop     kill the one it started, and no other
#
# Two settings exist for the mainnet rehearsal (scripts/wsl/mainnet-rehearsal.sh):
#   LEAVE_PANGU_ADDRESS_EMPTY=1   start without Pangu at its address, so the
#                                 rehearsal can deploy the mainnet build there
#   REHEARSAL_ACCOUNT_LIST=<file> also load the accounts that file lists, one
#                                 "<address> <json file>" per line, written by
#                                 packages/sdk/fork-test/rehearsal-accounts.ts
#   MATCH_MAINNET_FEATURES=1      copy mainnet's feature gates instead of turning
#                                 every one on, so the rehearsal deploys under
#                                 exactly mainnet's rules. A local validator
#                                 otherwise also runs gates mainnet has not
#                                 turned on, such as SIMD-0500
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

# Stops only the validator this script started, named by its pid file. Another
# solana-test-validator on the machine, from another project or a person's own
# session, is left alone. The pid is checked to still be a solana-test-validator
# first, because after a WSL restart the same number can belong to anything.
stop_validator() {
  [ -f "$PIDFILE" ] || return 0
  local pid
  pid="$(tr -dc '0-9' < "$PIDFILE")"
  if [ -n "$pid" ] && ps -p "$pid" -o args= 2>/dev/null | grep -q solana-test-validator; then
    kill "$pid" >/dev/null 2>&1
    for _ in $(seq 1 15); do
      kill -0 "$pid" >/dev/null 2>&1 || break
      sleep 1
    done
    kill -0 "$pid" >/dev/null 2>&1 && kill -9 "$pid" >/dev/null 2>&1
  fi
  rm -f "$PIDFILE"
  return 0
}

if [ "${1:-start}" = "stop" ]; then
  stop_validator
  echo FORK-DOWN
  exit 0
fi

FEATURE_ARGS=()
if [ "${MATCH_MAINNET_FEATURES:-0}" = "1" ]; then
  FEATURE_ARGS=(--clone-feature-set)
fi

PANGU_ARGS=(--bpf-program "$PANGU_ID" "$PANGU_SO")
if [ "${LEAVE_PANGU_ADDRESS_EMPTY:-0}" = "1" ]; then
  PANGU_ARGS=()
elif [ ! -f "$PANGU_SO" ]; then
  echo "missing $PANGU_SO, run build.sh first" >&2
  exit 1
fi

if [ ! -s "$SAS_SO" ]; then
  echo "missing $SAS_SO, run fetch-fixtures.sh first" >&2
  exit 1
fi

stop_validator
# With only our own validator stopped, anything still answering on the local
# port belongs to someone else. Starting now would run the tests against it, so
# the start refuses instead.
if solana cluster-version --url "$LOCAL" >/dev/null 2>&1; then
  echo "a validator this script did not start is already answering on $LOCAL; stop it first" >&2
  exit 1
fi
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

REHEARSAL_ARGS=""
if [ -n "${REHEARSAL_ACCOUNT_LIST:-}" ]; then
  [ -f "$REHEARSAL_ACCOUNT_LIST" ] || { echo "missing $REHEARSAL_ACCOUNT_LIST" >&2; exit 1; }
  while read -r address file; do
    [ -z "$address" ] && continue
    REHEARSAL_ARGS="$REHEARSAL_ARGS --account $address $file"
  done < "$REHEARSAL_ACCOUNT_LIST"
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
#   EPjF...   USDC, the one dollar the mainnet build lets a ceiling be set on.
#             The rehearsal's wallets are handed USDC accounts at genesis,
#             because nobody local holds Circle's mint authority.
#   SQDS...   Squads v4, the multisig the upgrade authority plan moves to.
#   BSTq...   Squads' program config, read when a multisig is created.
#   5DH2...   The treasury that config names, paid any multisig creation fee.
# DAMM v2's event authority is deliberately absent: it does not exist on mainnet
# either, because an event-authority PDA never needs an account of its own.
nohup setsid solana-test-validator \
  --reset \
  --quiet \
  --ledger "$LEDGER" \
  --limit-ledger-size 100000 \
  --url "$MAINNET" \
  "${FEATURE_ARGS[@]}" \
  --clone-upgradeable-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN \
  --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
  --clone FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM \
  --clone 8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF \
  --clone HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC \
  --clone A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck \
  --clone So11111111111111111111111111111111111111112 \
  --clone XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp \
  --clone 8VeVZe3Zxfpax2qQUp7i68FCLspLYErm2FJChc5NDuVn \
  --clone EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --clone-upgradeable-program SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf \
  --clone BSTq9w3kZwNwpBXJEvTZz2G9ZTNyKBvoSeXMvwb4cNZr \
  --clone 5DH2e3cJmFpyi6mk65EGFediunm4ui6BiKNUNrhWtD1b \
  "${PANGU_ARGS[@]}" \
  --bpf-program "$SAS_ID" "$SAS_SO" \
  $STOCK_ARGS \
  $BAND_ARGS \
  $REHEARSAL_ARGS \
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
