use anchor_lang::prelude::*;

/// Anyone may buy, the per-wallet cap is the only rule.
pub const ACCESS_OPEN: u8 = 0;
/// Only wallets the issuer approved may buy.
pub const ACCESS_ISSUER_LIST: u8 = 1;
/// Only wallets a named verifier has attested may buy.
pub const ACCESS_VERIFIER_CREDENTIAL: u8 = 2;

/// The layout this build writes. Version 2 added `quote_mint` and `ends_at` in
/// what used to be spare bytes, so a version 1 account is the same length with
/// every older field in the same place, and zeros where the two new ones would
/// be. A zero `ends_at` means no end, so a version 1 sale keeps its rules until
/// graduation exactly as it did before.
pub const SALE_RULES_LAYOUT_VERSION: u8 = 2;

/// The oldest layout this build still reads. Anything below it, or above the
/// version this build writes, may keep its fields somewhere else entirely.
pub const SALE_RULES_OLDEST_READABLE_VERSION: u8 = 1;

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
    /// The token buyers pay in, read from the launch template at creation, at
    /// byte 299. Layout 2 onwards; a version 1 account holds zeros here.
    pub quote_mint: Pubkey,
    /// Unix seconds at which the offering period ends, at byte 331. From then on
    /// every rule lifts and the token moves freely, so a curve that never fills
    /// cannot hold the token in place for good. Zero means no end: the rules hold
    /// until graduation. Fixed at creation like every other rule.
    pub ends_at: i64,
    pub reserved: [u8; 23],
}

impl SaleRules {
    pub fn has_band(&self) -> bool {
        self.band_bps > 0
    }

    /// True once the offering period is over. Only a layout this build reads can
    /// answer: in any other the bytes behind `ends_at` may be some other field,
    /// and reading them as a time could lift the rules on a guess.
    pub fn offering_is_over(&self, now: i64) -> bool {
        self.is_readable() && self.ends_at != 0 && now >= self.ends_at
    }

    /// True when this account was written by a layout this build reads: 1 or 2.
    /// One predicate rather than a comparison repeated in each instruction, so a
    /// new version can never be added to some readers and missed by others.
    /// Every field a buy, a sell or an approval reads sits at the same offset in
    /// both, and nothing on those paths reads `quote_mint`.
    pub fn is_readable(&self) -> bool {
        (SALE_RULES_OLDEST_READABLE_VERSION..=SALE_RULES_LAYOUT_VERSION)
            .contains(&self.layout_version)
    }

    /// The name the admin instructions call. Kept so they read exactly the
    /// versions `is_readable` does, rather than a second rule of their own.
    pub fn layout_is_current(&self) -> bool {
        self.is_readable()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn marked_rules() -> SaleRules {
        SaleRules {
            mint: Pubkey::new_from_array([1; 32]),
            pool: Pubkey::new_from_array([2; 32]),
            base_vault: Pubkey::new_from_array([3; 32]),
            issuer: Pubkey::new_from_array([4; 32]),
            cap: 5,
            access_mode: ACCESS_OPEN,
            credential: Pubkey::new_from_array([6; 32]),
            schema: Pubkey::new_from_array([7; 32]),
            price_account: Pubkey::new_from_array([8; 32]),
            price_feed_id: [9; 32],
            price_shard: 10,
            band_bps: 11,
            max_price_age_secs: 12,
            max_conf_bps: 13,
            base_decimals: 14,
            quote_decimals: 15,
            buyers: 16,
            total_net_bought: 17,
            bump: 18,
            layout_version: 0xAB,
            quote_mint: Pubkey::new_from_array([0xCD; 32]),
            ends_at: 0x0102_0304_0506_0708,
            reserved: [0; 23],
        }
    }

    /// The bytes are what the chain holds, so the offsets are read off a real
    /// serialisation rather than worked out by hand.
    #[test]
    fn the_account_stays_362_bytes_with_the_new_fields_where_readers_expect() {
        let mut bytes = Vec::new();
        marked_rules().try_serialize(&mut bytes).unwrap();

        assert_eq!(bytes.len(), 362);
        assert_eq!(8 + SaleRules::INIT_SPACE, 362);
        assert_eq!(bytes[145..177], [6; 32], "credential moved");
        assert_eq!(bytes[177..209], [7; 32], "schema moved");
        assert_eq!(bytes[298], 0xAB, "layout_version is not at byte 298");
        assert_eq!(bytes[299..331], [0xCD; 32], "quote_mint is not at byte 299");
        assert_eq!(
            bytes[331..339],
            0x0102_0304_0506_0708i64.to_le_bytes(),
            "ends_at is not at byte 331"
        );
        assert_eq!(bytes[339..362], [0; 23]);
    }

    #[test]
    fn versions_one_and_two_are_readable_and_nothing_else_is() {
        let mut rules = marked_rules();
        for (version, readable) in [(0u8, false), (1, true), (2, true), (3, false), (255, false)] {
            rules.layout_version = version;
            assert_eq!(rules.is_readable(), readable, "version {version}");
            assert_eq!(rules.layout_is_current(), readable, "version {version}");
        }
    }

    #[test]
    fn the_offering_is_over_only_from_a_real_end_time_on_a_readable_layout() {
        let mut rules = marked_rules();
        rules.layout_version = SALE_RULES_LAYOUT_VERSION;
        rules.ends_at = 1_000;
        assert!(!rules.offering_is_over(999));
        assert!(rules.offering_is_over(1_000));
        assert!(rules.offering_is_over(5_000));

        rules.ends_at = 0;
        assert!(!rules.offering_is_over(i64::MAX), "zero must mean no end");

        rules.ends_at = 1_000;
        rules.layout_version = 0;
        assert!(!rules.offering_is_over(5_000), "an unreadable layout lifted the rules");
    }
}
