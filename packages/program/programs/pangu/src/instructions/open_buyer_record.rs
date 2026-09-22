use anchor_lang::prelude::*;

use crate::{errors::PanguError, events::BuyerRecordOpened, state::*};

#[derive(Accounts)]
pub struct OpenBuyerRecord<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,

    /// CHECK: only the key is used, to derive the rules and the record.
    pub mint: UncheckedAccount<'info>,

    #[account(
        seeds = [SALE_SEED, mint.key().as_ref()],
        bump = rules.bump
    )]
    pub rules: Account<'info, SaleRules>,

    #[account(
        init_if_needed,
        payer = wallet,
        space = 8 + BuyerRecord::INIT_SPACE,
        seeds = [BUYER_SEED, mint.key().as_ref(), wallet.key().as_ref()],
        bump
    )]
    pub record: Account<'info, BuyerRecord>,

    pub system_program: Program<'info, System>,
}

/// Creates the caller's own record for a sale, so the hook has somewhere to count.
///
/// The hook cannot create accounts, so a wallet needs this before its first buy.
///
/// Preconditions: a sale exists for this mint. Safe to call again: a record that is
/// already there keeps its approval and its running total.
///
/// Rejects: `WrongLayoutVersion` when the rules account was written by another
/// layout of the program. A mint with no sale fails on the missing rules account.
///
/// Emits `BuyerRecordOpened`.
pub fn handle_open_buyer_record(ctx: Context<OpenBuyerRecord>) -> Result<()> {
    require!(
        ctx.accounts.rules.layout_is_current(),
        PanguError::WrongLayoutVersion
    );

    let record = &mut ctx.accounts.record;
    record.mint = ctx.accounts.mint.key();
    record.wallet = ctx.accounts.wallet.key();
    record.bump = ctx.bumps.record;

    emit!(BuyerRecordOpened {
        mint: record.mint,
        wallet: record.wallet,
    });

    Ok(())
}
