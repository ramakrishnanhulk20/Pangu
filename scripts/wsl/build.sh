#!/bin/bash
# usage: build.sh
# Builds the Pangu program for devnet. Pyth's receiver and price feed programs sit
# at the same addresses on every network, but the dollar tokens a price ceiling
# may be set on do not, so the build turns on the program's `devnet` feature and
# carries devnet USDC and the demo dollar instead of mainnet USDC.
#
# Two files come out of one source:
#   target/deploy/pangu.so                       SBPF v3, the binary devnet runs
#   target/deploy/pangu-v0-for-unit-tests.so     SBPF v0, read only by test.sh
# SBPF v3 is the one format the network will keep accepting for deploys and
# upgrades once SIMD-0500 switches the older ones off (docs/deploy/mainnet.md).
# The unit suite runs on solana-bankrun 0.4.0, which cannot load v3, so it gets
# the same source built as v0 under a name nothing deploys.
#
# The mainnet build is the same v3 command without the feature. scripts/wsl/verify-build.sh
# makes it reproducibly, and only a person deploys it, with scripts/wsl/deploy-mainnet.sh
# (see docs/deploy/mainnet.md):
#   cd ~/pangu-build && anchor build --arch v3
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
set -euo pipefail

SRC=/mnt/d/Projects/Meteora/packages/program
WORK="$HOME/pangu-build"

# Building straight on /mnt/d is several times slower than the WSL filesystem,
# so the workspace is mirrored to $HOME and only the artefacts travel back.
mkdir -p "$WORK"
rsync -a --delete \
  --exclude node_modules --exclude target --exclude .anchor \
  "$SRC/" "$WORK/"

OUT="target/deploy/pangu.so"
UNIT_OUT="target/deploy/pangu-v0-for-unit-tests.so"

# The SBPF version sits in the ELF header's e_flags, four bytes at offset 48.
sbpf_version() { od -An -t u4 -j 48 -N 4 "$1" | tr -d ' '; }

cd "$WORK"
rm -f "$OUT" "$UNIT_OUT"
# The v0 build goes first and is moved aside at once, so the name pangu.so only
# ever holds the v3 build by the time anything reads it.
anchor build --no-idl --arch v0 -- --features devnet
mv "$OUT" "$UNIT_OUT"
anchor build --arch v3 -- --features devnet

[ "$(sbpf_version "$OUT")" = "3" ] || { echo "BUILD-FAILED: $OUT is SBPF v$(sbpf_version "$OUT"), not v3"; exit 1; }
[ "$(sbpf_version "$UNIT_OUT")" = "0" ] || { echo "BUILD-FAILED: $UNIT_OUT is SBPF v$(sbpf_version "$UNIT_OUT"), not v0"; exit 1; }

mkdir -p "$SRC/target/deploy" "$SRC/target/idl" "$SRC/target/types"
cp "$OUT" "$SRC/$OUT"
cp "$UNIT_OUT" "$SRC/$UNIT_OUT"
cp target/idl/pangu.json "$SRC/target/idl/pangu.json"
cp target/types/pangu.ts "$SRC/target/types/pangu.ts"

# Proof that each build really carries Pyth's two program ids, the devnet dollar
# list and no trace of the oracle it replaced or of the mainnet dollar list,
# rather than a build that looks right because nothing complained. A program id
# is 32 raw bytes and the compiler loads them as eight 4 byte immediates rather
# than one run of bytes, so the check looks for the eight pieces of each.
check_dollar_list() {
SO_PATH="$1" node - <<'NODE'
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

const WANTED = {
  "Pyth receiver": "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
  "Pyth price feed": "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT",
  "devnet USDC": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "demo dollar": "2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5",
};
const UNWANTED = {
  "mainnet USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Switchboard quote": "orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz",
  "Switchboard on demand": "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv",
};
const binary = fs.readFileSync(process.env.SO_PATH);

function piecesFound(id) {
  const key = base58(id);
  let found = 0;
  for (let offset = 0; offset < 32; offset += 4) {
    if (binary.includes(key.subarray(offset, offset + 4))) found += 1;
  }
  return found;
}

let ok = true;
for (const [name, id] of Object.entries(WANTED)) {
  const found = piecesFound(id);
  console.log(`  ${name} ${id}: ${found} of 8 pieces in the binary`);
  if (found !== 8) ok = false;
}
for (const [name, id] of Object.entries(UNWANTED)) {
  const found = piecesFound(id);
  console.log(`  ${name} ${id}: ${found} of 8 pieces, wanted 0`);
  if (found !== 0) ok = false;
}
if (!ok) {
  console.log("BUILD-FAILED: this build does not carry exactly Pyth's two programs and the devnet dollar list.");
  process.exit(1);
}
NODE
}
echo "the v3 build, $OUT:"
check_dollar_list "$WORK/$OUT" || exit 1
echo "the v0 unit-test build, $UNIT_OUT:"
check_dollar_list "$WORK/$UNIT_OUT" || exit 1

echo "BINARY: $SRC/$OUT"
echo "SBPF: v$(sbpf_version "$OUT"), the binary devnet runs and deploy.sh ships"
echo "LENGTH: $(stat -c%s "$OUT") bytes"
echo "SHA256: $(sha256sum "$OUT" | cut -d' ' -f1)"
echo "UNIT-TEST BINARY: $SRC/$UNIT_OUT"
echo "UNIT-TEST SBPF: v$(sbpf_version "$UNIT_OUT"), the same source for the bankrun unit suite only, never deployed"
echo "UNIT-TEST LENGTH: $(stat -c%s "$UNIT_OUT") bytes"
echo "UNIT-TEST SHA256: $(sha256sum "$UNIT_OUT" | cut -d' ' -f1)"
echo "IDL SHA256: $(sha256sum target/idl/pangu.json | cut -d' ' -f1)"
echo BUILD-OK
