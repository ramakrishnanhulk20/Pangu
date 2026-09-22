use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        immutable_owner::ImmutableOwner, transfer_hook::TransferHookAccount,
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::Account as TokenAccountState,
};
use spl_discriminator::SplDiscriminate;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::{
    dbc,
    errors::PanguError,
    events::{Bought, SoldBack},
    instructions::create_sale::{CREDENTIAL_EXTRA_ACCOUNT_COUNT, EXTRA_ACCOUNT_COUNT},
    price, sas,
    state::*,
};

/// Where the band's accounts start inside `remaining_accounts` for a sale in this
/// access mode. The band's accounts are always published after the mode's, so the
/// position is fixed by the rules and never by what the caller sent.
fn band_accounts_start(access_mode: u8) -> usize {
    if access_mode == ACCESS_VERIFIER_CREDENTIAL {
        // The three accounts the credential mode publishes sit at 5, 6 and 7 of the
        // extra list, which is 0, 1 and 2 of the remaining accounts.
        CREDENTIAL_EXTRA_ACCOUNT_COUNT - EXTRA_ACCOUNT_COUNT
    } else {
        0
    }
}

/// Token-2022 calls this entry point by the interface's own discriminator, not by an
/// Anchor name hash, so the program has to answer to that exact eight bytes.
pub const EXECUTE_DISCRIMINATOR: &[u8] = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE;

#[derive(Accounts)]
pub struct Execute<'info> {
    /// CHECK: unpacked below as a Token-2022 account with extensions, after its
    /// owning program is checked. Nothing is read from it before that.
    pub source_token: UncheckedAccount<'info>,

    /// CHECK: only the key is used. Both token accounts are proven to name it, and
    /// the rules account is proven to be the one derived from it.
    pub mint: UncheckedAccount<'info>,

    /// CHECK: unpacked below as a Token-2022 account with extensions, after its
    /// owning program is checked.
    pub destination_token: UncheckedAccount<'info>,

    /// CHECK: the authority that signed the transfer. The decision never reads it,
    /// because a signature proves nothing about who is allowed to receive tokens.
    pub authority: UncheckedAccount<'info>,

    /// CHECK: the transfer-hook interface fixes this account at index 4 and
    /// Token-2022 resolves the extra accounts from it before the call. Pangu itself
    /// reads nothing out of it, so it is carried, not trusted.
    pub extra_account_meta_list: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SALE_SEED, mint.key().as_ref()],
        bump = rules.bump,
        has_one = mint @ PanguError::WrongMint
    )]
    pub rules: Account<'info, SaleRules>,

    /// CHECK: may not exist yet, so Anchor cannot type it. Its address, owning
    /// program, discriminator, mint and wallet are all checked by hand below.
    #[account(mut)]
    pub destination_record: UncheckedAccount<'info>,

    /// CHECK: may not exist yet, so Anchor cannot type it. Its address, owning
    /// program, discriminator, mint and wallet are all checked by hand below.
    #[account(mut)]
    pub source_record: UncheckedAccount<'info>,
    // A sale in the verifier-credential mode publishes three more accounts after
    // these: the attestation program, the credential, and the buyer's
    // attestation. A sale with a price band publishes two more again, after
    // whatever the access mode needed: the DBC pool and the Pyth price feed
    // account. All of them arrive as remaining accounts and are read only on a
    // buy, so a sale without those rules costs exactly what it did before and no
    // sell ever touches them.
}

