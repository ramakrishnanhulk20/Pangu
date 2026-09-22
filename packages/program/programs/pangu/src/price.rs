//! The price band: reading a Pyth price feed account and comparing the curve
//! price against the live stock price.
//!
//! The account is parsed by Pyth's own `pyth-solana-receiver-sdk` 2.0.0, not by
//! hand. That crate does compile next to anchor-lang 1.2.0, unlike the oracle
//! crate this replaces, so the byte offsets, the account discriminator and both
//! program ids come from Pyth rather than from a table typed out here. The build
//! attempt and the account bytes that confirm it are in
//! docs/measurements/price-band-pyth.md.
//!
//! What the crate checks: the account discriminator, that the feed id inside the
//! update is the sale's feed, that two thirds of the Wormhole guardians signed
//! it, and that it is not older than the sale allows. What it leaves to the
//! caller, and what this file adds: a price published in the future, a price that
//! is not above zero, a confidence interval too wide to mean anything, and the
//! band itself.

use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::error::GetPriceError;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, VerificationLevel};
use ruint::aliases::U256;

use crate::errors::PanguError;

/// Pyth's price feed program. Every price feed account is a program address of
/// this program over a shard id and a feed id, so a sale can name the address
/// before anyone has ever refreshed it and nobody can create a rival account for
/// the same shard and feed. Re-exported from the SDK, never typed out here.
pub use pyth_solana_receiver_sdk::PYTH_PUSH_ORACLE_ID as PRICE_FEED_PROGRAM_ID;

/// Pyth's receiver program, which owns every price feed account. It writes one
/// only after checking Wormhole guardian signatures over the update, which is
/// what makes the bytes worth reading at all. Same address on mainnet and devnet,
/// so there is one Pangu binary for both networks.
pub use pyth_solana_receiver_sdk::ID as RECEIVER_PROGRAM_ID;

/// The shard Pangu's own refresher writes.
///
/// A shard is a second copy of the same feed at a second address. Shard 0 is the
/// one Pyth sponsors, and its equity accounts have gone weeks without an update,
/// so Pangu points its sales at a shard it feeds itself. A sale may name any
/// shard, because the rules carry it and the address is derived from it: a sale
/// that named shard 0 would simply find the price stale and refuse every buy.
pub const PANGU_SHARD_ID: u16 = 7_700;

/// Pangu compares every price on one scale, a dollar being 1e18.
pub const PRICE_SCALE_DECIMALS: u32 = 18;

/// A price published further ahead than this is a broken publisher, not a fast
/// one. Some slack is needed because Pyth's publishers and Solana's clock are not
/// the same clock.
pub const PUBLISH_FUTURE_TOLERANCE_SECS: i64 = 60;

/// The oldest a price may be allowed to get, in seconds. An hour. Past that the
/// number is a memory of a market rather than a price.
pub const MAX_PRICE_AGE_SECS: u32 = 3_600;

/// The widest confidence interval a sale may accept, in basis points of the price
/// itself. Ten percent. Wider than that is Pyth saying its publishers do not
/// agree, and a ceiling measured against a number nobody agrees on is not a
/// ceiling.
pub const MAX_CONF_BPS: u16 = 1_000;

/// The widest band a sale may set: 50 percent above the live stock price.
pub const MAX_BAND_BPS: u16 = 5_000;

/// Both mints' decimals are bounded so the fixed point maths below cannot overflow
/// a 256 bit intermediate. Solana mints in practice sit at 6, 8 or 9.
pub const MAX_DECIMALS: u8 = 18;

/// Pyth publishes US equities with exponent -5 and its tokenised ones with -8. A
/// positive exponent would mean a price quantised coarser than a dollar, and
/// anything below -18 cannot be carried on the 1e18 scale without losing the
/// number. Either one is an account this band cannot read.
const MIN_EXPONENT: i32 = -18;
const MAX_EXPONENT: i32 = 0;

