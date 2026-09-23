#!/bin/bash
# usage: build.sh
# Builds the Pangu program for devnet. Pyth's receiver and price feed programs sit
# at the same addresses on every network, but the dollar tokens a price ceiling
# may be set on do not, so the build turns on the program's `devnet` feature and
# carries devnet USDC and the demo dollar instead of mainnet USDC.
#
# The mainnet build is the same command without the feature, run by hand from the
# mirrored workspace, and nothing in this repo deploys it:
#   cd ~/pangu-build && anchor build --arch v0
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

cd "$WORK"
# Anchor 1.2.0 defaults to SBPF v3. The litesvm build the tests run on only loads
# v0 bytecode, and v0 runs everywhere on chain, so v0 is what we build.
anchor build --arch v0 -- --features devnet

OUT="target/deploy/pangu.so"

mkdir -p "$SRC/target/deploy" "$SRC/target/idl" "$SRC/target/types"
cp "$OUT" "$SRC/$OUT"
cp target/idl/pangu.json "$SRC/target/idl/pangu.json"
cp target/types/pangu.ts "$SRC/target/types/pangu.ts"

# Proof that the build really carries Pyth's two program ids, the devnet dollar
# list and no trace of the oracle it replaced or of the mainnet dollar list,
# rather than a build that looks right because nothing complained. A program id
# is 32 raw bytes and the compiler loads them as eight 4 byte immediates rather
# than one run of bytes, so the check looks for the eight pieces of each.
SO_PATH="$WORK/$OUT" node - <<'NODE'
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

echo "BINARY: $SRC/$OUT"
echo "LENGTH: $(stat -c%s "$OUT") bytes"
echo "SHA256: $(sha256sum "$OUT" | cut -d' ' -f1)"
echo "IDL SHA256: $(sha256sum target/idl/pangu.json | cut -d' ' -f1)"
echo BUILD-OK
