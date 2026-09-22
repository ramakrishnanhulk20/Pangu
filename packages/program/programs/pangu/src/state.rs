use anchor_lang::prelude::*;

/// Anyone may buy, the per-wallet cap is the only rule.
pub const ACCESS_OPEN: u8 = 0;
/// Only wallets the issuer approved may buy.
pub const ACCESS_ISSUER_LIST: u8 = 1;
/// Only wallets a named verifier has attested may buy.
pub const ACCESS_VERIFIER_CREDENTIAL: u8 = 2;

/// The layout this build writes and reads. A SaleRules account carrying any
/// other number was written by a different build, where the fields behind this
/// byte may sit somewhere else entirely.
pub const SALE_RULES_LAYOUT_VERSION: u8 = 1;

pub const SALE_SEED: &[u8] = b"sale";
pub const BUYER_SEED: &[u8] = b"buyer";

/// Fixed by the SPL transfer-hook interface, not by us.
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

/// The price band settings, passed to `create_sale` as one value.
///
/// They travel together because they are only meaningful together: the price
/// account's address is derived from the shard id and the feed id, so changing
/// either one changes which account the hook must read.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PriceBand {
    /// How far above the live stock price a buy may leave the curve price, in
    /// basis points. Zero switches the whole band off.
    pub band_bps: u16,
    /// The Pyth price feed account. Must be the address the shard id and the feed
    /// id below produce under Pyth's price feed program.
    pub price_account: Pubkey,
    /// The Pyth feed carrying the stock price in dollars.
    pub price_feed_id: [u8; 32],
    /// Which of Pyth's shards this sale reads. A shard is just a second copy of
    /// the same feed at a second address, so a sale can depend on a price its own
    /// refresher keeps fresh rather than on Pyth's sponsored one.
    pub price_shard: u16,
    /// How old the published price may be on a buy, in seconds.
    pub max_price_age_secs: u32,
    /// The widest confidence interval this sale will buy against, in basis points
    /// of the price itself.
    pub max_conf_bps: u16,
}

impl PriceBand {
    /// True when every field is zero, which is what a sale without a band stores.
    pub fn is_empty(&self) -> bool {
        *self == PriceBand::default()
    }
}

/// The rules of one sale. Written once at creation and never changed: there is no
/// update instruction, which is what makes the cap a promise instead of a setting.
#[account]
#[derive(InitSpace)]
pub struct SaleRules {
    pub mint: Pubkey,
    pub pool: Pubkey,
    /// The pool's base token vault, read out of the pool account at creation. The
    /// hook tells a buy from a sell by comparing against this one address.
    pub base_vault: Pubkey,
    /// The pool creator. The only key that can approve or revoke buyers.
    pub issuer: Pubkey,
    /// Most tokens one wallet may hold net of sells, in raw units.
    pub cap: u64,
    pub access_mode: u8,
    /// Mode 2 only: the attestation credential whose approvals count. Zero
    /// otherwise. Sits at byte 145 of the account, and the hook's extra accounts
    /// are derived by reading it there, so it can never move.
    pub credential: Pubkey,
    /// Mode 2 only: the attestation schema that counts. Zero otherwise. Sits at
    /// byte 177 of the account, read the same way.
    pub schema: Pubkey,
    /// Band only: the Pyth price feed account, at byte 209. Zero otherwise.
    pub price_account: Pubkey,
    /// Band only: the Pyth feed the price account must carry, at byte 241.
    pub price_feed_id: [u8; 32],
    /// Band only: the Pyth shard the price account was derived under.
    pub price_shard: u16,
    /// Zero means no band.
    pub band_bps: u16,
    pub max_price_age_secs: u32,
    pub max_conf_bps: u16,
    /// Read off the two mints at creation, so the curve price can be turned into
    /// dollars per whole token without trusting anything passed at buy time.
    pub base_decimals: u8,
    pub quote_decimals: u8,
    /// Wallets whose record is above zero right now.
    pub buyers: u32,
    /// Sum of every record, so the app can show the largest holder's share.
    pub total_net_bought: u64,
    pub bump: u8,
    /// Which layout wrote this account, at byte 298. It takes the first of what
    /// used to be the spare bytes, so the account is the same size and every
    /// field in front of it sits exactly where it always did. A sale opened
    /// before this byte existed reads as version 0, which is how a reader tells
    /// the two apart instead of reading one layout's bytes as the other's.
    pub layout_version: u8,
    pub reserved: [u8; 63],
}

impl SaleRules {
    pub fn has_band(&self) -> bool {
        self.band_bps > 0
    }

    /// True when this account was written by the layout this build reads. One
    /// predicate rather than a comparison repeated in each instruction, so a
    /// second version can never be added to some readers and missed by others.
    pub fn layout_is_current(&self) -> bool {
        self.layout_version == SALE_RULES_LAYOUT_VERSION
    }
}

/// One wallet's standing in one sale. Keyed on the wallet that owns the token
/// account, never on the token account, so extra token accounts share one cap.
#[account]
#[derive(InitSpace)]
pub struct BuyerRecord {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub approved: bool,
    /// Tokens received from the pool minus tokens sold back to it.
    pub net_bought: u64,
    pub bump: u8,
}
