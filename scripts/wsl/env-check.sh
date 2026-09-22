#!/bin/bash
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
anchor --version; solana --version; rustc --version; echo "node $(node --version) at $NODE_BIN"; npm --version
command -v rsync >/dev/null && echo "rsync ok" || echo "rsync MISSING"
echo ENV-OK