/// The transfer hook. Token-2022 runs this inside every movement of the sale token.
///
/// Preconditions: Token-2022 is genuinely mid-transfer, meaning both token accounts
/// carry the transferring flag it sets around the hook call. A direct call therefore
/// changes nothing.
///
/// Decides by address, never by signature. Tokens landing in the pool vault are a
/// sell and are always allowed. Tokens leaving the pool vault are a buy and must
/// clear the list and the cap. Anything else is one wallet handing tokens to
/// another, which is how a cap gets dodged, so it is refused.
///
/// Rejects: `NotTransferring` outside a real transfer, `WrongMint` when a token
/// account belongs to another token, `ReceivingAccountOwnerCanChange` when a buy
/// lands in an account whose owner could later be handed over,
/// `BuyerRecordMissing` when a buyer has no
/// record, `WrongBuyerRecord` when the record passed is not the buyer's own,
/// `NotApproved` when the list is on and the buyer is not on it,
/// `CredentialInvalid`, `CredentialExpired` and `CredentialSignerNotAuthorized`
/// when the sale runs on a verifier's credential and the buyer has no live
/// attestation from it, `WrongPriceAccount`, `PriceStale`,
/// `PriceNotFullyVerified`, `PriceTooUncertain` and `PriceOutsideBand` when the
/// sale carries a price band and this buy cannot be shown to sit inside it, `OverCap`
/// when the buy would take the wallet past the cap, `WrongLayoutVersion` when the
/// rules account was written by another layout of the program, `MathOverflow` on
/// any counter overflow, `WalletToWalletDuringSale` for everything else. A sell
/// never fails for any of these: a sale whose rules this build cannot read leaves
/// the counters alone and lets the tokens go.
///
/// Emits `Bought` on a buy and `SoldBack` on a sell that moved a record.
pub fn handle_execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let source = read_transferring_account(&ctx.accounts.source_token, &mint_key)?;
    let destination = read_transferring_account(&ctx.accounts.destination_token, &mint_key)?;

    let rules = &mut ctx.accounts.rules;

    if destination.key == rules.base_vault {
        // The exit. Past this point nothing may fail, so every step saturates and a
        // record that is missing or not the one we expect is simply left alone. A
        // holder who cannot sell is trapped, and trapping holders is worse than a
        // counter that drifts high and only ever costs that holder buying room.
        let expected = derive_record_key(&mint_key, &source.owner);
        // Rules from another layout cannot be counted against: the counters may
        // not be the bytes this build reads. That is treated exactly like a
        // missing record, so the sell still goes through and the exit keeps its
        // no-failure property. Refusing here would trap every holder of a sale
        // opened by an earlier build.
        let found = if rules.layout_is_current() {
            load_record(&ctx.accounts.source_record, &expected, &mint_key, &source.owner)
        } else {
            None
        };
        if let Some(mut record) = found {
            let before = record.net_bought;
            let after = before.saturating_sub(amount);
            let removed = before.saturating_sub(after);

            record.net_bought = after;
            rules.total_net_bought = rules.total_net_bought.saturating_sub(removed);
            if before > 0 && after == 0 {
                rules.buyers = rules.buyers.saturating_sub(1);
            }

            write_record(&ctx.accounts.source_record, &record)?;
            emit!(SoldBack {
                wallet: source.owner,
                amount,
                net_bought: after,
            });
        }

        return Ok(());
    }

    if source.key == rules.base_vault {
        // A buy reads the cap, the access mode and the band out of this account
        // at fixed offsets, so rules from another layout would be read as rules
        // they are not. Nothing on this path has to succeed, so it refuses.
        require!(rules.layout_is_current(), PanguError::WrongLayoutVersion);

        // Handing over ownership of a whole token account is not a transfer, so no
        // hook ever sees it. Without this rule a buyer could pass a full account to
        // an unapproved wallet, or pass one on and buy their cap again.
        require!(
            destination.owner_is_fixed,
            PanguError::ReceivingAccountOwnerCanChange
        );

        let expected = derive_record_key(&mint_key, &destination.owner);
        require_keys_eq!(
            ctx.accounts.destination_record.key(),
            expected,
            PanguError::WrongBuyerRecord
        );

        let mut record = load_record(
            &ctx.accounts.destination_record,
            &expected,
            &mint_key,
            &destination.owner,
        )
        .ok_or(PanguError::BuyerRecordMissing)?;

        if rules.access_mode == ACCESS_ISSUER_LIST {
            require!(record.approved, PanguError::NotApproved);
        } else if rules.access_mode == ACCESS_VERIFIER_CREDENTIAL {
            require_attestation(ctx.remaining_accounts, rules, &destination.owner)?;
        }

        if rules.has_band() {
            require_price_in_band(ctx.remaining_accounts, rules)?;
        }

        let before = record.net_bought;
        let after = before
            .checked_add(amount)
            .ok_or(PanguError::MathOverflow)?;
        require!(after <= rules.cap, PanguError::OverCap);

        record.net_bought = after;
        if before == 0 && after > 0 {
            rules.buyers = rules.buyers.checked_add(1).ok_or(PanguError::MathOverflow)?;
        }
        rules.total_net_bought = rules
            .total_net_bought
            .checked_add(amount)
            .ok_or(PanguError::MathOverflow)?;

        write_record(&ctx.accounts.destination_record, &record)?;
        emit!(Bought {
            wallet: destination.owner,
            amount,
            net_bought: after,
        });

        return Ok(());
    }

    err!(PanguError::WalletToWalletDuringSale)
}

