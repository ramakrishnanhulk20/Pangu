pub mod dbc;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod price;
pub mod sas;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("4Nd46mDiaTSkqXPAXKqT4jkahcz1TxVSdoirbBCAr5qG");

/// Pangu holds the rules of a stock token's first sale on Meteora's Dynamic Bonding
/// Curve: a cap per wallet, an optional issuer-approved buyer list, an optional
/// ceiling against the real stock's live price, and no wallet-to-wallet movement
/// until the sale is over. DBC finds the price, Pangu decides who may receive
/// tokens and how many.
#[program]
pub mod pangu {
    use super::*;

    pub fn create_sale(
        ctx: Context<CreateSale>,
        cap: u64,
        access_mode: u8,
        credential: Pubkey,
        schema: Pubkey,
        band: PriceBand,
    ) -> Result<()> {
        instructions::create_sale::handle_create_sale(
            ctx,
            cap,
            access_mode,
            credential,
            schema,
            band,
        )
    }

    pub fn open_buyer_record(ctx: Context<OpenBuyerRecord>) -> Result<()> {
        instructions::open_buyer_record::handle_open_buyer_record(ctx)
    }

    pub fn approve_buyer(ctx: Context<ApproveBuyer>, wallet: Pubkey) -> Result<()> {
        instructions::approve_buyer::handle_approve_buyer(ctx, wallet)
    }

    pub fn revoke_buyer(ctx: Context<RevokeBuyer>, wallet: Pubkey) -> Result<()> {
        instructions::revoke_buyer::handle_revoke_buyer(ctx, wallet)
    }

    pub fn close_buyer_record(ctx: Context<CloseBuyerRecord>) -> Result<()> {
        instructions::close_buyer_record::handle_close_buyer_record(ctx)
    }

    #[instruction(discriminator = crate::instructions::execute::EXECUTE_DISCRIMINATOR)]
    pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
        instructions::execute::handle_execute(ctx, amount)
    }
}
