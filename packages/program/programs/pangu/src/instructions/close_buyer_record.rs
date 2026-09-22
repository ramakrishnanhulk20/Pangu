use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{transfer_hook::TransferHook, BaseStateWithExtensions, StateWithExtensions},
    state::Mint as MintState,
};

use crate::{errors::PanguError, events::BuyerRecordClosed, state::*};

#[derive(Accounts)]
pub struct CloseBuyerRecord<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,

    /// CHECK: unpacked as a Token-2022 mint below, after its owning program is checked.
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        close = wallet,
        seeds = [BUYER_SEED, mint.key().as_ref(), wallet.key().as_ref()],
        bump = record.bump,
        has_one = mint @ PanguError::WrongMint,
        has_one = wallet @ PanguError::WrongBuyerRecord
    )]
    pub record: Account<'info, BuyerRecord>,
}

/// Closes the caller's own record, returning its rent.
///
/// Two ways in. Either the sale is over, or the record has nothing in it. "Over" is
/// read off the token itself: DBC clears the mint's transfer-hook program inside the
/// trade that completes the curve, and nobody can ever set it again. So a mint that
/// still names a hook program is still selling.
///
/// A record at zero holds no count anybody can lose, so it can go mid-sale: a wallet
/// that never bought, or that sold everything back, gets its rent without waiting
/// for graduation. Reopening it is a fresh record at zero and unapproved, which is
/// strictly worse for the wallet than keeping the old one, so there is nothing to
/// win by closing and reopening.
///
/// Preconditions: the caller owns the record, and either the mint no longer names
/// any transfer-hook program or the record's net bought is zero.
///
/// Rejects: `WrongMint` when the mint is not Token-2022 or is not the record's mint,
/// `WrongBuyerRecord` when the record belongs to someone else, `SaleStillRunning`
/// when the mint still names a hook program and the record still counts tokens.
///
/// Emits `BuyerRecordClosed`.
pub fn handle_close_buyer_record(ctx: Context<CloseBuyerRecord>) -> Result<()> {
    require_keys_eq!(
        *ctx.accounts.mint.owner,
        anchor_spl::token_2022::ID,
        PanguError::WrongMint
    );

    let mint_data = ctx.accounts.mint.try_borrow_data()?;
    let mint_state =
        StateWithExtensions::<MintState>::unpack(&mint_data).map_err(|_| error!(PanguError::WrongMint))?;
    // A mint with no transfer-hook extension at all can never call this program, so
    // there is nothing left to run and the record is free to go.
    let hook_program: Option<Pubkey> = match mint_state.get_extension::<TransferHook>() {
        Ok(hook) => hook.program_id.into(),
        Err(_) => None,
    };
    require!(
        hook_program.is_none() || ctx.accounts.record.net_bought == 0,
        PanguError::SaleStillRunning
    );

    emit!(BuyerRecordClosed {
        mint: ctx.accounts.mint.key(),
        wallet: ctx.accounts.wallet.key(),
    });

    Ok(())
}
