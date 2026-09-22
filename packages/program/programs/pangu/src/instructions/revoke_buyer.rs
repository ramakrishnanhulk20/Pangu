use anchor_lang::prelude::*;

use crate::{errors::PanguError, events::BuyerRevoked, state::*};

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct RevokeBuyer<'info> {
    pub issuer: Signer<'info>,

    /// CHECK: only the key is used, and the rules account is proven to name it.
    pub mint: UncheckedAccount<'info>,

    #[account(
        seeds = [SALE_SEED, mint.key().as_ref()],
        bump = rules.bump,
        has_one = issuer @ PanguError::NotIssuer,
        has_one = mint @ PanguError::WrongMint
    )]
    pub rules: Account<'info, SaleRules>,

    #[account(
        mut,
        seeds = [BUYER_SEED, mint.key().as_ref(), wallet.as_ref()],
        bump = record.bump,
        has_one = mint @ PanguError::WrongMint
    )]
    pub record: Account<'info, BuyerRecord>,
}

/// Takes a wallet off the issuer's approved list.
///
/// The wallet keeps whatever it bought and can still sell it back to the pool. Only
/// buying stops.
///
/// Preconditions: the sale runs in issuer-list mode, the signer is its issuer, and
/// the wallet already has a record.
///
/// Rejects: `NotIssuer` for any other signer, `WrongMint` when the accounts do not
/// belong to the given mint, `WrongLayoutVersion` when the rules account was
/// written by another layout of the program, `InvalidAccessMode` when the sale
/// has no list.
///
/// Emits `BuyerRevoked`.
pub fn handle_revoke_buyer(ctx: Context<RevokeBuyer>, wallet: Pubkey) -> Result<()> {
    require!(
        ctx.accounts.rules.layout_is_current(),
        PanguError::WrongLayoutVersion
    );
    require!(
        ctx.accounts.rules.access_mode == ACCESS_ISSUER_LIST,
        PanguError::InvalidAccessMode
    );

    ctx.accounts.record.approved = false;

    emit!(BuyerRevoked {
        mint: ctx.accounts.mint.key(),
        wallet,
    });

    Ok(())
}
