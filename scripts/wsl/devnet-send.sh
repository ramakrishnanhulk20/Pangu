#!/bin/bash
# usage: devnet-send.sh <recipient> <amount-sol> [<recipient> <amount-sol> ...]
NODE_BIN="$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
KEY="$HOME/.config/solana/pangu-devnet.json"
while [ $# -ge 2 ]; do
  solana transfer "$1" "$2" --from "$KEY" --fee-payer "$KEY" --url https://api.devnet.solana.com --allow-unfunded-recipient 2>&1 | tail -1
  shift 2
done
echo "BALANCE LEFT: $(solana balance "$KEY" --url https://api.devnet.solana.com)"
