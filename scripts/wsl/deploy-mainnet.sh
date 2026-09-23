#!/bin/bash
# usage: deploy-mainnet.sh [--rehearse] <binary> <expected sha256> <deployer keypair path>
#
# Puts the verified mainnet build of Pangu on mainnet at its permanent address.
# It builds nothing: it takes the binary verify-build.sh made and the hash that
# script printed, and refuses to go on unless every one of these holds:
#   - PANGU_MAINNET_GO holds the exact phrase: deploy pangu to mainnet
#   - the deployer keypair path is given on the command line, never assumed
#   - the binary hashes to the sha256 given
#   - the node answering is mainnet, by its genesis hash
#   - the deployer holds at least 4.5 SOL
#   - the program keypair is the one for 4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG
# Then it prints the plan and the costs, waits for a typed "yes", deploys through
# a named upload buffer with a priority fee, and reads the code back off the
# chain to check its hash.
#
# --rehearse points every line at the local forked validator on 127.0.0.1:8899
# instead, and skips only the genesis check, because a local chain has its own.
# The keyed mainnet node is never read in a rehearsal. mainnet-rehearsal.sh runs
# it that way before anyone runs it for real.
#
# The mainnet node comes from MAINNET_RPC_URL, in the environment or the root
# .env. It carries a key, so it is never printed, and every line the Solana CLI
# prints is cleaned of it before it reaches the screen.
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -euo pipefail

PHRASE="deploy pangu to mainnet"
PROGRAM_ID_WANTED="4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG"
MAINNET_GENESIS="5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
LOCAL_URL="http://127.0.0.1:8899"
MIN_BALANCE_LAMPORTS=4500000000
# Micro-lamports per compute unit on every upload transaction, so a busy mainnet
# still takes them. The rehearsal measures what the whole upload costs at this
# price.
COMPUTE_UNIT_PRICE="${COMPUTE_UNIT_PRICE:-100000}"
PROGRAM_KEY="${PANGU_PROGRAM_KEYPAIR:-$HOME/.config/solana/pangu-program-keypair.json}"
ENV_FILE="/mnt/d/Projects/Meteora/.env"

refuse() { echo "DEPLOY-REFUSED: $1"; exit 2; }
fail() { echo "DEPLOY-FAILED: $1"; exit 1; }

REHEARSE=no
if [ "${1:-}" = "--rehearse" ]; then
  REHEARSE=yes
  shift
fi
[ "$#" -eq 3 ] || refuse "usage: deploy-mainnet.sh [--rehearse] <binary> <expected sha256> <deployer keypair path>"
SO="$1"
WANT_HASH="$(printf '%s' "$2" | tr 'A-F' 'a-f')"
DEPLOYER="$3"

[ "${PANGU_MAINNET_GO:-}" = "$PHRASE" ] || refuse "PANGU_MAINNET_GO does not hold the phrase \"$PHRASE\". Set it for this one command: PANGU_MAINNET_GO=\"$PHRASE\" bash deploy-mainnet.sh ..."
[ -n "$DEPLOYER" ] || refuse "no deployer keypair path was given"
[ -f "$DEPLOYER" ] || refuse "there is no deployer keypair file at $DEPLOYER"
[ -f "$SO" ] || refuse "there is no binary at $SO. Run verify-build.sh first."
[[ "$WANT_HASH" =~ ^[0-9a-f]{64}$ ]] || refuse "\"$2\" is not a sha256"
LOCAL_HASH="$(sha256sum "$SO" | cut -d' ' -f1)"
[ "$LOCAL_HASH" = "$WANT_HASH" ] || refuse "$SO hashes to $LOCAL_HASH, not the $WANT_HASH given. Deploy only the binary verify-build.sh printed."
[ -f "$PROGRAM_KEY" ] || refuse "there is no program keypair at $PROGRAM_KEY"
PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEY")"
[ "$PROGRAM_ID" = "$PROGRAM_ID_WANTED" ] || refuse "the program keypair at $PROGRAM_KEY is for $PROGRAM_ID, not $PROGRAM_ID_WANTED"
DEPLOYER_ID="$(solana-keygen pubkey "$DEPLOYER" 2>/dev/null)" || refuse "$DEPLOYER is not a keypair file the Solana CLI can read"

