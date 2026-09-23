use anchor_lang::prelude::*;

use crate::errors::PanguError;

/// The Solana Attestation Service. The same address on mainnet and devnet.
/// Source: `program/src/lib.rs` in their repo, confirmed against both networks by RPC on 21 Sep 2026.
pub const SAS_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");

/// One byte in front of every account the service owns says which kind it is.
/// Source: `program/src/state/discriminator.rs` in their repo.
pub const CREDENTIAL_DISCRIMINATOR: u8 = 0;
pub const SCHEMA_DISCRIMINATOR: u8 = 1;
pub const ATTESTATION_DISCRIMINATOR: u8 = 2;

/// Seed prefix the service uses for an attestation address.
pub const ATTESTATION_SEED: &[u8] = b"attestation";

/// An expiry of exactly zero means the attestation never expires. Their own
/// example code gets this wrong by comparing straight against the clock, which
/// reads zero as "expired in 1970". Source: the `expiry` field comment in their
/// `program/src/state/attestation.rs`, "0 means never expired".
pub const NEVER_EXPIRES: i64 = 0;

/// Most authorized signers Pangu will read out of one Credential.
///
/// The list is written by whoever runs the credential, so it is not ours to
/// trust for length. A longer list is refused rather than walked, which keeps
/// the cost of a buy bounded. Sixty-four is far above any real verifier's
/// signing desk and the refusal only ever blocks buys, never sells.
pub const MAX_AUTHORIZED_SIGNERS: usize = 64;

const PUBKEY_LEN: usize = 32;

const ATTESTATION_NONCE_OFFSET: usize = 1;
const ATTESTATION_CREDENTIAL_OFFSET: usize = 33;
const ATTESTATION_SCHEMA_OFFSET: usize = 65;
const ATTESTATION_DATA_LEN_OFFSET: usize = 97;
const ATTESTATION_DATA_OFFSET: usize = 101;

const CREDENTIAL_NAME_LEN_OFFSET: usize = 33;
const CREDENTIAL_NAME_OFFSET: usize = 37;

const SCHEMA_CREDENTIAL_OFFSET: usize = 1;
const SCHEMA_FIRST_LENGTH_OFFSET: usize = 33;
/// Name, description, layout and field names all sit between the credential and
/// the paused flag, each behind its own four-byte length.
const SCHEMA_LENGTH_PREFIXED_FIELDS: usize = 4;

/// The facts Pangu reads off an attestation. The attestation's own data blob is
/// schema-shaped and means nothing to us, so it is skipped over, not parsed.
pub struct Attestation {
    /// The pubkey the address was derived from. By the convention Pangu requires,
    /// this is the wallet the attestation is about.
    pub nonce: Pubkey,
    pub credential: Pubkey,
    pub schema: Pubkey,
    /// Who signed the attestation into existence. The service checks this key was
    /// authorized at that moment and never looks again, which is why Pangu does.
    pub signer: Pubkey,
    /// Unix seconds, or zero for never.
    pub expiry: i64,
}

/// What Pangu needs from a schema: who runs it, and whether it is switched off.
pub struct SchemaHeader {
    pub credential: Pubkey,
    pub is_paused: bool,
}

/// Reads an attestation account.
///
/// Proves the account is owned by the attestation service and carries the
/// attestation discriminator before any field is read, then reads every field
/// through a bounds check. A missing, closed, foreign, truncated or
/// self-contradicting account comes back as `CredentialInvalid`, never a panic:
/// the buy fails closed and the seller is never touched.
pub fn parse_attestation(info: &AccountInfo) -> Result<Attestation> {
    require_keys_eq!(*info.owner, SAS_PROGRAM_ID, PanguError::CredentialInvalid);

    let data = info.try_borrow_data()?;
    require!(
        data.first() == Some(&ATTESTATION_DISCRIMINATOR),
        PanguError::CredentialInvalid
    );

    let nonce = read_pubkey(&data, ATTESTATION_NONCE_OFFSET)?;
    let credential = read_pubkey(&data, ATTESTATION_CREDENTIAL_OFFSET)?;
    let schema = read_pubkey(&data, ATTESTATION_SCHEMA_OFFSET)?;

    // The blob's own length decides where the last three fields start, so a
    // length larger than the account has to be caught here rather than trusted.
    let blob_len = read_u32(&data, ATTESTATION_DATA_LEN_OFFSET)?;
    let signer_offset = add(ATTESTATION_DATA_OFFSET, blob_len)?;
    let signer = read_pubkey(&data, signer_offset)?;
    let expiry = read_i64(&data, add(signer_offset, PUBKEY_LEN)?)?;

    Ok(Attestation {
        nonce,
        credential,
        schema,
        signer,
        expiry,
    })
}