/// The one address a price for this shard and this feed can live at.
///
/// Seeds are the shard id as two little endian bytes and then the 32 byte feed
/// id, under Pyth's price feed program. Copied from
/// `getPriceFeedAccountForProgram` in `@pythnetwork/pyth-solana-receiver` and
/// checked against Pyth's real shard 0 AAPL account on mainnet.
pub fn price_feed_address(shard_id: u16, feed_id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(
        &[&shard_id.to_le_bytes(), feed_id.as_slice()],
        &PRICE_FEED_PROGRAM_ID,
    )
    .0
}

/// The live stock price this sale's band is measured against, in dollars scaled
/// by 1e18.
///
/// Everything a price feed account can be wrong about is judged here, in this
/// order: the bytes are a `PriceUpdateV2` at all, two thirds of the guardians
/// signed it, the feed id inside it is this sale's feed, it is not older than the
/// sale allows, it was not published in the future, the price is above zero, and
/// Pyth's own confidence interval is narrow enough to mean something. Only then
/// is the number turned into dollars.
///
/// The first four come out of Pyth's SDK rather than out of byte offsets written
/// here. The caller has already proved the account sits at the derived address
/// and is owned by the receiver program; this function judges only its contents.
///
/// Rejects `WrongPriceAccount` when the bytes are not a price update for this
/// feed or carry an exponent no dollar price can use, `PriceNotFullyVerified`
/// when fewer than two thirds of the guardians signed, `PriceStale` when the
/// price is too old, from the future, or not above zero, and `PriceTooUncertain`
/// when the confidence interval is wider than the sale accepts.
pub fn read_banded_price(
    data: &[u8],
    feed_id: &[u8; 32],
    now: i64,
    max_price_age_secs: u32,
    max_conf_bps: u16,
) -> Result<U256> {
    let update = PriceUpdateV2::try_deserialize(&mut &data[..])
        .map_err(|_| error!(PanguError::WrongPriceAccount))?;

    let clock = Clock {
        unix_timestamp: now,
        ..Clock::default()
    };
    let price = update
        .get_price_no_older_than_with_custom_verification_level(
            &clock,
            max_price_age_secs as u64,
            feed_id,
            VerificationLevel::Full,
        )
        .map_err(|why| match why {
            GetPriceError::InsufficientVerificationLevel => {
                error!(PanguError::PriceNotFullyVerified)
            }
            GetPriceError::PriceTooOld => error!(PanguError::PriceStale),
            _ => error!(PanguError::WrongPriceAccount),
        })?;

    require_not_future(price.publish_time, now)?;
    require_confidence(price.price, price.conf, max_conf_bps)?;
    stock_price_1e18(price.price, price.exponent)
}

/// A price may be old, within the sale's limit, but it may never be newer than
/// now.
///
/// Pyth stops publishing an equity outside its trading sessions, so the account
/// simply stops moving and ages out of the sale's limit. That is the whole market
/// clock: the account carries no session flag, a shut market and a broken
/// publisher look identical from here, and the band treats both the same way. No
/// fresh price, no buy. Sells read none of this.
pub fn require_not_future(publish_time: i64, now: i64) -> Result<()> {
    require!(
        publish_time <= now.saturating_add(PUBLISH_FUTURE_TOLERANCE_SECS),
        PanguError::PriceStale
    );
    Ok(())
}

/// Pyth's confidence interval must be narrow enough that the price means
/// something.
///
/// Pyth publishes a price and the width of the publishers' disagreement around
/// it. The ratio is taken in basis points of the price and rounded up, so half a
/// basis point of doubt counts as one and never as none.
pub fn require_confidence(price: i64, conf: u64, max_conf_bps: u16) -> Result<()> {
    require!(price > 0, PanguError::PriceStale);
    let price = price as u128;
    let widened = (conf as u128)
        .checked_mul(10_000)
        .ok_or(PanguError::MathOverflow)?;
    let bps = widened
        .checked_add(price - 1)
        .ok_or(PanguError::MathOverflow)?
        / price;
    require!(bps <= max_conf_bps as u128, PanguError::PriceTooUncertain);
    Ok(())
}

