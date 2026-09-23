use anchor_lang::prelude::*;

#[event]
pub struct SaleCreated {
    pub mint: Pubkey,
    pub pool: Pubkey,
    pub issuer: Pubkey,
    pub base_vault: Pubkey,
    pub cap: u64,
    pub access_mode: u8,
    pub band_bps: u16,
    pub quote_mint: Pubkey,
    /// Unix seconds when the offering period ends and every rule lifts. Zero
    /// means the rules hold until graduation.
    pub ends_at: i64,
}

#[event]
pub struct BuyerRecordOpened {
    pub mint: Pubkey,
    pub wallet: Pubkey,
}

#[event]
pub struct BuyerApproved {
    pub mint: Pubkey,
    pub wallet: Pubkey,
}

#[event]
pub struct BuyerRevoked {
    pub mint: Pubkey,
    pub wallet: Pubkey,
}

#[event]
pub struct BuyerRecordClosed {
    pub mint: Pubkey,
    pub wallet: Pubkey,
}

#[event]
pub struct Bought {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
    pub net_bought: u64,
}

#[event]
pub struct SoldBack {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
    pub net_bought: u64,
}