/// Proves the wallet receiving the tokens holds an attestation this sale accepts,
/// right now.
///
/// The attestation service only checks who signed an attestation on the day it was
/// issued, and never again. So a verifier whose signing key is stolen cannot undo
/// the approvals that key handed out, short of closing every one of them by hand.
/// Pangu closes that by reading the credential's current list of signers on every
/// buy: take the key off the list and its old approvals stop working in the same
/// slot.
///
/// Every account here is proven rather than trusted. The credential must be the
/// one the rules name, the attestation must sit at the one address this sale's
/// credential, schema and this buyer can produce, and the wallet inside it must be
/// the same wallet the token account named. Nothing is taken on the word of the
/// account list the transfer arrived with.
///
/// Rejects: `CredentialInvalid` when an account is missing, foreign, of the wrong
/// kind, at the wrong address, for another credential or schema, about another
/// wallet, or malformed in any way. `CredentialExpired` when the attestation has
/// run out. `CredentialSignerNotAuthorized` when the key that signed it is no
/// longer on the credential's list.
fn require_attestation(
    extra_accounts: &[AccountInfo],
    rules: &SaleRules,
    wallet: &Pubkey,
) -> Result<()> {
    // Read by position, not by taking the whole slice: a sale with a price band
    // carries the band's accounts behind these three.
    let sas_program = extra_accounts
        .first()
        .ok_or(PanguError::CredentialInvalid)?;
    let credential = extra_accounts.get(1).ok_or(PanguError::CredentialInvalid)?;
    let attestation = extra_accounts.get(2).ok_or(PanguError::CredentialInvalid)?;

    require_keys_eq!(
        sas_program.key(),
        sas::SAS_PROGRAM_ID,
        PanguError::CredentialInvalid
    );
    require_keys_eq!(
        credential.key(),
        rules.credential,
        PanguError::CredentialInvalid
    );
    sas::check_credential_account(credential)?;

    // Derived here, from this sale's own rules and the owner read out of the
    // receiving token account. A revoked attestation is a closed account, so this
    // address simply holds nothing and the parse below refuses it.
    require_keys_eq!(
        attestation.key(),
        sas::derive_attestation(&rules.credential, &rules.schema, wallet),
        PanguError::CredentialInvalid
    );

    let attested = sas::parse_attestation(attestation)?;
    require_keys_eq!(
        attested.credential,
        rules.credential,
        PanguError::CredentialInvalid
    );
    require_keys_eq!(attested.schema, rules.schema, PanguError::CredentialInvalid);
    // The address already binds the attestation to this wallet. Checking the
    // wallet stored inside it as well means the two never have to be believed
    // separately, and an account that disagrees with its own address is refused.
    require_keys_eq!(attested.nonce, *wallet, PanguError::CredentialInvalid);

    require!(
        attested.expiry == sas::NEVER_EXPIRES
            || attested.expiry > Clock::get()?.unix_timestamp,
        PanguError::CredentialExpired
    );

    require!(
        sas::credential_has_signer(credential, &attested.signer)?,
        PanguError::CredentialSignerNotAuthorized
    );

    Ok(())
}

/// Proves this buy does not leave the curve price more than `band_bps` above the
/// live stock price.
///
/// Two accounts are read and both are proved first: the price account must be the
/// one the rules name and must be owned by Pyth's receiver program, and the DBC
/// pool must be the pool this sale was opened against. Nothing is taken on the
/// word of the account list the transfer arrived with. The address alone is not
/// enough, because an address is only a name; the owner check is what proves
/// nobody has put a look-alike account there instead, and only Pyth's receiver
/// program can write an account it owns.
///
/// The order matters. The price is judged before it is used, and the curve price
/// is read last, from the pool, so it is the price this buy has just produced
/// rather than the price before it.
///
/// The sale shutting overnight and at weekends falls out of the same freshness
/// rule: Pyth stops publishing an equity outside its trading sessions, so the
/// account ages out of the sale's limit on its own. The account carries no market
/// session flag, so a shut market and a broken publisher cannot be told apart
/// from here, and both refuse the buy.
///
/// Rejects: `WrongPriceAccount` when an account is missing, foreign, at the wrong
/// address, of the wrong owner, or does not hold a readable price update for this
/// sale's feed. `PriceNotFullyVerified` when fewer than two thirds of the
/// Wormhole guardians signed it. `PriceStale` when the price is older than the
/// sale allows, was published in the future, or is not above zero.
/// `PriceTooUncertain` when Pyth's confidence interval is wider than this sale
/// accepts. `PriceOutsideBand` when the buy would push the curve past the
/// ceiling.
fn require_price_in_band(extra_accounts: &[AccountInfo], rules: &SaleRules) -> Result<()> {
    let start = band_accounts_start(rules.access_mode);
    let pool_info = extra_accounts
        .get(start)
        .ok_or(PanguError::WrongPriceAccount)?;
    let price_info = extra_accounts
        .get(start + 1)
        .ok_or(PanguError::WrongPriceAccount)?;

    require_keys_eq!(
        price_info.key(),
        rules.price_account,
        PanguError::WrongPriceAccount
    );
    require_keys_eq!(
        *price_info.owner,
        price::RECEIVER_PROGRAM_ID,
        PanguError::WrongPriceAccount
    );

    let clock = Clock::get()?;
    let stock_price = {
        let data = price_info.try_borrow_data()?;
        price::read_banded_price(
            &data,
            &rules.price_feed_id,
            clock.unix_timestamp,
            rules.max_price_age_secs,
            rules.max_conf_bps,
        )?
    };

    require_keys_eq!(pool_info.key(), rules.pool, PanguError::WrongPriceAccount);
    let pool = dbc::parse_hook_pool(pool_info)?;

    let curve = price::curve_price_ceil_1e18(
        pool.sqrt_price,
        rules.base_decimals,
        rules.quote_decimals,
    )?;
    let ceiling = price::band_ceiling_floor_1e18(stock_price, rules.band_bps)?;
    require!(curve <= ceiling, PanguError::PriceOutsideBand);

    Ok(())
}

