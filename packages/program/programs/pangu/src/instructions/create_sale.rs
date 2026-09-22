use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::spl_token_2022::{
        extension::{transfer_hook::TransferHook, BaseStateWithExtensions, StateWithExtensions},
        state::Mint as MintState,
    },
    token_interface::Mint,
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::{dbc, errors::PanguError, events::SaleCreated, price, sas, state::*};

/// The accounts the hook needs on top of the five the interface always sends:
/// the rules and the two buyer records.
pub const EXTRA_ACCOUNT_COUNT: usize = 3;
/// Mode 2 adds three more: the attestation program, the credential, and the
/// buyer's attestation.
pub const CREDENTIAL_EXTRA_ACCOUNT_COUNT: usize = 6;
/// A band adds two more on top of whatever the access mode needs: the DBC pool
/// the curve price is read from, and the Pyth price feed account.
pub const BAND_EXTRA_ACCOUNT_COUNT: usize = 2;

/// How many extra accounts a sale with these rules publishes. The list is written
/// once, so a sale only ever carries the accounts its own rules need.
pub fn extra_account_count(access_mode: u8, band_bps: u16) -> usize {
    let access = if access_mode == ACCESS_VERIFIER_CREDENTIAL {
        CREDENTIAL_EXTRA_ACCOUNT_COUNT
    } else {
        EXTRA_ACCOUNT_COUNT
    };
    if band_bps > 0 {
        access + BAND_EXTRA_ACCOUNT_COUNT
    } else {
        access
    }
}

/// Index of the mint in the Execute account list, fixed by the transfer-hook interface.
const EXECUTE_MINT_INDEX: u8 = 1;
/// Index of the source token account in the Execute account list.
const EXECUTE_SOURCE_INDEX: u8 = 0;
/// Index of the destination token account in the Execute account list.
const EXECUTE_DESTINATION_INDEX: u8 = 2;
/// Index of the rules account, the first extra account this program adds.
const EXECUTE_RULES_INDEX: u8 = 5;
/// Index of the attestation program, which the attestation address is derived under.
const EXECUTE_SAS_PROGRAM_INDEX: u8 = 8;
/// A token account stores its mint at bytes 0..32 and its owner at bytes 32..64.
const TOKEN_ACCOUNT_OWNER_OFFSET: u8 = 32;
const PUBKEY_LEN: u8 = 32;

/// Where `credential` and `schema` sit inside a serialized SaleRules.
///
/// The mode 2 extra accounts are derived by reading these exact bytes out of the
/// rules account at transfer time, and that reading is frozen the moment this
/// instruction writes the list. Moving or resizing any field in front of them
/// would silently derive the wrong address instead of failing, so the whole
/// account's size is pinned below and tests/credential.ts checks the two offsets
/// against real bytes.
const RULES_CREDENTIAL_OFFSET: u8 = 145;
const RULES_SCHEMA_OFFSET: u8 = 177;
const _: () = assert!(SaleRules::INIT_SPACE == 354);

