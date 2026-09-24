#!/bin/bash
# Sourced, never run. verify-build.sh and deploy-mainnet.sh both judge a binary
# with these functions, so the build that printed a hash and the deploy that
# takes it cannot disagree about what the mainnet build is.
#
# Needs node on the PATH for check_list. A missing node makes check_list fail,
# which both callers treat as a refusal.

MAINNET_USDC=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
DEVNET_USDC=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
DEMO_DOLLAR=2TYsrKmXKrqxLRULNBGFrGjTnxebo1H2azRb7bzQPem5
DEVNET_DOLLARS="$DEVNET_USDC $DEMO_DOLLAR"
PYTH="rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT"
# The oracle Pyth replaced; build.sh proves no trace of it is left.
SWITCHBOARD="orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv"
ID_NAMES="$MAINNET_USDC=mainnet USDC;$DEVNET_USDC=devnet USDC;$DEMO_DOLLAR=the demo dollar;rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ=Pyth's receiver program;pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT=Pyth's price feed program;orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz=Switchboard quote;SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv=Switchboard on demand"

# The SBPF version sits in the ELF header's e_flags, four bytes at offset 48.
# Prints nothing for a file too short to have one, and never fails, so a caller
# under pipefail refuses the file rather than stopping on od's error.
sbpf_version() { { od -An -t u4 -j 48 -N 4 "$1" 2>/dev/null || true; } | tr -d ' '; }

# check_list <binary> <ids it must carry> <ids it must not carry>
# A program id is 32 raw bytes the compiler loads as eight 4 byte pieces, so
# each id is looked for as its eight pieces, the same check build.sh runs on
# the devnet build. Prints one line per id and, when any id is not as wanted, a
# last line "NOT AS WANTED: ..." naming each one; returns 1 then.
check_list() {
  SO_PATH="$1" WANTED="$2" UNWANTED="$3" NAMES="$ID_NAMES" node - <<'NODE'
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
const names = new Map(
  process.env.NAMES.split(";").map((pair) => {
    const at = pair.indexOf("=");
    return [pair.slice(0, at), pair.slice(at + 1)];
  })
);
const nameOf = (id) => (names.has(id) ? `${names.get(id)} ${id}` : id);
const binary = fs.readFileSync(process.env.SO_PATH);
const pieces = (id) => {
  const key = base58(id);
  let found = 0;
  for (let offset = 0; offset < 32; offset += 4) {
    if (binary.includes(key.subarray(offset, offset + 4))) found += 1;
  }
  return found;
};
const wrong = [];
for (const id of process.env.WANTED.split(" ").filter(Boolean)) {
  const found = pieces(id);
  console.log(`    carries ${nameOf(id)}: ${found} of 8 pieces`);
  if (found !== 8) wrong.push(`lacks ${names.get(id) ?? id} (${found} of 8 pieces)`);
}
for (const id of process.env.UNWANTED.split(" ").filter(Boolean)) {
  const found = pieces(id);
  console.log(`    lacks   ${nameOf(id)}: ${found} of 8 pieces, wanted 0`);
  if (found !== 0) wrong.push(`carries ${names.get(id) ?? id} (${found} of 8 pieces)`);
}
if (wrong.length > 0) console.log(`NOT AS WANTED: ${wrong.join(", ")}`);
process.exit(wrong.length === 0 ? 0 : 1);
NODE
}

# The mainnet build carries Pyth's two programs and mainnet USDC, and neither
# devnet dollar. The dollar list is the only thing the devnet feature changes.
check_mainnet_list() { check_list "$1" "$PYTH $MAINNET_USDC" "$DEVNET_DOLLARS"; }
check_devnet_list() { check_list "$1" "$PYTH $DEVNET_DOLLARS" "$MAINNET_USDC"; }
