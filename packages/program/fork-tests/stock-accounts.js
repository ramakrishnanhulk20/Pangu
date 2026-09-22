// Builds the accounts the stock-token-quote fork test needs, before the validator
// starts, because a validator can only be handed accounts on its command line.
//
// A Token-2022 stock token cannot be minted to a test wallet: nobody local holds
// its mint authority. So a real AAPLx token account is read from mainnet, its owner
// and its balance are rewritten, every extension byte is left alone, and the result
// is loaded at the test wallet's own associated token address.
//
// Usage: node stock-accounts.js <output directory>
// Prints one "<address> <file>" line per account for the validator's --account flag.
// Writes keypairs into the output directory, which is outside the repository.

const fs = require("fs");
const path = require("path");
const { Keypair, PublicKey } = require("@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} = require("@solana/spl-token");

const MAINNET = "https://api.mainnet-beta.solana.com";
const AAPLX = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const WALLETS = ["stock-buyer", "stock-partner"];
const BALANCE_IN_WHOLE_TOKENS = 1_000_000;

const OWNER_OFFSET = 32;
const AMOUNT_OFFSET = 64;

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The public mainnet endpoint throttles hard, so every read gets five tries. */
async function rpc(method, params) {
  let last = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(MAINNET, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await response.json();
    if (!body.error) {
      return body.result;
    }
    last = body.error.message;
    await pause(12000);
  }
  throw new Error(`${method}: ${last}`);
}

/** Reads mainnet once and keeps the answer, so a rerun does not hit the limit. */
async function cached(directory, name, read) {
  const file = path.join(directory, `${name}.cache.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  const value = await read();
  fs.writeFileSync(file, JSON.stringify(value));
  return value;
}

function loadOrCreateWallet(directory, name) {
  const file = path.join(directory, `${name}.json`);
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")))
    );
  }
  const keypair = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

const EXTENSION_NAMES = {
  4: "ConfidentialTransferMint",
  6: "DefaultAccountState",
  12: "PermanentDelegate",
  14: "TransferHook",
  18: "MetadataPointer",
  19: "TokenMetadata",
  25: "ScaledUiAmount",
  26: "Pausable",
};

/** Lists a mint's Token-2022 extensions, so the fork report can name them. */
function extensions(data) {
  const found = [];
  let cursor = 166;
  while (cursor + 4 <= data.length) {
    const type = data.readUInt16LE(cursor);
    const length = data.readUInt16LE(cursor + 2);
    if (type === 0) {
      break;
    }
    found.push({
      type,
      name: EXTENSION_NAMES[type] ?? `type ${type}`,
      value: data.subarray(cursor + 4, cursor + 4 + length),
    });
    cursor += 4 + length;
  }
  return found;
}

/** The three extensions that could change how DBC handles this token. */
function describeRisky(list) {
  const lines = [];
  for (const extension of list) {
    if (extension.type === 6) {
      const states = ["uninitialized", "initialized", "frozen"];
      lines.push(
        `DefaultAccountState: new accounts open as ${states[extension.value.readUInt8(0)]}`
      );
    }
    if (extension.type === 14) {
      const program = new PublicKey(extension.value.subarray(32, 64));
      lines.push(
        `TransferHook: program ${program.equals(PublicKey.default) ? "none" : program.toBase58()}`
      );
    }
    if (extension.type === 26) {
      lines.push(`Pausable: paused = ${extension.value.readUInt8(32) === 1}`);
    }
    if (extension.type === 12) {
      lines.push(
        `PermanentDelegate: ${new PublicKey(extension.value.subarray(0, 32)).toBase58()}`
      );
    }
  }
  return lines;
}

/**
 * Finds one real AAPLx token account.
 *
 * The obvious call, getTokenLargestAccounts, is throttled off on the public
 * mainnet endpoint, so this walks the mint's recent transactions instead and takes
 * the first token account that appears in one of them.
 */
async function findHolder() {
  const signatures = await rpc("getSignaturesForAddress", [
    AAPLX.toBase58(),
    { limit: 10 },
  ]);
  for (const entry of signatures) {
    await pause(2500);
    const transaction = await rpc("getTransaction", [
      entry.signature,
      { maxSupportedTransactionVersion: 1, encoding: "jsonParsed" },
    ]);
    if (transaction === null) {
      continue;
    }
    const loaded = transaction.meta.loadedAddresses ?? {
      writable: [],
      readonly: [],
    };
    const keys = transaction.transaction.message.accountKeys
      .map((key) => key.pubkey)
      .concat(loaded.writable, loaded.readonly);
    const balance = (transaction.meta.postTokenBalances ?? []).find(
      (item) => item.mint === AAPLX.toBase58()
    );
    if (balance !== undefined) {
      return keys[balance.accountIndex];
    }
  }
  throw new Error("no AAPLx token account found in the mint's recent history");
}

async function main() {
  const directory = process.argv[2];
  if (!directory) {
    throw new Error("give the output directory as the first argument");
  }
  fs.mkdirSync(directory, { recursive: true });

  const mint = await cached(directory, "aaplx-mint", () =>
    rpc("getAccountInfo", [AAPLX.toBase58(), { encoding: "base64" }])
  );
  const mintData = Buffer.from(mint.value.data[0], "base64");
  const decimals = mintData.readUInt8(44);
  const list = extensions(mintData);
  console.error(
    `AAPLx decimals ${decimals}, extensions ${list.map((e) => e.name).join(", ")}`
  );
  for (const line of describeRisky(list)) {
    console.error(`  ${line}`);
  }

  await pause(2000);
  const donorAddress = await cached(directory, "aaplx-holder", () =>
    findHolder()
  );

  await pause(2000);
  const donor = await cached(directory, "aaplx-donor", () =>
    rpc("getAccountInfo", [donorAddress, { encoding: "base64" }])
  );
  const donorData = Buffer.from(donor.value.data[0], "base64");
  console.error(
    `copied AAPLx account ${donorAddress}, ${donorData.length} bytes`
  );

  const amount = BigInt(BALANCE_IN_WHOLE_TOKENS) * 10n ** BigInt(decimals);

  for (const name of WALLETS) {
    const wallet = loadOrCreateWallet(directory, name);
    const address = getAssociatedTokenAddressSync(
      AAPLX,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const data = Buffer.from(donorData);
    wallet.publicKey.toBuffer().copy(data, OWNER_OFFSET);
    data.writeBigUInt64LE(amount, AMOUNT_OFFSET);

    const file = path.join(directory, `${name}-aaplx.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({
        pubkey: address.toBase58(),
        account: {
          lamports: donor.value.lamports,
          data: [data.toString("base64"), "base64"],
          owner: donor.value.owner,
          executable: false,
          rentEpoch: 0,
          space: data.length,
        },
      })
    );
    console.log(`${address.toBase58()} ${file}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