#[derive(Accounts)]
#[instruction(cap: u64, access_mode: u8, credential: Pubkey, schema: Pubkey, band: PriceBand)]
pub struct CreateSale<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,

    /// CHECK: read as a DBC hook pool by `dbc::parse_hook_pool`, which proves the
    /// owning program, the length and the discriminator before any field is used.
    pub pool: UncheckedAccount<'info>,

    /// CHECK: unpacked as a Token-2022 mint with extensions in the handler. The
    /// owning program is checked there before the bytes are read.
    pub mint: UncheckedAccount<'info>,

    /// CHECK: mode 2 only, and required there. Proven in the handler to be the
    /// key named in `credential`, owned by the attestation service, and to carry
    /// the credential discriminator. Refused outright in the other modes.
    pub credential: Option<UncheckedAccount<'info>>,

    /// CHECK: mode 2 only, and required there. Proven in the handler to be the
    /// key named in `schema`, owned by the attestation service, to belong to
    /// `credential`, and not to be paused. Refused outright in the other modes.
    pub schema: Option<UncheckedAccount<'info>>,

    /// CHECK: required in every mode. Proven in the handler to be the DBC launch
    /// template this pool names, owned by DBC and of the right kind. Its fee mode
    /// decides whether the sale may open at all, and a banded sale also reads the
    /// paying token it was configured with.
    pub dbc_config: UncheckedAccount<'info>,

    /// Band only, and required there. Must be the paying token the template names.
    /// Its decimals are stored, so the hook can turn a curve price into dollars
    /// without being handed a mint at buy time.
    pub quote_mint: Option<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = issuer,
        space = 8 + SaleRules::INIT_SPACE,
        seeds = [SALE_SEED, mint.key().as_ref()],
        bump
    )]
    pub rules: Account<'info, SaleRules>,

    /// CHECK: written as an ExtraAccountMetaList below. Its address is fixed by the
    /// seeds the transfer-hook interface requires, and `init` makes it single-use.
    #[account(
        init,
        payer = issuer,
        space = ExtraAccountMetaList::size_of(extra_account_count(access_mode, band.band_bps))?,
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Opens a sale: stores the rules for a mint and publishes the account list the
/// transfer hook will be called with.
///
/// Preconditions: the DBC pool already exists, the signer is the pool's creator,
/// the pool is a transfer-hook pool whose base mint is `mint`, the mint already
/// names this program as its transfer hook and nobody can mint it any more, and the
/// pool's launch template collects fees in the paying token.
///
/// The template is passed in every mode, not only with a price band, because the
/// fee mode decides whether the sale can be safe at all.
///
/// In mode 2 the caller also passes the credential and schema accounts, and both
/// are proven here: owned by the attestation service, of the right kind, the
/// schema belonging to that credential, and the schema not paused. Proving them
/// once at creation is what lets the hook do only the cheap checks on every buy.
///
/// Rejects: `NotAHookPool` when the pool account is not DBC's, is the wrong length,
/// carries the wrong discriminator, or names a vault that is not DBC's PDA for this
/// mint and pool. `NotPoolCreator` when someone else signs. `WrongMint` when the
/// pool sells a different token. `HookProgramMismatch` when the mint is not
/// Token-2022 or its transfer hook is not this program. `MintAuthorityStillSet`
/// when the mint can still be minted. `WrongLaunchTemplate` when the template is
/// not the one the pool names. `FeesNotInQuoteToken` when that template collects
/// fees in the sale token. `ZeroCap` when the cap is
/// zero. `InvalidAccessMode` for an unknown mode, or for credential fields set
/// outside mode 2. `CredentialInvalid` when mode 2 is asked for without a
/// credential and schema, when either account is not the one named, not the
/// service's, of the wrong kind, from another credential or paused, or when those
/// accounts are passed in a mode that has no use for them.
///
/// With a price band the caller also passes the paying token, proven here to be
/// the one the template was configured with. Both mints' decimals are stored so
/// the hook never has to be handed a mint. `InvalidBand` when any band
/// setting is missing or out of range, or when band settings are given on a sale
/// with no band. `WrongPriceAccount` when the price account is not the address
/// this shard and this feed id produce under Pyth's price feed program. Running
/// twice fails, because both accounts are created here.
///
/// Emits `SaleCreated`.
pub fn handle_create_sale(
    ctx: Context<CreateSale>,
    cap: u64,
    access_mode: u8,
    credential: Pubkey,
    schema: Pubkey,
    band: PriceBand,
) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let pool_key = ctx.accounts.pool.key();

    let pool = dbc::parse_hook_pool(&ctx.accounts.pool.to_account_info())?;
    require_keys_eq!(
        pool.creator,
        ctx.accounts.issuer.key(),
        PanguError::NotPoolCreator
    );
    require_keys_eq!(pool.base_mint, mint_key, PanguError::WrongMint);
    require_keys_eq!(
        pool.base_vault,
        dbc::derive_base_vault(&mint_key, &pool_key),
        PanguError::NotAHookPool
    );

    require_keys_eq!(
        *ctx.accounts.mint.owner,
        anchor_spl::token_2022::ID,
        PanguError::HookProgramMismatch
    );
    let base_decimals = {
        let mint_data = ctx.accounts.mint.try_borrow_data()?;
        let mint_state = StateWithExtensions::<MintState>::unpack(&mint_data)
            .map_err(|_| error!(PanguError::HookProgramMismatch))?;
        let hook = mint_state
            .get_extension::<TransferHook>()
            .map_err(|_| error!(PanguError::HookProgramMismatch))?;
        let hook_program: Option<Pubkey> = hook.program_id.into();
        require!(
            hook_program == Some(crate::ID),
            PanguError::HookProgramMismatch
        );
        // Minting is not a transfer, so no hook ever sees it. A mint authority left
        // alive is a way to hand any wallet any amount, past the cap and past the
        // approved list, and then sell it into the pool. DBC revokes it at pool
        // creation for every token authority option except the two that say
        // "and mint authority", so a sale can insist on that here.
        require!(
            mint_state.base.mint_authority.is_none(),
            PanguError::MintAuthorityStillSet
        );
        mint_state.base.decimals
    };

    // The launch template decides which token the pool pays fees in, so it is read
    // on every sale and not only on a banded one. With fees taken in the sale token
    // a trade would move the sale token to the fee claimer and the referral account
    // through the hook, on a path the cap was never written for.
    let template = {
        let config_info = ctx.accounts.dbc_config.to_account_info();
        require_keys_eq!(
            config_info.key(),
            pool.config,
            PanguError::WrongLaunchTemplate
        );
        dbc::parse_hook_config(&config_info)?
    };
    require!(
        template.collect_fee_mode == dbc::COLLECT_FEE_MODE_QUOTE_TOKEN,
        PanguError::FeesNotInQuoteToken
    );

    require!(cap > 0, PanguError::ZeroCap);
    require!(
        access_mode == ACCESS_OPEN
            || access_mode == ACCESS_ISSUER_LIST
            || access_mode == ACCESS_VERIFIER_CREDENTIAL,
        PanguError::InvalidAccessMode
    );

    if access_mode == ACCESS_VERIFIER_CREDENTIAL {
        require!(
            credential != Pubkey::default() && schema != Pubkey::default(),
            PanguError::CredentialInvalid
        );

        let credential_info = ctx
            .accounts
            .credential
            .as_ref()
            .ok_or(PanguError::CredentialInvalid)?
            .to_account_info();
        let schema_info = ctx
            .accounts
            .schema
            .as_ref()
            .ok_or(PanguError::CredentialInvalid)?
            .to_account_info();
        require_keys_eq!(credential_info.key(), credential, PanguError::CredentialInvalid);
        require_keys_eq!(schema_info.key(), schema, PanguError::CredentialInvalid);

        sas::check_credential_account(&credential_info)?;
        let schema_header = sas::parse_schema_header(&schema_info)?;
        // One credential can run many schemas, so naming the credential alone
        // would let an attestation from the wrong schema in.
        require_keys_eq!(
            schema_header.credential,
            credential,
            PanguError::CredentialInvalid
        );
        // A paused schema is the verifier saying "stop issuing against this".
        // Opening a sale that depends on it would be opening a sale nobody can
        // join, so it is refused now rather than discovered at the first buy.
        require!(!schema_header.is_paused, PanguError::CredentialInvalid);
    } else {
        // The credential fields belong to mode 2. Outside it a value here would be
        // stored and never read, and refusing it is the only way a caller finds out
        // the rule they asked for is not in force.
        require!(
            credential == Pubkey::default() && schema == Pubkey::default(),
            PanguError::InvalidAccessMode
        );
        require!(
            ctx.accounts.credential.is_none() && ctx.accounts.schema.is_none(),
            PanguError::CredentialInvalid
        );
    }

    let decimals = if band.band_bps > 0 {
        Some(check_band(&ctx, &band, &template, base_decimals)?)
    } else {
        // Every band field belongs to a band. Storing one on a sale that has none
        // would leave a rule that reads as set and is never enforced.
        require!(band.is_empty(), PanguError::InvalidBand);
        require!(ctx.accounts.quote_mint.is_none(), PanguError::InvalidBand);
        None
    };

    let rules = &mut ctx.accounts.rules;
    rules.mint = mint_key;
    rules.pool = pool_key;
    rules.base_vault = pool.base_vault;
    rules.issuer = ctx.accounts.issuer.key();
    rules.cap = cap;
    rules.access_mode = access_mode;
    rules.credential = credential;
    rules.schema = schema;
    rules.price_account = band.price_account;
    rules.price_feed_id = band.price_feed_id;
    rules.price_shard = band.price_shard;
    rules.band_bps = band.band_bps;
    rules.max_price_age_secs = band.max_price_age_secs;
    rules.max_conf_bps = band.max_conf_bps;
    let (base_decimals, quote_decimals) = decimals.unwrap_or((0, 0));
    rules.base_decimals = base_decimals;
    rules.quote_decimals = quote_decimals;
    rules.buyers = 0;
    rules.total_net_bought = 0;
    rules.bump = ctx.bumps.rules;
    rules.reserved = [0u8; 64];

    // Both buyer records are derived from the owner field inside a token account, so
    // the hook is handed the record of whoever really receives or sends the tokens,
    // not a wallet the caller picked.
    let mut metas = vec![
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: SALE_SEED.to_vec(),
                },
                Seed::AccountKey {
                    index: EXECUTE_MINT_INDEX,
                },
            ],
            false,
            true,
        )?,
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: BUYER_SEED.to_vec(),
                },
                Seed::AccountKey {
                    index: EXECUTE_MINT_INDEX,
                },
                Seed::AccountData {
                    account_index: EXECUTE_DESTINATION_INDEX,
                    data_index: TOKEN_ACCOUNT_OWNER_OFFSET,
                    length: PUBKEY_LEN,
                },
            ],
            false,
            true,
        )?,
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: BUYER_SEED.to_vec(),
                },
                Seed::AccountKey {
                    index: EXECUTE_MINT_INDEX,
                },
                Seed::AccountData {
                    account_index: EXECUTE_SOURCE_INDEX,
                    data_index: TOKEN_ACCOUNT_OWNER_OFFSET,
                    length: PUBKEY_LEN,
                },
            ],
            false,
            true,
        )?,
    ];

    if access_mode == ACCESS_VERIFIER_CREDENTIAL {
        // The attestation service itself, carried only so the entry after it can
        // name the program its address is derived under.
        metas.push(ExtraAccountMeta::new_with_pubkey(
            &sas::SAS_PROGRAM_ID,
            false,
            false,
        )?);
        // The credential this sale trusts, written in as a fixed address. It is
        // the same value that goes into the rules a few lines above and the hook
        // checks it against the rules anyway, so the two can never disagree.
        metas.push(ExtraAccountMeta::new_with_pubkey(&credential, false, false)?);
        // The buyer's attestation: this sale's credential and schema, and the
        // owner of the account the tokens are landing in. Every seed comes from
        // an account the transfer cannot choose the contents of.
        metas.push(ExtraAccountMeta::new_external_pda_with_seeds(
            EXECUTE_SAS_PROGRAM_INDEX,
            &[
                Seed::Literal {
                    bytes: sas::ATTESTATION_SEED.to_vec(),
                },
                Seed::AccountData {
                    account_index: EXECUTE_RULES_INDEX,
                    data_index: RULES_CREDENTIAL_OFFSET,
                    length: PUBKEY_LEN,
                },
                Seed::AccountData {
                    account_index: EXECUTE_RULES_INDEX,
                    data_index: RULES_SCHEMA_OFFSET,
                    length: PUBKEY_LEN,
                },
                Seed::AccountData {
                    account_index: EXECUTE_DESTINATION_INDEX,
                    data_index: TOKEN_ACCOUNT_OWNER_OFFSET,
                    length: PUBKEY_LEN,
                },
            ],
            false,
            false,
        )?);
    }

    if band.band_bps > 0 {
        // The band's accounts come after the access mode's, so a sale in any mode
        // reads them at a position it works out from its own rules. Both are known
        // now, so both are written in as fixed addresses: an older Token-2022 build
        // refuses an address read out of another account's data. The hook still
        // compares each one against the rules before reading it.
        metas.push(ExtraAccountMeta::new_with_pubkey(&pool_key, false, false)?);
        metas.push(ExtraAccountMeta::new_with_pubkey(
            &band.price_account,
            false,
            false,
        )?);
    }

    let mut list_data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut list_data, &metas)?;

    emit!(SaleCreated {
        mint: mint_key,
        pool: pool_key,
        issuer: ctx.accounts.issuer.key(),
        base_vault: pool.base_vault,
        cap,
        access_mode,
        band_bps: band.band_bps,
    });

    Ok(())
}