/// The live stock price in dollars, scaled by 1e18.
///
/// Pyth publishes a whole number and an exponent: the real price is `price` times
/// ten to the `exponent`, and the exponent is negative for every feed a sale can
/// use (-5 for US equities, -8 for the tokenised ones). This moves it onto the
/// one scale the band compares on.
pub fn stock_price_1e18(price: i64, exponent: i32) -> Result<U256> {
    require!(price > 0, PanguError::PriceStale);
    require!(
        (MIN_EXPONENT..=MAX_EXPONENT).contains(&exponent),
        PanguError::WrongPriceAccount
    );

    let shift = PRICE_SCALE_DECIMALS as i32 + exponent;
    let value = U256::from(price as u128);
    if shift >= 0 {
        value
            .checked_mul(pow10(shift as u32)?)
            .ok_or_else(|| error!(PanguError::MathOverflow))
    } else {
        Ok(value / pow10((-shift) as u32)?)
    }
}

/// The curve price after this buy, in dollars per whole token, scaled by 1e18 and
/// rounded UP.
///
/// `sqrt_price` is DBC's Q64.64 square root of quote raw units per base raw unit,
/// so the price itself is `(sqrt_price / 2^64)^2` and the dollar price is that
/// times `10^(base_decimals - quote_decimals)`.
///
/// The arithmetic is exact. The square of a `u128` needs 256 bits, and the division
/// by `2^128` is done as a split into the high and low halves so that no
/// intermediate is ever truncated. Rounding goes up, always, so a fraction of a
/// unit can never be the reason a buy is allowed.
pub fn curve_price_ceil_1e18(
    sqrt_price: u128,
    base_decimals: u8,
    quote_decimals: u8,
) -> Result<U256> {
    require!(
        base_decimals <= MAX_DECIMALS && quote_decimals <= MAX_DECIMALS,
        PanguError::InvalidBand
    );

    let root = U256::from(sqrt_price);
    let squared = root.checked_mul(root).ok_or(PanguError::MathOverflow)?;
    let mask = U256::from(u128::MAX);
    let high = squared >> 128usize;
    let low = squared & mask;

    // 1e18 to match the band's own scale, then the base mint's decimals to turn a
    // raw unit into a whole token.
    let scale = pow10(PRICE_SCALE_DECIMALS + base_decimals as u32)?;
    let from_high = high.checked_mul(scale).ok_or(PanguError::MathOverflow)?;
    let from_low = low.checked_mul(scale).ok_or(PanguError::MathOverflow)?;
    let carried = from_low >> 128usize;
    let dropped = from_low & mask;
    let total = from_high
        .checked_add(carried)
        .ok_or(PanguError::MathOverflow)?;

    let divisor = pow10(quote_decimals as u32)?;
    let whole = total / divisor;
    let remainder = total % divisor;
    if remainder.is_zero() && dropped.is_zero() {
        Ok(whole)
    } else {
        whole
            .checked_add(U256::from(1u8))
            .ok_or_else(|| error!(PanguError::MathOverflow))
    }
}

/// The highest curve price this sale allows, scaled by 1e18 and rounded DOWN.
///
/// Rounding down here and up on the curve side means a buy that lands on the exact
/// ceiling still passes, and nothing in between slips through.
pub fn band_ceiling_floor_1e18(stock_price_1e18: U256, band_bps: u16) -> Result<U256> {
    require!(!stock_price_1e18.is_zero(), PanguError::PriceStale);
    let widened = stock_price_1e18
        .checked_mul(U256::from(10_000u32 + band_bps as u32))
        .ok_or(PanguError::MathOverflow)?;
    Ok(widened / U256::from(10_000u32))
}

