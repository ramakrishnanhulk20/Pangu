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

    /// CHECK: this mint's rules, by address. Read only to learn whether the
    /// offering period is over, and only when the bytes are a SaleRules in a
    /// layout this build reads. Anything else, including rules written by an
    /// older build, reads as "not over" and leaves the two older ways in exactly
    /// as they were, so this account can never stop a close that worked before.
    #[account(seeds = [SALE_SEED, mint.key().as_ref()], bump)]
    pub rules: UncheckedAccount<'info>,
}

/// Closes the caller's own record, returning its rent.
///
/// Three ways in. The sale has graduated, the offering period has ended, or the
/// record has nothing in it. Graduation is read off the token itself: DBC clears
/// the mint's transfer-hook program inside the trade that completes the curve,
/// and nobody can ever set it again. The end of the offering is read off the
/// rules, and from then on the hook no longer counts anything, so a record still
/// holding a count is holding nothing that matters.
///
/// A record at zero holds no count anybody can lose, so it can go mid-sale: a wallet
/// that never bought, or that sold everything back, gets its rent without waiting
/// for graduation. Reopening it is a fresh record at zero and unapproved, which is
/// strictly worse for the wallet than keeping the old one, so there is nothing to
/// win by closing and reopening.
///
/// Preconditions: the caller owns the record, and the mint no longer names any
/// transfer-hook program, or the offering period in the rules has ended, or the
/// record's net bought is zero.
///
/// Rejects: `WrongMint` when the mint is not Token-2022 or is not the record's mint,
/// `WrongBuyerRecord` when the record belongs to someone else, `SaleStillRunning`
/// when the mint still names a hook program, the offering has not ended, and the
/// record still counts tokens.
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
    let offering_over = || {
        read_rules(&ctx.accounts.rules)
            .zip(Clock::get().ok())
            .is_some_and(|(rules, clock)| rules.offering_is_over(clock.unix_timestamp))
    };
    require!(
        hook_program.is_none() || ctx.accounts.record.net_bought == 0 || offering_over(),
        PanguError::SaleStillRunning
    );

    emit!(BuyerRecordClosed {
        mint: ctx.accounts.mint.key(),
        wallet: ctx.accounts.wallet.key(),
    });

    Ok(())
}

/// The rules, when they are this program's and a SaleRules at all. Returns None
/// for anything else rather than failing, because the caller only asks whether
/// the offering is over and "cannot tell" has to mean "no".
fn read_rules(info: &UncheckedAccount) -> Option<SaleRules> {
    if *info.owner != crate::ID {
        return None;
    }
    let data = info.try_borrow_data().ok()?;
    SaleRules::try_deserialize(&mut &data[..]).ok()
}
