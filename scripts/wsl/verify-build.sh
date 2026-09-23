#!/bin/bash
# usage: verify-build.sh
# Builds the mainnet binary of the Pangu program the way a stranger can repeat
# byte for byte: from the committed source only, inside the Solana Foundation's
# pinned build image, with solana-verify. It then builds the same source a second
# time in a fresh folder and refuses unless both builds hash the same, and builds
# the devnet binary from the same source with the one feature that differs, so
# the two network builds can be compared.
#
# Nothing here signs or sends a transaction. The binaries land in ~/pangu-release,
# which deploy-mainnet.sh takes as its input together with the hash printed here.
#
# The whole run takes longer than a single WSL call should, so start it detached
# and poll the log:
#
#   nohup setsid bash /mnt/d/Projects/Meteora/scripts/wsl/verify-build.sh \
#     > ~/pangu-verify-build.log 2>&1 < /dev/null &
#   tail -5 ~/pangu-verify-build.log
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -euo pipefail

REPO=/mnt/d/Projects/Meteora
PROGRAM_DIR=packages/program
WORK="$HOME/pangu-verify"
RELEASE="$HOME/pangu-release"
# The image is named by its exact tag so a stranger builds with the same
# compiler. 4.2.2 is the Solana release this machine's CLI runs.
IMAGE="solanafoundation/solana-verifiable-build:4.2.2"
LIBRARY=pangu

fail() { echo "VERIFY-BUILD-FAILED: $1"; exit 1; }

for tool in docker solana-verify git sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is not installed in WSL"
done
docker info >/dev/null 2>&1 || fail "the Docker daemon is not running, start it with: sudo systemctl start docker"

# The build must match a commit, or nobody else can reproduce it. The repository
# sits on the Windows drive, so git is told that this checkout is the owner's.
GIT=(git -c "safe.directory=$REPO" -C "$REPO")
if [ -n "$("${GIT[@]}" status --porcelain -- "$PROGRAM_DIR")" ]; then
  "${GIT[@]}" status --short -- "$PROGRAM_DIR"
  fail "$PROGRAM_DIR has changes that are not committed. A verifiable build is built from a commit only."
fi
COMMIT="$("${GIT[@]}" rev-parse HEAD)"
REMOTE="$("${GIT[@]}" remote get-url origin 2>/dev/null | sed -E 's#//[^@/]*@#//#' || true)"

# One fresh copy of the committed program folder per build, so nothing left over
# from an earlier build or from this machine's working tree can reach the binary.
checkout() {
  local into="$1"
  rm -rf "$into"
  mkdir -p "$into"
  "${GIT[@]}" archive --format=tar "$COMMIT" "$PROGRAM_DIR" | tar -x -C "$into"
  # Cargo inside the build container stalls on the crates.io index over WSL's
  # network unless HTTP multiplexing is off, the same fix ~/.cargo/config.toml
  # carries on this machine. It changes how crates are downloaded, never what is
  # compiled, so a stranger who builds without it gets the same bytes.
  mkdir -p "$into/$PROGRAM_DIR/.cargo"
  printf '[http]\nmultiplexing = false\n\n[net]\nretry = 10\n' > "$into/$PROGRAM_DIR/.cargo/config.toml"
  echo "$into/$PROGRAM_DIR"
}

build() {
  local folder="$1"
  shift
  (cd "$folder" && solana-verify build --library-name "$LIBRARY" --base-image "$IMAGE" "$@") \
    || fail "solana-verify build failed in $folder, see the lines above"
  [ -f "$folder/target/deploy/$LIBRARY.so" ] || fail "solana-verify produced no $folder/target/deploy/$LIBRARY.so"
}

hash_of() { sha256sum "$1" | cut -d' ' -f1; }

docker pull "$IMAGE"
IMAGE_DIGEST="$(docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE")"

echo "== mainnet build, first copy"
FIRST="$(checkout "$WORK/mainnet-a")"
build "$FIRST"
echo "== mainnet build, second copy, to prove the first can be repeated"
SECOND="$(checkout "$WORK/mainnet-b")"
build "$SECOND"
echo "== devnet build, the same source with the devnet feature"
DEVNET="$(checkout "$WORK/devnet")"
build "$DEVNET" -- --features devnet

MAINNET_SO="$FIRST/target/deploy/$LIBRARY.so"
REPEAT_SO="$SECOND/target/deploy/$LIBRARY.so"
DEVNET_SO="$DEVNET/target/deploy/$LIBRARY.so"
MAINNET_HASH="$(hash_of "$MAINNET_SO")"
REPEAT_HASH="$(hash_of "$REPEAT_SO")"
DEVNET_HASH="$(hash_of "$DEVNET_SO")"
[ "$MAINNET_HASH" = "$REPEAT_HASH" ] || fail "two builds of the same commit hash differently ($MAINNET_HASH and $REPEAT_HASH), so this build is not reproducible"
[ "$MAINNET_HASH" != "$DEVNET_HASH" ] || fail "the mainnet and devnet builds are identical, so the devnet feature did nothing"

