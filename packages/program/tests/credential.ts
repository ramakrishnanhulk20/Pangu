// Covers the verifier-credential mode: opening a sale against a credential and a
// schema, and every reason a buy through that sale is allowed or refused.
//
// The attestation service program is not loaded here. Its accounts are written
// byte for byte at their real addresses, which is the only way to aim a
// half-written or contradictory account at the hook. Whether those bytes match
// the real program is proven separately in fork-tests/life-credential.ts against
// the binary dumped from mainnet.
//
// Does NOT cover: the price band, issuing or closing attestations through the
// service itself, and what the service charges for any of it.

import { assert } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedWithTransferHookInstruction,
  getExtraAccountMetas,
} from "@solana/spl-token";
import {
  ACCESS_ISSUER_LIST,
  ACCESS_VERIFIER_CREDENTIAL,
  DECIMALS,
  Env,
  SAS_PROGRAM_ID,
  Verifier,
  accountAt,
  attest,
  attestationPda,
  buy,
  createTokenAccount,
  encodeCredential,
  expectError,
  expectFailure,
  fund,
  mintTokens,
  mustSucceed,
  openBuyerRecord,
  placeVerifier,
  putSasAccount,
  readRecord,
  readRules,
  removeAccount,
  sell,
  send,
  sendCreateSale,
  setCredentialSigners,
  setupEnv,
  tokenBalance,
} from "./sale-fixture";

const HOUR = 3_600n;

describe("create_sale in the verifier-credential mode", () => {
  it("stores the credential and schema and publishes six extra accounts", async () => {
    const env = await setupEnv();
    const verifier = placeVerifier(env);

    const result = mustSucceed(
      await sendCreateSale(env, {
        cap: 5_000n,
        accessMode: ACCESS_VERIFIER_CREDENTIAL,
        credential: verifier.credential,
        schema: verifier.schema,
      })
    );
    console.log(
      `      compute units, create_sale in mode 2: ${result.computeUnitsConsumed}`
    );

    const rules = await readRules(env);
    assert.equal(rules.accessMode, ACCESS_VERIFIER_CREDENTIAL);
    assert.isTrue(rules.credential.equals(verifier.credential));
    assert.isTrue(rules.schema.equals(verifier.schema));

    const list = await accountAt(env, env.extraMetas);
    const metas = getExtraAccountMetas({
      data: Buffer.from(list!.data),
    } as any);
    assert.equal(metas.length, 6);
    assert.isTrue(
      new PublicKey(metas[3].addressConfig).equals(SAS_PROGRAM_ID),
      "the attestation program is not at index 8"
    );
    assert.isTrue(
      new PublicKey(metas[4].addressConfig).equals(verifier.credential),
      "the credential is not at index 9"
    );
    assert.equal(
      metas[5].discriminator,
      128 + 8,
      "the attestation is not a PDA of the account at index 8"
    );
  });

  it("refuses the credential mode with no credential named", async () => {
    const env = await setupEnv();
    expectError(
      await sendCreateSale(env, { accessMode: ACCESS_VERIFIER_CREDENTIAL }),
      "CredentialInvalid"
    );
  });

  it("refuses a credential account that is not the attestation service's", async () => {
    const env = await setupEnv();
    const verifier = placeVerifier(env);
    putSasAccount(
      env,
      verifier.credential,
      encodeCredential(verifier.authority.publicKey, verifier.name, [
        verifier.signer.publicKey,
      ]),
      Keypair.generate().publicKey
    );

    expectError(
      await sendCreateSale(env, {
        accessMode: ACCESS_VERIFIER_CREDENTIAL,
        credential: verifier.credential,
        schema: verifier.schema,
      }),
      "CredentialInvalid"
    );
  });

  it("refuses a schema that belongs to another credential", async () => {
    const env = await setupEnv();
    const verifier = placeVerifier(env, {
      schemaCredential: Keypair.generate().publicKey,
    });

    expectError(
      await sendCreateSale(env, {
        accessMode: ACCESS_VERIFIER_CREDENTIAL,
        credential: verifier.credential,
        schema: verifier.schema,
      }),
      "CredentialInvalid"
    );
  });

  it("refuses a paused schema", async () => {
    const env = await setupEnv();
    const verifier = placeVerifier(env, { paused: true });

    expectError(
      await sendCreateSale(env, {
        accessMode: ACCESS_VERIFIER_CREDENTIAL,
        credential: verifier.credential,
        schema: verifier.schema,
      }),
      "CredentialInvalid"
    );
  });

  it("refuses the credential accounts in a mode that never reads them", async () => {
    const env = await setupEnv();
    const verifier = placeVerifier(env);

    expectError(
      await sendCreateSale(env, {
        accessMode: ACCESS_ISSUER_LIST,
        credentialAccount: verifier.credential,
        schemaAccount: verifier.schema,
      }),
      "CredentialInvalid"
    );
  });
});

