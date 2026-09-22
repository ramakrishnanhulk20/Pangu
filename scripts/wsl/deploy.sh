#!/bin/bash
# usage: deploy.sh devnet
# Puts the Pangu program on chain at its permanent address, or upgrades the code
# at that same address. Run it again for every upgrade. There are no manual steps.
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -euo pipefail

CLUSTER="${1:-}"
case "$CLUSTER" in
  devnet) URL="https://api.devnet.solana.com" ;;
  *)
    echo "DEPLOY-REFUSED: this script deploys to devnet only. You asked for '${CLUSTER:-nothing}'."
    echo "Mainnet is Ram's decision and gets its own work order and its own script."
    echo "usage: deploy.sh devnet"
    exit 2 ;;
esac

REPO=/mnt/d/Projects/Meteora
SRC="$REPO/packages/program"
# One binary serves every network. Pyth's receiver and price feed programs are at
# the same addresses on mainnet and devnet, so nothing about the price band has
# to be chosen at build time.
SO="$SRC/target/deploy/pangu.so"
PROGRAM_KEY="$HOME/.config/solana/pangu-program-keypair.json"
PAYER="$HOME/.config/solana/pangu-devnet.json"
# A named buffer keypair turns a half finished upload into something re-runnable.
# Without it the CLI hands back a 12 word seed phrase on failure, which is key
# material nobody should be copying around by hand.
BUFFER_KEY="$HOME/.config/solana/pangu-deploy-buffer.json"
SHOW="$HOME/pangu-program-show.txt"

sol() { awk -v l="$1" 'BEGIN{printf "%.9f", l/1000000000}'; }
rent_lamports() {
  solana rent "$1" --url "$URL" --output json \
    | sed -n 's/.*"rentExemptMinimumLamports": *\([0-9]*\).*/\1/p'
}

for f in "$PROGRAM_KEY" "$PAYER"; do
  [ -f "$f" ] || { echo "DEPLOY-FAILED: missing key file $f"; exit 1; }
done