/// What the hook needs to know about one side of the transfer.
struct TokenAccountFacts {
    key: Pubkey,
    /// The wallet that owns the token account. Identity always comes from here, on
    /// both paths, so a wallet's extra token accounts all count against one cap.
    owner: Pubkey,
    /// True when the account carries Token-2022's `ImmutableOwner`, so the owner
    /// read above is the owner for the life of the account. Read on both sides
    /// because reading cannot fail; only the buy path acts on it.
    owner_is_fixed: bool,
}

/// Reads one side of the transfer and proves the transfer is real.
///
/// Token-2022 raises the transferring flag on both accounts only for the length of a
/// genuine transfer, so this is what separates a real call from someone invoking the
/// program directly to move their own counter.
fn read_transferring_account(
    info: &UncheckedAccount,
    mint: &Pubkey,
) -> Result<TokenAccountFacts> {
    require_keys_eq!(
        *info.owner,
        anchor_spl::token_2022::ID,
        PanguError::NotTransferring
    );

    let data = info.try_borrow_data()?;
    let state = StateWithExtensions::<TokenAccountState>::unpack(&data)
        .map_err(|_| error!(PanguError::NotTransferring))?;
    let flag = state
        .get_extension::<TransferHookAccount>()
        .map_err(|_| error!(PanguError::NotTransferring))?;
    require!(bool::from(flag.transferring), PanguError::NotTransferring);
    require_keys_eq!(state.base.mint, *mint, PanguError::WrongMint);

    Ok(TokenAccountFacts {
        key: info.key(),
        owner: state.base.owner,
        owner_is_fixed: state.get_extension::<ImmutableOwner>().is_ok(),
    })
}

fn derive_record_key(mint: &Pubkey, wallet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[BUYER_SEED, mint.as_ref(), wallet.as_ref()],
        &crate::ID,
    )
    .0
}

/// Reads a buyer record that may not exist.
///
/// Returns the record only when the account is at the address derived here, is owned
/// by this program, carries the `BuyerRecord` discriminator, and names this mint and
/// this wallet. Anything else reads as "no record" rather than as an error, so the
/// sell path can call it without gaining a way to fail.
fn load_record(
    info: &UncheckedAccount,
    expected_key: &Pubkey,
    mint: &Pubkey,
    wallet: &Pubkey,
) -> Option<BuyerRecord> {
    if info.key() != *expected_key || *info.owner != crate::ID {
        return None;
    }

    let data = info.try_borrow_data().ok()?;
    if data.len() < 8 + BuyerRecord::INIT_SPACE || data[..8] != BuyerRecord::DISCRIMINATOR[..] {
        return None;
    }

    let record = BuyerRecord::try_deserialize(&mut &data[..]).ok()?;
    if record.mint != *mint || record.wallet != *wallet {
        return None;
    }

    Some(record)
}

fn write_record(info: &UncheckedAccount, record: &BuyerRecord) -> Result<()> {
    let mut data = info.try_borrow_mut_data()?;
    let mut writer: &mut [u8] = &mut data[..];
    record.try_serialize(&mut writer)?;
    Ok(())
}