describe("buys in the verifier-credential mode", () => {
  it("lets a wallet with a live attestation buy", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey, {
      expiry: (await now(env)) + HOUR,
    });

    const result = mustSucceed(await buy(env, buyer.account, 400n));
    console.log(
      `      compute units, buy in mode 2: ${result.computeUnitsConsumed}`
    );

    assert.equal(await tokenBalance(env, buyer.account), 400n);
    const record = await readRecord(env, buyer.wallet.publicKey);
    assert.equal(record.netBought.toString(), "400");
  });

  it("refuses a wallet with no attestation, never issued or closed since", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);

    expectError(await buy(env, buyer.account, 10n), "CredentialInvalid");

    const address = attest(env, verifier, buyer.wallet.publicKey);
    mustSucceed(await buy(env, buyer.account, 10n));

    // Revoking is closing the account, so afterwards there is simply nothing
    // at the address the hook looks at.
    removeAccount(env, address);
    expectError(await buy(env, buyer.account, 10n), "CredentialInvalid");
  });

  it("refuses an attestation owned by another program", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey, {
      owner: Keypair.generate().publicKey,
    });

    expectError(await buy(env, buyer.account, 10n), "CredentialInvalid");
  });

  it("refuses an account at the right address that is not an attestation", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey, { discriminator: 1 });

    expectError(await buy(env, buyer.account, 10n), "CredentialInvalid");
  });

  it("refuses an attestation issued under another credential", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey, {
      credential: Keypair.generate().publicKey,
    });

    expectError(await buy(env, buyer.account, 10n), "CredentialInvalid");
  });

  it("refuses an attestation issued against another schema", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey, {
      schema: Keypair.generate().publicKey,
    });

    expectError(await buy(env, buyer.account, 10n), "CredentialInvalid");
  });

  it("refuses another wallet's attestation, wherever it is put", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    const neighbour = await newBuyer(env);

    // The neighbour's attestation is real and works for the neighbour.
    attest(env, verifier, neighbour.wallet.publicKey);
    mustSucceed(await buy(env, neighbour.account, 10n));

    // It does nothing for this buyer, because the hook only ever looks at the
    // address this buyer's own wallet derives.
    expectError(await buy(env, buyer.account, 10n), "CredentialInvalid");

    // And copying it to that address does not help either: the wallet written
    // inside it still names the neighbour.
    attest(env, verifier, neighbour.wallet.publicKey, {
      at: attestationPda(
        verifier.credential,
        verifier.schema,
        buyer.wallet.publicKey
      ),
    });
    expectError(await buy(env, buyer.account, 10n), "CredentialInvalid");
  });

  it("refuses an expired attestation", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey, {
      expiry: (await now(env)) - 1n,
    });

    expectError(await buy(env, buyer.account, 10n), "CredentialExpired");
  });

  it("lets an attestation that never expires through", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey, { expiry: 0n });

    mustSucceed(await buy(env, buyer.account, 10n));
  });

  it("refuses an attestation whose expiry is exactly now", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey, { expiry: await now(env) });

    expectError(await buy(env, buyer.account, 10n), "CredentialExpired");
  });

  it("refuses an attestation whose signer has been taken off the credential", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey);
    mustSucceed(await buy(env, buyer.account, 10n));

    // The attestation is untouched. Only the credential changed, and that is
    // enough: a verifier who loses a key stops its old approvals at once.
    setCredentialSigners(env, verifier, [Keypair.generate().publicKey]);

    expectError(
      await buy(env, buyer.account, 10n),
      "CredentialSignerNotAuthorized"
    );
  });

  it("refuses a truncated attestation without falling over", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey, { truncateTo: 80 });

    expectError(await buy(env, buyer.account, 10n), "CredentialInvalid");
  });

  it("refuses an attestation that claims more data than it holds", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey, {
      statedDataLength: 4_000_000_000,
    });

    expectError(await buy(env, buyer.account, 10n), "CredentialInvalid");
  });

  it("still holds an attested wallet to the cap", async () => {
    const { env, verifier } = await credentialSale({ cap: 500n });
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey);

    mustSucceed(await buy(env, buyer.account, 500n));
    expectError(await buy(env, buyer.account, 1n), "OverCap");
  });

  it("still refuses an attested wallet that never opened a record", async () => {
    const { env, verifier } = await credentialSale();
    const wallet = Keypair.generate();
    const account = await createTokenAccount(env, wallet.publicKey);
    attest(env, verifier, wallet.publicKey);

    expectError(await buy(env, account, 10n), "BuyerRecordMissing");
  });
});