/// Ten to the power of `exponent`, as a 256 bit number.
///
/// The exponent is bounded by `MAX_DECIMALS` and by the exponent range above, so
/// this loop runs at most 36 times and never on a number a caller chose.
fn pow10(exponent: u32) -> Result<U256> {
    let mut value = U256::from(1u8);
    let ten = U256::from(10u8);
    for _ in 0..exponent {
        value = value.checked_mul(ten).ok_or(PanguError::MathOverflow)?;
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pyth_solana_receiver_sdk::price_update::PriceFeedMessage;

    const ONE_DOLLAR: u128 = 1_000_000_000_000_000_000;
    /// A chosen "now" well clear of the epoch, so ageing arithmetic is readable.
    const NOW: i64 = 1_789_761_602;

    /// The real bytes of the devnet price feed account this project refreshes,
    /// saved by `feeds/refresh.ts --dump`. Pyth's receiver program wrote them
    /// after checking the Wormhole guardians' signatures, not this test.
    const LIVE_DEVNET_PRICE: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../feeds/live-price.bin"
    ));

    /// Equity.US.AAPL/USD, from Pyth's own feed id list.
    const LIVE_PRICE_FEED: &str =
        "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
    /// Pyth's own shard 0 AAPL account on mainnet, the one the layout was read off.
    const MAINNET_SHARD_0_AAPL: &str = "DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy";

    fn hex32(text: &str) -> [u8; 32] {
        let bytes = text.as_bytes();
        let mut out = [0u8; 32];
        for (index, slot) in out.iter_mut().enumerate() {
            let hi = (bytes[index * 2] as char).to_digit(16).unwrap() as u8;
            let lo = (bytes[index * 2 + 1] as char).to_digit(16).unwrap() as u8;
            *slot = (hi << 4) | lo;
        }
        out
    }

    /// A price feed account in the layout Pyth's receiver program writes, built
    /// through the SDK's own type so a test can never drift from the real one.
    fn encode_update(
        feed_id: [u8; 32],
        price: i64,
        conf: u64,
        exponent: i32,
        publish_time: i64,
        verification_level: VerificationLevel,
    ) -> Vec<u8> {
        let update = PriceUpdateV2 {
            write_authority: Pubkey::default(),
            verification_level,
            price_message: PriceFeedMessage {
                feed_id,
                price,
                conf,
                exponent,
                publish_time,
                prev_publish_time: publish_time,
                ema_price: price,
                ema_conf: conf,
            },
            posted_slot: 1,
        };
        let mut data = Vec::new();
        update.try_serialize(&mut data).unwrap();
        data
    }

    fn aapl_update(price: i64, conf: u64, publish_time: i64) -> Vec<u8> {
        encode_update(
            hex32(LIVE_PRICE_FEED),
            price,
            conf,
            -5,
            publish_time,
            VerificationLevel::Full,
        )
    }

    #[test]
    fn the_derived_address_is_pyths_own_shard_zero_account() {
        // Pyth keeps this exact account on mainnet, so the seeds are the real ones
        // and not a reading of their documentation.
        assert_eq!(
            price_feed_address(0, &hex32(LIVE_PRICE_FEED)),
            Pubkey::from_str_const(MAINNET_SHARD_0_AAPL)
        );
        // Pangu's own shard is a different account for the same feed.
        assert_ne!(
            price_feed_address(PANGU_SHARD_ID, &hex32(LIVE_PRICE_FEED)),
            Pubkey::from_str_const(MAINNET_SHARD_0_AAPL)
        );
    }

    /// The one test here that is not a thought experiment: a price Pyth's own
    /// receiver program really wrote on devnet, read by the same code the hook
    /// runs, at the address the sale's rules would name.
    #[test]
    fn the_live_devnet_price_reads_through_this_code() {
        let feed = hex32(LIVE_PRICE_FEED);
        let update = PriceUpdateV2::try_deserialize(&mut &LIVE_DEVNET_PRICE[..]).unwrap();
        assert_eq!(update.price_message.feed_id, feed);
        assert_eq!(update.verification_level, VerificationLevel::Full);
        assert_eq!(LIVE_DEVNET_PRICE.len(), 134);

        // The account really does sit at the one address Pangu's shard and this
        // feed can produce.
        assert_eq!(
            price_feed_address(PANGU_SHARD_ID, &feed),
            Pubkey::from_str_const("9wtpaS1kCEqXC9XGDJ14kKVuBNDkMwaDZG3vXe2KPQWb")
        );

        // A three figure stock, not a three trillion figure one.
        let published = update.price_message.publish_time;
        let dollars =
            read_banded_price(LIVE_DEVNET_PRICE, &feed, published, 60, MAX_CONF_BPS).unwrap();
        assert!(dollars > U256::from(100u128 * ONE_DOLLAR));
        assert!(dollars < U256::from(10_000u128 * ONE_DOLLAR));

        // It was fresh when it was written and it ages out on its own, which is
        // the whole of the market clock.
        read_banded_price(LIVE_DEVNET_PRICE, &feed, published + 60, 60, MAX_CONF_BPS).unwrap();
        read_banded_price(LIVE_DEVNET_PRICE, &feed, published + 61, 60, MAX_CONF_BPS)
            .unwrap_err();

        // And the band maths runs on the number it carries.
        let ceiling = band_ceiling_floor_1e18(dollars, 1_000).unwrap();
        assert!(ceiling > dollars);
    }

    #[test]
    fn the_live_devnet_price_is_refused_for_another_feed_or_a_changed_byte() {
        let feed = hex32(LIVE_PRICE_FEED);
        let published = PriceUpdateV2::try_deserialize(&mut &LIVE_DEVNET_PRICE[..])
            .unwrap()
            .price_message
            .publish_time;

        let mut stranger = feed;
        stranger[0] ^= 0xff;
        read_banded_price(LIVE_DEVNET_PRICE, &stranger, published, 60, MAX_CONF_BPS)
            .unwrap_err();

        // The discriminator is the first thing checked, so a single flipped byte
        // there stops the parse before any field is read.
        let mut tampered = LIVE_DEVNET_PRICE.to_vec();
        tampered[0] ^= 0x01;
        read_banded_price(&tampered, &feed, published, 60, MAX_CONF_BPS).unwrap_err();

        // Downgrading the real update to partly verified is refused too, even
        // though every other byte came off the chain.
        let mut downgraded = LIVE_DEVNET_PRICE.to_vec();
        downgraded[40] = 0;
        read_banded_price(&downgraded, &feed, published, 60, MAX_CONF_BPS).unwrap_err();
    }

    #[test]
    fn a_price_for_another_feed_at_the_expected_address_is_refused() {
        // A real, fully verified update for a different stock, put where this
        // sale's price should be. The feed id inside it is the only thing that
        // tells the two apart.
        let data = aapl_update(30_592_000, 2_000, NOW);
        let mut stranger = hex32(LIVE_PRICE_FEED);
        stranger[0] ^= 0xff;
        read_banded_price(&data, &stranger, NOW, 60, MAX_CONF_BPS).unwrap_err();
        read_banded_price(&data, &hex32(LIVE_PRICE_FEED), NOW, 60, MAX_CONF_BPS).unwrap();
    }

    #[test]
    fn a_price_account_cut_short_is_refused_without_crashing() {
        let data = aapl_update(30_592_000, 2_000, NOW);
        let feed = hex32(LIVE_PRICE_FEED);
        for length in [0usize, 7, 8, 40, 41, 72, data.len() - 1] {
            read_banded_price(&data[..length], &feed, NOW, 60, MAX_CONF_BPS).unwrap_err();
        }
        read_banded_price(&data, &feed, NOW, 60, MAX_CONF_BPS).unwrap();
    }

    #[test]
    fn bytes_that_are_not_a_price_update_are_refused() {
        let feed = hex32(LIVE_PRICE_FEED);
        let mut data = aapl_update(30_592_000, 2_000, NOW);
        data[0] ^= 0xff;
        read_banded_price(&data, &feed, NOW, 60, MAX_CONF_BPS).unwrap_err();
    }

    #[test]
    fn a_partly_verified_update_is_refused() {
        // Fewer than two thirds of the guardians signed. Pyth's own SDK calls this
        // dangerous, and a ceiling is exactly the thing it would be dangerous for.
        let data = encode_update(
            hex32(LIVE_PRICE_FEED),
            30_592_000,
            2_000,
            -5,
            NOW,
            VerificationLevel::Partial { num_signatures: 5 },
        );
        read_banded_price(&data, &hex32(LIVE_PRICE_FEED), NOW, 60, MAX_CONF_BPS)
            .unwrap_err();
    }

    #[test]
    fn an_old_price_and_a_future_price_are_both_refused() {
        let feed = hex32(LIVE_PRICE_FEED);
        let data = aapl_update(30_592_000, 2_000, NOW);
        read_banded_price(&data, &feed, NOW + 300, 300, MAX_CONF_BPS).unwrap();
        read_banded_price(&data, &feed, NOW + 301, 300, MAX_CONF_BPS).unwrap_err();

        // A minute ahead is tolerated, an hour ahead is not.
        assert!(require_not_future(NOW, NOW - 60).is_ok());
        assert!(require_not_future(NOW, NOW - 61).is_err());
        let ahead = aapl_update(30_592_000, 2_000, NOW + 3_600);
        read_banded_price(&ahead, &feed, NOW, MAX_PRICE_AGE_SECS, MAX_CONF_BPS).unwrap_err();
    }

    #[test]
    fn a_price_of_zero_or_below_is_never_a_price() {
        let feed = hex32(LIVE_PRICE_FEED);
        for price in [0i64, -1, i64::MIN] {
            let data = aapl_update(price, 2_000, NOW);
            read_banded_price(&data, &feed, NOW, 60, MAX_CONF_BPS).unwrap_err();
        }
        assert!(stock_price_1e18(0, -5).is_err());
        assert!(stock_price_1e18(-30_592_000, -5).is_err());
    }

    #[test]
    fn the_confidence_ratio_is_basis_points_of_the_price_rounded_up() {
        // AAPL at 305.92 with a two cent interval is under one basis point, and
        // rounding up makes that one rather than none.
        assert!(require_confidence(30_592_000, 2_000, 1).is_ok());
        assert!(require_confidence(30_592_000, 2_000, 0).is_err());
        // Exactly one percent passes a one percent limit.
        assert!(require_confidence(10_000, 100, 100).is_ok());
        // A hair over does not.
        assert!(require_confidence(10_000, 101, 100).is_err());
        // Ten percent of the price against a one percent limit.
        assert!(require_confidence(30_592_000, 3_059_200, 100).is_err());
        // Zero doubt always passes.
        assert!(require_confidence(30_592_000, 0, 1).is_ok());
    }

    #[test]
    fn a_price_nobody_agrees_on_is_refused_by_the_sale_that_set_the_limit() {
        let feed = hex32(LIVE_PRICE_FEED);
        // A five percent confidence interval: fine for a sale that allows ten,
        // refused by one that allows one.
        let data = aapl_update(30_592_000, 1_529_600, NOW);
        read_banded_price(&data, &feed, NOW, 60, 1_000).unwrap();
        read_banded_price(&data, &feed, NOW, 60, 100).unwrap_err();
    }

    #[test]
    fn an_equity_exponent_of_minus_five_scales_to_the_bands_own_units() {
        // 30592000 at 10^-5 is 305.92 dollars.
        assert_eq!(
            stock_price_1e18(30_592_000, -5).unwrap(),
            U256::from(30_592u128 * ONE_DOLLAR / 100)
        );
    }

    #[test]
    fn a_tokenised_exponent_of_minus_eight_scales_to_the_same_number() {
        // The same 305.92 dollars, published the way Pyth writes AAPLX.
        assert_eq!(
            stock_price_1e18(30_592_000_000, -8).unwrap(),
            stock_price_1e18(30_592_000, -5).unwrap()
        );
    }

    #[test]
    fn an_exponent_no_dollar_price_can_use_is_refused() {
        assert!(stock_price_1e18(1, 1).is_err());
        assert!(stock_price_1e18(1, -19).is_err());
        // The two ends of the range that is allowed.
        assert!(stock_price_1e18(1, 0).is_ok());
        assert!(stock_price_1e18(1, -18).is_ok());
    }

    #[test]
    fn a_price_finer_than_the_bands_own_scale_rounds_down_to_nothing() {
        // At 10^-18 a price of 1 is a millionth of a millionth of a cent, and the
        // band's scale cannot hold it. It reads as zero, and a zero stock price is
        // never a ceiling.
        assert_eq!(stock_price_1e18(1, -18).unwrap(), U256::from(1u8));
        assert!(band_ceiling_floor_1e18(U256::from(0u8), 100).is_err());
    }

    /// The price DBC's own helper reports for a 1:1 raw ratio.
    const SQRT_ONE: u128 = 1u128 << 64;

    #[test]
    fn a_one_to_one_curve_with_equal_decimals_is_one_dollar() {
        let price = curve_price_ceil_1e18(SQRT_ONE, 6, 6).unwrap();
        assert_eq!(price, U256::from(ONE_DOLLAR));
    }

    #[test]
    fn extra_base_decimals_raise_the_dollar_price() {
        // One raw quote unit per raw base unit, with nine base decimals against six
        // quote decimals, is a thousand dollars a token.
        let price = curve_price_ceil_1e18(SQRT_ONE, 9, 6).unwrap();
        assert_eq!(price, U256::from(1_000u128 * ONE_DOLLAR));
    }

    #[test]
    fn extra_quote_decimals_lower_the_dollar_price() {
        let price = curve_price_ceil_1e18(SQRT_ONE, 6, 9).unwrap();
        assert_eq!(price, U256::from(ONE_DOLLAR / 1_000));
    }

    #[test]
    fn a_fraction_of_a_unit_always_rounds_up() {
        // One below the square root of one leaves a price a hair under a dollar,
        // and the ceiling has to land on the dollar rather than below it.
        let price = curve_price_ceil_1e18(SQRT_ONE - 1, 6, 6).unwrap();
        assert_eq!(price, U256::from(ONE_DOLLAR));
    }

    #[test]
    fn the_largest_sqrt_price_dbc_allows_does_not_overflow() {
        // MAX_SQRT_PRICE from DBC's own constants.rs.
        let price = curve_price_ceil_1e18(79_226_673_521_066_979_257_578_248_091, 18, 0).unwrap();
        assert!(price > U256::from(0u8));
    }

    #[test]
    fn the_largest_possible_sqrt_price_does_not_overflow() {
        assert!(curve_price_ceil_1e18(u128::MAX, 18, 0).is_ok());
    }

    #[test]
    fn decimals_past_the_limit_are_refused() {
        assert!(curve_price_ceil_1e18(SQRT_ONE, 19, 6).is_err());
        assert!(curve_price_ceil_1e18(SQRT_ONE, 6, 19).is_err());
    }

    #[test]
    fn the_ceiling_widens_by_the_band_and_rounds_down() {
        let hundred = U256::from(100u128 * ONE_DOLLAR);
        assert_eq!(band_ceiling_floor_1e18(hundred, 0).unwrap(), hundred);
        assert_eq!(
            band_ceiling_floor_1e18(hundred, 500).unwrap(),
            U256::from(105u128 * ONE_DOLLAR)
        );
        // 3 times 10001 is 30003, and a ten thousandth of that rounds down to 3.
        assert_eq!(
            band_ceiling_floor_1e18(U256::from(3u8), 1).unwrap(),
            U256::from(3u8)
        );
    }

    #[test]
    fn the_widest_band_a_sale_may_set_is_half_again() {
        let hundred = U256::from(100u128 * ONE_DOLLAR);
        assert_eq!(
            band_ceiling_floor_1e18(hundred, MAX_BAND_BPS).unwrap(),
            U256::from(150u128 * ONE_DOLLAR)
        );
    }
}