bash "$REPO/scripts/wsl/build.sh"
[ -f "$SO" ] || { echo "DEPLOY-FAILED: the build produced no $SO"; exit 1; }

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEY")"
DECLARED="$(sed -n 's/^declare_id!("\([^"]*\)");.*/\1/p' "$SRC/programs/pangu/src/lib.rs")"
if [ "$PROGRAM_ID" != "$DECLARED" ]; then
  echo "DEPLOY-FAILED: the program keypair and declare_id! disagree."
  echo "  keypair address:  $PROGRAM_ID"
  echo "  declare_id! says: $DECLARED"
  echo "Deploying now would park the code at an address the code itself rejects."
  exit 1
fi

LEN="$(stat -c%s "$SO")"
MAX_LEN="$(( LEN * 120 / 100 ))"
LOCAL_HASH="$(sha256sum "$SO" | cut -d' ' -f1)"
RENT_LEN="$(rent_lamports "$LEN")"
RENT_MAX="$(rent_lamports "$MAX_LEN")"
HEADROOM="$(( RENT_MAX - RENT_LEN ))"
PAYER_ID="$(solana-keygen pubkey "$PAYER")"
BAL_BEFORE="$(solana balance "$PAYER" --url "$URL" --lamports | awk '{print $1}')"

echo "CLUSTER: $CLUSTER ($URL)"
echo "BUILD USED: $SO"
echo "PROGRAM ID: $PROGRAM_ID"
echo "PAYER AND UPGRADE AUTHORITY: $PAYER_ID"
echo "BUILD LENGTH: $LEN bytes"
echo "BUILD SHA256: $LOCAL_HASH"
echo "MAX LEN: $MAX_LEN bytes (20 percent headroom so a later, bigger build still fits the same account)"
echo "HEADROOM COST: $(sol "$HEADROOM") SOL of extra rent locked for good, on top of $(sol "$RENT_LEN") SOL for the code itself"
echo "BALANCE BEFORE: $(sol "$BAL_BEFORE") SOL"

PROGRAM_EXISTS=no
ONCHAIN_HASH=none
if solana program show "$PROGRAM_ID" --url "$URL" --keypair "$PAYER" > "$SHOW" 2>/dev/null; then
  PROGRAM_EXISTS=yes
  DUMP="$(mktemp)"
  if solana program dump "$PROGRAM_ID" "$DUMP" --url "$URL" --keypair "$PAYER" >/dev/null 2>&1; then
    # The dump is padded out to the account's max length, so only the first LEN
    # bytes can be compared against the local build.
    ONCHAIN_HASH="$(head -c "$LEN" "$DUMP" | sha256sum | cut -d' ' -f1)"
  fi
  rm -f "$DUMP"
fi
echo "PROGRAM ALREADY ON CHAIN: $PROGRAM_EXISTS"
echo "ON-CHAIN SHA256: $ONCHAIN_HASH"

report_facts() {
  solana program show "$PROGRAM_ID" --url "$URL" --keypair "$PAYER" > "$SHOW"
  local bal_after
  bal_after="$(solana balance "$PAYER" --url "$URL" --lamports | awk '{print $1}')"
  echo "PROGRAM ID: $(awk '/^Program Id:/ {print $NF}' "$SHOW")"
  echo "PROGRAM DATA ADDRESS: $(awk '/^ProgramData Address:/ {print $NF}' "$SHOW")"
  echo "DEPLOYED SLOT: $(awk '/^Last Deployed In Slot:/ {print $NF}' "$SHOW")"
  echo "UPGRADE AUTHORITY: $(awk '/^Authority:/ {print $NF}' "$SHOW")"
  echo "PROGRAM DATA LENGTH: $(awk '/^Data Length:/ {print $3}' "$SHOW") bytes"
  echo "RENT LOCKED IN PROGRAM ACCOUNT: $(awk '/^Balance:/ {print $2}' "$SHOW") SOL"
  echo "BALANCE BEFORE: $(sol "$BAL_BEFORE") SOL"
  echo "BALANCE AFTER: $(sol "$bal_after") SOL"
  echo "SOL SPENT THIS RUN: $(sol "$(( BAL_BEFORE - bal_after ))") SOL"
  local leftovers
  leftovers="$(solana program show --buffers --keypair "$PAYER" --url "$URL" 2>/dev/null | tail -n +3 | grep -c . || true)"
  if [ "${leftovers:-0}" -gt 0 ]; then
    echo "WARNING: $leftovers upload buffer(s) still hold SOL. Reclaim with:"
    echo "  solana program close --buffers --keypair $PAYER --url $URL"
  else
    echo "UPLOAD BUFFERS LEFT OPEN: none"
  fi
}

recovery_notes() {
  echo "The upload buffer keeps whatever was written before the failure. Nothing is lost:"
  echo "  re-run this same command and it resumes from that buffer."
  echo "To see SOL parked in buffers:   solana program show --buffers --keypair $PAYER --url $URL"
  echo "To take that SOL back:          solana program close --buffers --keypair $PAYER --url $URL"
}

if [ "$ONCHAIN_HASH" = "$LOCAL_HASH" ]; then
  echo "ALREADY UP TO DATE: the deployed bytes already match this build, so no transaction was sent and no SOL was spent."
  report_facts
  echo "DEPLOY-OK"
  exit 0
fi

# What the payer has to hold depends on which of the three paths this run takes,
# so the check waits until the path is known. A first deploy is the expensive one:
# the program account and the temporary upload buffer exist at the same moment.
if [ "$PROGRAM_EXISTS" = yes ]; then
  NEEDED="$(( RENT_LEN + 50000000 ))"
  NEEDED_WHY="the rent for the temporary upload buffer, which comes back when the upgrade lands, plus 0.05 SOL for fees"
else
  NEEDED="$(( RENT_LEN * 22 / 10 ))"
  NEEDED_WHY="2.2 times the rent at build length: the program account at its max length plus the temporary upload buffer held at the same time"
fi
if [ "$BAL_BEFORE" -lt "$NEEDED" ]; then
  echo "DEPLOY-FAILED: not enough SOL."
  echo "  need:     $(sol "$NEEDED") SOL ($NEEDED_WHY)"
  echo "  have:     $(sol "$BAL_BEFORE") SOL"
  echo "  short by: $(sol "$(( NEEDED - BAL_BEFORE ))") SOL"
  echo "Top up $PAYER_ID on devnet and run this again."
  exit 1
fi

[ -f "$BUFFER_KEY" ] || solana-keygen new --no-bip39-passphrase --silent --outfile "$BUFFER_KEY" >/dev/null
chmod 600 "$BUFFER_KEY"

DEPLOY_ARGS=(--program-id "$PROGRAM_KEY" --keypair "$PAYER" --upgrade-authority "$PAYER" --url "$URL" --buffer "$BUFFER_KEY")
if [ "$PROGRAM_EXISTS" = yes ]; then
  echo "MODE: upgrade in place. The account size was fixed on the first deploy, so no new rent is locked."
else
  echo "MODE: first deploy. Creating the program account at $MAX_LEN bytes."
  DEPLOY_ARGS+=(--max-len "$MAX_LEN")
fi

echo "DEPLOYING..."
if ! solana program deploy "$SO" "${DEPLOY_ARGS[@]}"; then
  echo "FIRST ATTEMPT FAILED. Retrying once with a priority fee, which is what usually clears a congested public RPC."
  recovery_notes
  if ! solana program deploy "$SO" "${DEPLOY_ARGS[@]}" --with-compute-unit-price 50000; then
    echo "DEPLOY-FAILED: both attempts failed."
    recovery_notes
    exit 1
  fi
fi

report_facts
VERIFY_DUMP="$(mktemp)"
solana program dump "$PROGRAM_ID" "$VERIFY_DUMP" --url "$URL" --keypair "$PAYER" >/dev/null
FINAL_HASH="$(head -c "$LEN" "$VERIFY_DUMP" | sha256sum | cut -d' ' -f1)"
rm -f "$VERIFY_DUMP"
echo "LOCAL SHA256:    $LOCAL_HASH"
echo "ON-CHAIN SHA256: $FINAL_HASH"
[ "$FINAL_HASH" = "$LOCAL_HASH" ] || { echo "DEPLOY-FAILED: the deployed bytes do not match the local build."; exit 1; }
echo "DEPLOY-OK"