/// Proves an account is a credential owned by the attestation service.
pub fn check_credential_account(info: &AccountInfo) -> Result<()> {
    require_keys_eq!(*info.owner, SAS_PROGRAM_ID, PanguError::CredentialInvalid);

    let data = info.try_borrow_data()?;
    require!(
        data.first() == Some(&CREDENTIAL_DISCRIMINATOR),
        PanguError::CredentialInvalid
    );

    Ok(())
}

/// Answers whether a key is on the credential's list of authorized signers right now.
///
/// Scans the stored list in place rather than collecting it, so a buy costs no
/// heap. The list is capped at `MAX_AUTHORIZED_SIGNERS`; a credential carrying
/// more is refused as `CredentialInvalid` instead of walked.
pub fn credential_has_signer(info: &AccountInfo, signer: &Pubkey) -> Result<bool> {
    check_credential_account(info)?;

    let data = info.try_borrow_data()?;
    let name_len = read_u32(&data, CREDENTIAL_NAME_LEN_OFFSET)?;
    let count_offset = add(CREDENTIAL_NAME_OFFSET, name_len)?;
    let count = read_u32(&data, count_offset)?;
    require!(
        count <= MAX_AUTHORIZED_SIGNERS,
        PanguError::CredentialInvalid
    );

    let mut offset = add(count_offset, 4)?;
    for _ in 0..count {
        if read_pubkey(&data, offset)? == *signer {
            return Ok(true);
        }
        offset = add(offset, PUBKEY_LEN)?;
    }

    Ok(false)
}

/// Reads the credential a schema belongs to and whether it is paused.
///
/// The paused flag sits behind four variable-length fields, so it can only be
/// reached by walking their lengths. Every step is bounds checked.
pub fn parse_schema_header(info: &AccountInfo) -> Result<SchemaHeader> {
    require_keys_eq!(*info.owner, SAS_PROGRAM_ID, PanguError::CredentialInvalid);

    let data = info.try_borrow_data()?;
    require!(
        data.first() == Some(&SCHEMA_DISCRIMINATOR),
        PanguError::CredentialInvalid
    );

    let credential = read_pubkey(&data, SCHEMA_CREDENTIAL_OFFSET)?;

    let mut offset = SCHEMA_FIRST_LENGTH_OFFSET;
    for _ in 0..SCHEMA_LENGTH_PREFIXED_FIELDS {
        let len = read_u32(&data, offset)?;
        offset = add(add(offset, 4)?, len)?;
    }

    let flag = data
        .get(offset)
        .ok_or_else(|| error!(PanguError::CredentialInvalid))?;

    Ok(SchemaHeader {
        credential,
        is_paused: *flag == 1,
    })
}

/// The one address an attestation for this credential, schema and wallet can have.
///
/// Pangu derives this itself on every buy instead of trusting the account the
/// transfer handed it, so a wrong or swapped account list cannot approve anyone.
pub fn derive_attestation(credential: &Pubkey, schema: &Pubkey, nonce: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            ATTESTATION_SEED,
            credential.as_ref(),
            schema.as_ref(),
            nonce.as_ref(),
        ],
        &SAS_PROGRAM_ID,
    )
    .0
}

fn read_pubkey(data: &[u8], offset: usize) -> Result<Pubkey> {
    let end = add(offset, PUBKEY_LEN)?;
    let bytes = data
        .get(offset..end)
        .ok_or_else(|| error!(PanguError::CredentialInvalid))?;
    let array: [u8; PUBKEY_LEN] = bytes
        .try_into()
        .map_err(|_| error!(PanguError::CredentialInvalid))?;
    Ok(Pubkey::new_from_array(array))
}

fn read_u32(data: &[u8], offset: usize) -> Result<usize> {
    let end = add(offset, 4)?;
    let bytes = data
        .get(offset..end)
        .ok_or_else(|| error!(PanguError::CredentialInvalid))?;
    let array: [u8; 4] = bytes
        .try_into()
        .map_err(|_| error!(PanguError::CredentialInvalid))?;
    Ok(u32::from_le_bytes(array) as usize)
}

fn read_i64(data: &[u8], offset: usize) -> Result<i64> {
    let end = add(offset, 8)?;
    let bytes = data
        .get(offset..end)
        .ok_or_else(|| error!(PanguError::CredentialInvalid))?;
    let array: [u8; 8] = bytes
        .try_into()
        .map_err(|_| error!(PanguError::CredentialInvalid))?;
    Ok(i64::from_le_bytes(array))
}

/// A length read out of an account can be anything, so every offset it feeds is
/// added with the overflow checked rather than wrapped.
fn add(left: usize, right: usize) -> Result<usize> {
    left.checked_add(right)
        .ok_or_else(|| error!(PanguError::CredentialInvalid))
}