# The two builds are told apart by the dollar list alone. A program id is 32 raw
# bytes the compiler loads as eight 4 byte pieces, so each id is looked for as
# its eight pieces, the same check build.sh runs on the devnet build.
check_list() {
  SO_PATH="$1" WANTED="$2" UNWANTED="$3" node - <<'NODE'
const fs = require("fs");
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(text) {
  const bytes = [0];
  for (const character of text) {
    let carry = ALPHABET.indexOf(character);
    if (carry < 0) throw new Error(`not base58: ${text}`);
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const character of text) {
    if (character !== "1") break;
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}
const binary = fs.readFileSync(process.env.SO_PATH);
const pieces = (id) => {
  const key = base58(id);
  let found = 0;
  for (let offset = 0; offset < 32; offset += 4) {
    if (binary.includes(key.subarray(offset, offset + 4))) found += 1;
  }
  return found;
};
let ok = true;
for (const id of process.env.WANTED.split(" ").filter(Boolean)) {
  const found = pieces(id);
  console.log(`    carries ${id}: ${found} of 8 pieces`);
  if (found !== 8) ok = false;
}
for (const id of process.env.UNWANTED.split(" ").filter(Boolean)) {
  const found = pieces(id);
  console.log(`    lacks   ${id}: ${found} of 8 pieces, wanted 0`);
  if (found !== 0) ok = false;
}
process.exit(ok ? 0 : 1);
NODE
}
MAINNET_USDC=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
DEVNET_DOLLARS="4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU 2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5"
PYTH="rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT"
echo "== the mainnet binary's dollar list"
check_list "$MAINNET_SO" "$PYTH $MAINNET_USDC" "$DEVNET_DOLLARS" || fail "the mainnet binary does not carry exactly mainnet USDC"
echo "== the devnet binary's dollar list"
check_list "$DEVNET_SO" "$PYTH $DEVNET_DOLLARS" "$MAINNET_USDC" || fail "the devnet binary does not carry exactly the devnet dollars"

mkdir -p "$RELEASE"
cp "$MAINNET_SO" "$RELEASE/pangu-mainnet.so"
cp "$DEVNET_SO" "$RELEASE/pangu-devnet.so"
[ "$(hash_of "$RELEASE/pangu-mainnet.so")" = "$MAINNET_HASH" ] || fail "the copy in $RELEASE does not hash like the build"

MAINNET_LEN="$(stat -c%s "$MAINNET_SO")"
DEVNET_LEN="$(stat -c%s "$DEVNET_SO")"
# solana-verify compares an executable hash that ignores the zero padding a
# program account carries past the code, which is what get-program-hash reads
# off the chain after the deploy.
MAINNET_EXEC_HASH="$(solana-verify get-executable-hash "$MAINNET_SO")"
DEVNET_EXEC_HASH="$(solana-verify get-executable-hash "$DEVNET_SO")"

echo
echo "SOURCE: commit $COMMIT, folder $PROGRAM_DIR${REMOTE:+, of $REMOTE}"
echo "IMAGE: $IMAGE ($IMAGE_DIGEST)"
echo "TOOLS: solana-verify $(solana-verify --version | awk '{print $2}'), docker $(docker version --format '{{.Server.Version}}'), SBPF v0"
echo "MAINNET BINARY: $RELEASE/pangu-mainnet.so"
echo "MAINNET LENGTH: $MAINNET_LEN bytes"
echo "MAINNET SHA256: $MAINNET_HASH"
echo "MAINNET SHA256, SECOND BUILD: $REPEAT_HASH (the same, so the build repeats)"
echo "MAINNET EXECUTABLE HASH (solana-verify): $MAINNET_EXEC_HASH"
echo "DEVNET BINARY: $RELEASE/pangu-devnet.so"
echo "DEVNET LENGTH: $DEVNET_LEN bytes"
echo "DEVNET SHA256: $DEVNET_HASH"
echo "DEVNET EXECUTABLE HASH (solana-verify): $DEVNET_EXEC_HASH"
echo "DIFFERENCE: same commit, same image, same command; the devnet build adds --features devnet, which swaps the one dollar list checked above. It is $(( DEVNET_LEN - MAINNET_LEN )) bytes longer because its list holds two dollars instead of one."
echo
echo "TO REPRODUCE: on Linux with Docker and solana-verify $(solana-verify --version | awk '{print $2}'),"
echo "  git clone ${REMOTE:-<the Pangu repository>} pangu && cd pangu && git checkout $COMMIT"
echo "  cd $PROGRAM_DIR && solana-verify build --library-name $LIBRARY --base-image $IMAGE"
echo "  sha256sum target/deploy/$LIBRARY.so    # prints $MAINNET_HASH"
echo "NEXT: deploy-mainnet.sh $RELEASE/pangu-mainnet.so $MAINNET_HASH <deployer keypair path>"
echo VERIFY-BUILD-OK