/// Proves a price band is complete, in range, and pointed at the one price
/// account it could possibly mean, then returns the two mints' decimals.
///
/// The price account's address is derived here rather than trusted. It is a
/// program address of Pyth's price feed program over the shard id and the feed
/// id, so an issuer cannot name a real, guardian-signed price for some other
/// asset, and nobody else can create a rival account for this shard and feed.
///
/// The decimals are read through the pool's own launch template: the template
/// says which token buyers pay in, and the caller has to hand over that exact
/// mint. Taking a mint on the caller's word would let a sale be opened against a
/// six decimal reading of a nine decimal token, which moves the band by a
/// thousand.
///
/// Rejects `InvalidBand` for a missing or out of range setting, or a paying token
/// that is not the template's. `WrongPriceAccount` when the price account is not
/// the one this shard and this feed id produce.
fn check_band(
    ctx: &Context<CreateSale>,
    band: &PriceBand,
    template: &dbc::HookConfig,
    base_decimals: u8,
) -> Result<(u8, u8)> {
    require!(band.band_bps <= price::MAX_BAND_BPS, PanguError::InvalidBand);
    require!(band.price_feed_id != [0u8; 32], PanguError::InvalidBand);
    require!(
        (1..=price::MAX_PRICE_AGE_SECS).contains(&band.max_price_age_secs),
        PanguError::InvalidBand
    );
    // A band that accepted any confidence interval would be a ceiling measured
    // against a number Pyth's own publishers do not agree on, so zero is refused
    // the same way a setting out of range is.
    require!(
        (1..=price::MAX_CONF_BPS).contains(&band.max_conf_bps),
        PanguError::InvalidBand
    );

    require_keys_eq!(
        band.price_account,
        price::price_feed_address(band.price_shard, &band.price_feed_id),
        PanguError::WrongPriceAccount
    );

    let quote_mint = ctx
        .accounts
        .quote_mint
        .as_ref()
        .ok_or(PanguError::InvalidBand)?;
    require_keys_eq!(
        quote_mint.key(),
        template.quote_mint,
        PanguError::InvalidBand
    );

    let quote_decimals = quote_mint.decimals;
    require!(
        base_decimals <= price::MAX_DECIMALS && quote_decimals <= price::MAX_DECIMALS,
        PanguError::InvalidBand
    );

    Ok((base_decimals, quote_decimals))
}