if [ "$REHEARSE" = yes ]; then
  URL="$LOCAL_URL"
  SHOWN_URL="the local forked validator, $LOCAL_URL"
  BUFFER_KEY="$HOME/pangu-rehearsal/deploy-buffer.json"
  mkdir -p "$(dirname "$BUFFER_KEY")"
else
  URL="${MAINNET_RPC_URL:-}"
  if [ -z "$URL" ] && [ -f "$ENV_FILE" ]; then
    URL="$(grep -E '^MAINNET_RPC_URL=https' "$ENV_FILE" | head -n 1 | cut -d= -f2- | tr -d '\r')"
  fi
  [ -n "$URL" ] || refuse "MAINNET_RPC_URL is not set in the environment or in $ENV_FILE. The public node drops program uploads, so a keyed node is required."
  SHOWN_URL="the keyed mainnet node from MAINNET_RPC_URL"
  BUFFER_KEY="$HOME/.config/solana/pangu-mainnet-buffer.json"
fi

# Every piece of the keyed address that could identify it: the whole URL, the
# URL without its scheme, the host, and the path and query that carry the key.
REDACT=()
if [ "$REHEARSE" = no ]; then
  NO_SCHEME="${URL#*://}"
  HOST="${NO_SCHEME%%[/?]*}"
  REST="${NO_SCHEME#"$HOST"}"
  REDACT=("$URL" "$NO_SCHEME" "$HOST")
  if [ "${#REST}" -gt 1 ]; then REDACT+=("$REST"); fi
fi
clean() {
  local line piece
  while IFS= read -r line || [ -n "$line" ]; do
    for piece in "${REDACT[@]+"${REDACT[@]}"}"; do
      [ -n "$piece" ] && line="${line//"$piece"/[keyed mainnet node]}"
    done
    printf '%s\n' "$line"
  done
}
# The deployer is named on every call: some subcommands insist on a signer even
# to read, and the CLI's own default key must never be the one used.
cli() { solana "$@" --url "$URL" --keypair "$DEPLOYER" 2>&1 | clean; }

GENESIS="$(cli genesis-hash)" || fail "the node did not answer a genesis hash request"
if [ "$REHEARSE" = yes ]; then
  [ "$GENESIS" != "$MAINNET_GENESIS" ] || refuse "the local node at $LOCAL_URL reports mainnet's genesis hash, which a local validator never does"
  echo "GENESIS CHECK: skipped for the rehearsal, the local fork's genesis is $GENESIS"
else
  [ "$GENESIS" = "$MAINNET_GENESIS" ] || refuse "the node in MAINNET_RPC_URL is not mainnet: its genesis hash is $GENESIS, mainnet's is $MAINNET_GENESIS"
  echo "GENESIS CHECK: mainnet ($GENESIS)"
fi

sol() { awk -v l="$1" 'BEGIN{printf "%.9f", l/1000000000}'; }
rent_lamports() {
  cli rent "$1" --output json | sed -n 's/.*"rentExemptMinimumLamports": *\([0-9]*\).*/\1/p'
}
balance() { cli balance "$1" --lamports | awk '{print $1}'; }

LEN="$(stat -c%s "$SO")"
MAX_LEN="$(( LEN * 120 / 100 ))"
# The program data account holds a 45 byte header in front of the code and the
# upload buffer a 37 byte one, and rent is charged on the whole account.
RENT_PROGRAM="$(rent_lamports "$(( MAX_LEN + 45 ))")"
RENT_BUFFER="$(rent_lamports "$(( LEN + 37 ))")"
RENT_STUB="$(rent_lamports 36)"
if [ -z "$RENT_PROGRAM" ] || [ -z "$RENT_BUFFER" ] || [ -z "$RENT_STUB" ]; then
  fail "the node did not answer the rent questions"
