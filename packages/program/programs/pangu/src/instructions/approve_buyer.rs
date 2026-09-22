use anchor_lang::prelude::*;

use crate::{errors::PanguError, events::BuyerApproved, state::*};

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct ApproveBuyer<'info> {
    #[account(mut)]
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
        init_if_needed,
        payer = issuer,
        space = 8 + BuyerRecord::INIT_SPACE,
        seeds = [BUYER_SEED, mint.key().as_ref(), wallet.as_ref()],
        bump
    )]
    pub record: Account<'info, BuyerRecord>,

    pub system_program: Program<'info, System>,
}

/// Puts a wallet on the issuer's approved list, creating its record if it has none.
///
/// Preconditions: the sale runs in issuer-list mode and the signer is its issuer.
///
/// Rejects: `NotIssuer` for any other signer, `WrongMint` when the rules do not
/// belong to the given mint, `InvalidAccessMode` when the sale has no list.
///
/// Never touches `net_bought`, so re-approving a wallet cannot give it a fresh cap.
///
/// Emits `BuyerApproved`.
pub fn handle_approve_buyer(ctx: Context<ApproveBuyer>, wallet: Pubkey) -> Result<()> {
    require!(
        ctx.accounts.rules.access_mode == ACCESS_ISSUER_LIST,
        PanguError::InvalidAccessMode
    );

    let record = &mut ctx.accounts.record;
    record.mint = ctx.accounts.mint.key();
    record.wallet = wallet;
    record.bump = ctx.bumps.record;
    record.approved = true;

    emit!(BuyerApproved {
        mint: record.mint,
        wallet,
    });

    Ok(())
}