describe("sells in the verifier-credential mode", () => {
  it("lets a holder whose attestation is gone sell back to the pool", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    const address = attest(env, verifier, buyer.wallet.publicKey);
    mustSucceed(await buy(env, buyer.account, 400n));

    removeAccount(env, address);
    removeAccount(env, verifier.credential);

    const result = mustSucceed(
      await sell(env, buyer.account, buyer.wallet, 400n)
    );
    console.log(
      `      compute units, sell in mode 2: ${result.computeUnitsConsumed}`
    );

    assert.equal(await tokenBalance(env, buyer.account), 0n);
    const record = await readRecord(env, buyer.wallet.publicKey);
    assert.equal(record.netBought.toString(), "0");
  });

  it("needs the sale's extra accounts on a sell even though Pangu reads none", async () => {
    const { env, verifier } = await credentialSale();
    const buyer = await newBuyer(env);
    attest(env, verifier, buyer.wallet.publicKey);
    mustSucceed(await buy(env, buyer.account, 400n));

    const ix = await createTransferCheckedWithTransferHookInstruction(
      connectionOf(env),
      buyer.account,
      env.mint,
      env.vault,
      buyer.wallet.publicKey,
      300n,
      DECIMALS,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    ix.keys = ix.keys.slice(0, ix.keys.length - 3);

    const result = expectFailure(await send(env, [ix], [buyer.wallet]));
    const logs = (result.meta?.logMessages ?? []).join("\n");
    assert.notInclude(
      logs,
      "Program log: AnchorError",
      "Pangu was reached, so it was Pangu that refused the sell"
    );
    // Token-2022 resolves the whole published list itself and will not call a
    // hook without every account on it. A seller has to carry the attestation
    // accounts, but none of them has to exist and none of them is read, so no
    // state can ever shut the exit.
    console.log(`      dropping the attestation accounts on a sell: ${result.result}`);
  });
});

describe("the SaleRules byte layout the hook derives from", () => {
  it("keeps the credential at byte 145 and the schema at byte 177", async () => {
    const env = await setupEnv();
    const verifier = placeVerifier(env);
    mustSucceed(
      await sendCreateSale(env, {
        accessMode: ACCESS_VERIFIER_CREDENTIAL,
        credential: verifier.credential,
        schema: verifier.schema,
      })
    );

    // Mode 2's extra accounts are derived by reading these exact bytes out of
    // the rules account, and the reading is frozen the moment the account list
    // is written. If a field in front of them ever moves, the hook derives a
    // wrong address in silence instead of failing, so this is the test that
    // stops that change from landing.
    const rules = await accountAt(env, env.rules);
    const bytes = Buffer.from(rules!.data);
    assert.isTrue(
      new PublicKey(bytes.subarray(145, 177)).equals(verifier.credential)
    );
    assert.isTrue(
      new PublicKey(bytes.subarray(177, 209)).equals(verifier.schema)
    );
  });
});

/** A sale running on a stand-in verifier's credential, with a funded vault. */
async function credentialSale(
  options: { cap?: bigint; verifier?: Verifier } = {}
): Promise<{ env: Env; verifier: Verifier }> {
  const env = await setupEnv();
  const verifier = options.verifier ?? placeVerifier(env);
  mustSucceed(
    await sendCreateSale(env, {
      cap: options.cap ?? 1_000n,
      accessMode: ACCESS_VERIFIER_CREDENTIAL,
      credential: verifier.credential,
      schema: verifier.schema,
    })
  );
  await mintTokens(env, env.vault, 1_000_000n);
  return { env, verifier };
}

async function newBuyer(
  env: Env
): Promise<{ wallet: Keypair; account: PublicKey }> {
  const wallet = Keypair.generate();
  fund(env, wallet.publicKey);
  mustSucceed(await openBuyerRecord(env, wallet));
  return { wallet, account: await createTokenAccount(env, wallet.publicKey) };
}

async function now(env: Env): Promise<bigint> {
  return (await env.client.getClock()).unixTimestamp;
}

/** The read-only connection the SPL client needs to resolve the hook accounts. */
function connectionOf(env: Env): any {
  return {
    getAccountInfo: async (address: PublicKey) => {
      const account = await env.client.getAccount(address);
      if (account === null) {
        return null;
      }
      return {
        data: Buffer.from(account.data),
        executable: account.executable,
        lamports: Number(account.lamports),
        owner: account.owner,
        rentEpoch: 0,
      };
    },
  };
}