fi
WRITES="$(( (LEN + 1011) / 1012 ))"
PEAK="$(( RENT_PROGRAM + RENT_BUFFER + RENT_STUB ))"
NEEDED="$(( PEAK + 100000000 ))"
[ "$NEEDED" -gt "$MIN_BALANCE_LAMPORTS" ] || NEEDED="$MIN_BALANCE_LAMPORTS"
BAL_BEFORE="$(balance "$DEPLOYER_ID")"
[[ "$BAL_BEFORE" =~ ^[0-9]+$ ]] || fail "the node did not answer the deployer's balance"

# A node that fails to answer must not read as "no program there", or a network
# hiccup would send a first deploy at an address that already holds code.
PROGRAM_EXISTS=no
if SHOWN="$(cli program show "$PROGRAM_ID")"; then
  PROGRAM_EXISTS=yes
elif ! printf '%s' "$SHOWN" | grep -q "Unable to find the account"; then
  printf '%s\n' "$SHOWN"
  fail "the node did not say whether $PROGRAM_ID exists"
fi
ONCHAIN_HASH=none
if [ "$PROGRAM_EXISTS" = yes ]; then
  DUMP="$(mktemp)"
  if cli program dump "$PROGRAM_ID" "$DUMP" >/dev/null; then
    ONCHAIN_HASH="$(head -c "$LEN" "$DUMP" | sha256sum | cut -d' ' -f1)"
  fi
  rm -f "$DUMP"
fi

echo "NETWORK: $SHOWN_URL"
echo "BINARY: $SO"
echo "BINARY SHA256: $LOCAL_HASH (matches the hash given)"
echo "BINARY LENGTH: $LEN bytes"
echo "PROGRAM ID: $PROGRAM_ID"
echo "DEPLOYER, PAYER AND UPGRADE AUTHORITY: $DEPLOYER_ID"
echo "DEPLOYER BALANCE: $(sol "$BAL_BEFORE") SOL"
echo "PROGRAM ALREADY ON CHAIN: $PROGRAM_EXISTS"

if [ "$PROGRAM_EXISTS" = yes ]; then
  if [ "$ONCHAIN_HASH" = "$LOCAL_HASH" ]; then
    echo "ALREADY UP TO DATE: the code on chain already hashes to $LOCAL_HASH. No transaction was sent."
    echo "DEPLOY-MAINNET-OK"
    exit 0
  fi
  refuse "$PROGRAM_ID already runs other code (sha256 $ONCHAIN_HASH). This script makes the first deploy only; an upgrade follows the upgrade authority plan in docs/deploy/mainnet.md."
fi

if [ "$BAL_BEFORE" -lt "$NEEDED" ]; then
  echo "  need: $(sol "$NEEDED") SOL"
  echo "  have: $(sol "$BAL_BEFORE") SOL"
  refuse "the deployer holds less than the $(sol "$NEEDED") SOL this deploy needs. Fund $DEPLOYER_ID and run it again."
fi

echo
echo "THE PLAN"
echo "  1. Upload the binary into a named buffer, about $WRITES write transactions,"
echo "     each paying a priority fee of $COMPUTE_UNIT_PRICE micro-lamports per compute unit."
echo "     Buffer keypair: $BUFFER_KEY. If the upload stops part way, running this"
echo "     same command again resumes from that buffer."
echo "  2. Create the program account at $MAX_LEN bytes (the build plus 20 percent,"
echo "     so a bigger build can later be upgraded in place) and move the code in."
echo "  3. Read the code back off the chain and check it hashes to $LOCAL_HASH."
echo "THE COSTS"
echo "  locked for good in the program data account: $(sol "$RENT_PROGRAM") SOL, plus $(sol "$RENT_STUB") SOL in the program account"
echo "  held by the buffer during the upload, refunded when it lands: $(sol "$RENT_BUFFER") SOL"
echo "  most the deployer holds out at once: $(sol "$PEAK") SOL plus fees"
echo "  the deployer must hold at least $(sol "$NEEDED") SOL, and holds $(sol "$BAL_BEFORE") SOL"
echo "  the upgrade authority stays with the deployer key; docs/deploy/mainnet.md says how it moves to a multisig"
echo
printf 'Type yes to deploy, anything else stops here: '
ANSWER=""
read -r ANSWER || true
echo
[ "$ANSWER" = "yes" ] || refuse "the answer was not yes, so nothing was sent"

