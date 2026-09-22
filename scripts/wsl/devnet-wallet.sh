#!/bin/bash
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
# The devnet deployer lives outside the repo so it can never be staged.
KEY="$HOME/.config/solana/pangu-devnet.json"
mkdir -p "$HOME/.config/solana"
[ -f "$KEY" ] || solana-keygen new --no-bip39-passphrase --silent --outfile "$KEY" >/dev/null
chmod 600 "$KEY"
echo "DEVNET WALLET: $(solana-keygen pubkey "$KEY")"
echo "BALANCE: $(solana balance "$KEY" --url https://api.devnet.solana.com 2>&1)"
if [ "$1" = "airdrop" ]; then solana airdrop 2 "$KEY" --url https://api.devnet.solana.com 2>&1 | tail -2; fi
