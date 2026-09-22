#!/bin/bash
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
SRC="$HOME/pangu-build/target/deploy/pangu-keypair.json"
DST="$HOME/.config/solana/pangu-program-keypair.json"
mkdir -p "$HOME/.config/solana"
[ -f "$SRC" ] || { echo "NO SOURCE KEYPAIR"; exit 1; }
# Never overwrite an existing backup: a different key here would mean a different program address.
if [ -f "$DST" ]; then
  [ "$(solana-keygen pubkey "$SRC")" = "$(solana-keygen pubkey "$DST")" ] && echo "BACKUP ALREADY MATCHES" || echo "WARNING: BACKUP HOLDS A DIFFERENT KEY, NOT TOUCHED"
else
  cp "$SRC" "$DST" && chmod 600 "$DST" && echo "BACKED UP"
fi
echo "PROGRAM ID: $(solana-keygen pubkey "$DST")"