[ -f "$BUFFER_KEY" ] || solana-keygen new --no-bip39-passphrase --silent --outfile "$BUFFER_KEY" >/dev/null
chmod 600 "$BUFFER_KEY"
BUFFER_ID="$(solana-keygen pubkey "$BUFFER_KEY")"
echo "BUFFER: $BUFFER_ID"

recovery_notes() {
  echo "The buffer $BUFFER_ID keeps what was written. Nothing is lost:"
  echo "  run this same command again and it resumes from that buffer."
  echo "  to take the SOL back instead: solana program close $BUFFER_ID --keypair $DEPLOYER --url <MAINNET_RPC_URL>"
}

echo "DEPLOYING..."
DEPLOY_ARGS=(program deploy "$SO"
  --program-id "$PROGRAM_KEY"
  --upgrade-authority "$DEPLOYER"
  --buffer "$BUFFER_KEY"
  --max-len "$MAX_LEN"
  --with-compute-unit-price "$COMPUTE_UNIT_PRICE"
  --use-rpc)
if ! cli "${DEPLOY_ARGS[@]}"; then
  recovery_notes
  fail "the deploy did not complete"
fi

SHOW="$(mktemp)"
if ! cli program show "$PROGRAM_ID" > "$SHOW"; then
  rm -f "$SHOW"
  fail "the program cannot be read back after the deploy"
fi
VERIFY_DUMP="$(mktemp)"
cli program dump "$PROGRAM_ID" "$VERIFY_DUMP" >/dev/null || fail "the deployed code cannot be dumped back"
FINAL_HASH="$(head -c "$LEN" "$VERIFY_DUMP" | sha256sum | cut -d' ' -f1)"
PADDING="$(tail -c +"$(( LEN + 1 ))" "$VERIFY_DUMP" | tr -d '\0' | wc -c)"
rm -f "$VERIFY_DUMP"
BAL_AFTER="$(balance "$DEPLOYER_ID")"
if cli account "$BUFFER_ID" >/dev/null; then BUFFER_LEFT="still open, holding SOL"; else BUFFER_LEFT="closed, its SOL came back"; fi

echo "PROGRAM ID: $(awk '/^Program Id:/ {print $NF}' "$SHOW")"
echo "PROGRAM DATA ADDRESS: $(awk '/^ProgramData Address:/ {print $NF}' "$SHOW")"
echo "DEPLOYED SLOT: $(awk '/^Last Deployed In Slot:/ {print $NF}' "$SHOW")"
echo "UPGRADE AUTHORITY: $(awk '/^Authority:/ {print $NF}' "$SHOW")"
echo "PROGRAM DATA LENGTH: $(awk '/^Data Length:/ {print $3}' "$SHOW") bytes"
echo "RENT LOCKED IN PROGRAM ACCOUNT: $(awk '/^Balance:/ {print $2}' "$SHOW") SOL"
rm -f "$SHOW"
echo "BALANCE BEFORE: $(sol "$BAL_BEFORE") SOL"
echo "BALANCE AFTER: $(sol "$BAL_AFTER") SOL"
echo "SOL SPENT: $(sol "$(( BAL_BEFORE - BAL_AFTER ))") SOL, rent and fees together"
echo "UPLOAD BUFFER: $BUFFER_LEFT"
echo "LOCAL SHA256:    $LOCAL_HASH"
echo "ON-CHAIN SHA256: $FINAL_HASH"
[ "$FINAL_HASH" = "$LOCAL_HASH" ] || fail "the code on chain does not hash like the verified build"
[ "$PADDING" = "0" ] || fail "the program account holds $PADDING nonzero bytes past the code"
echo "HASH MATCH: YES"
echo "DEPLOY-MAINNET-OK"
